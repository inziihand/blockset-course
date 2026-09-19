[CmdletBinding()]
param(
    [string] $ConfigPath,

    [string] $BootstrapAdminEmail
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $repoRoot '.stratexec\local-runtime'
$settingsPath = Join-Path $runtimeDirectory 'settings.json'
$processStatePath = Join-Path $runtimeDirectory 'processes.json'
$identityPort = 8180
$frontendCandidates = @(5175, 3001)

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)] $Value
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    [System.IO.File]::WriteAllText(
        $Path,
        "$($Value | ConvertTo-Json -Depth 10)$([Environment]::NewLine)",
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Test-CompatiblePythonCommand {
    param(
        [Parameter(Mandatory = $true)][string] $Executable,
        [string[]] $PrefixArguments = @()
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $Executable @PrefixArguments '-c' 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' `
        1>$null 2>$null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    return $exitCode -eq 0
}

function New-LocalVirtualEnvironment {
    param([Parameter(Mandatory = $true)][string] $Destination)

    if (Get-Command 'py' -ErrorAction SilentlyContinue) {
        if (Test-CompatiblePythonCommand -Executable 'py' -PrefixArguments @('-3.11')) {
            & py -3.11 -m venv $Destination
            if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 could not create the local virtual environment.' }
            return
        }
    }
    foreach ($candidate in @('python', 'python3')) {
        if ((Get-Command $candidate -ErrorAction SilentlyContinue) -and
            (Test-CompatiblePythonCommand -Executable $candidate)) {
            & $candidate -m venv $Destination
            if ($LASTEXITCODE -ne 0) { throw "$candidate could not create the local virtual environment." }
            return
        }
    }
    throw 'Python 3.11 or newer is required. Re-run scripts/install.ps1 to install or select a compatible runtime.'
}

function Test-PythonImports {
    param([Parameter(Mandatory = $true)][string] $PythonPath)

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $PythonPath -c 'import fastapi, firebase_admin, uvicorn, stratexec' 1>$null 2>$null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    return $exitCode -eq 0
}

function Get-ListenerProcess {
    param([Parameter(Mandatory = $true)][int] $Port)

    $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port `
        -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { return $null }
    return (Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)")
}

function Get-OwnedAncestor {
    param(
        [Parameter(Mandatory = $true)] $Process,
        [Parameter(Mandatory = $true)][ValidateSet('identity', 'frontend')] [string] $Kind
    )

    $escapedRoot = [regex]::Escape($repoRoot)
    $current = $Process
    for ($depth = 0; $depth -lt 4 -and $current; $depth += 1) {
        $commandLine = [string] $current.CommandLine
        $kindMatches = if ($Kind -eq 'identity') {
            $commandLine -match 'stratexec\.api\.main:app'
        }
        else {
            $commandLine -match 'vite(?:\.js)?' -and $commandLine -match 'apps[\\/]console'
        }
        if ($commandLine -match $escapedRoot -and $kindMatches) { return $current }
        if (-not $current.ParentProcessId) { break }
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ParentProcessId)" `
            -ErrorAction SilentlyContinue
    }
    return $null
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int] $ProcessId)

    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" `
        -ErrorAction SilentlyContinue)
    foreach ($child in $children) { Stop-ProcessTree -ProcessId ([int] $child.ProcessId) }
    Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}

function Stop-OwnedListener {
    param(
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)][ValidateSet('identity', 'frontend')] [string] $Kind
    )

    $process = Get-ListenerProcess -Port $Port
    if (-not $process) { return $true }
    $owner = Get-OwnedAncestor -Process $process -Kind $Kind
    if (-not $owner) { return $false }
    Stop-ProcessTree -ProcessId ([int] $owner.ProcessId)
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        Start-Sleep -Milliseconds 100
        if (-not (Get-ListenerProcess -Port $Port)) { return $true }
    }
    throw "The existing StratExec $Kind process on port $Port did not stop."
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)][string] $Uri,
        [int] $Attempts = 40
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return $response }
        }
        catch {
            if ($attempt -eq $Attempts) { return $null }
        }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

if (-not $ConfigPath) {
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        throw 'No saved local installation was found. Run scripts/install.ps1 first.'
    }
    $savedSettings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $ConfigPath = [string] $savedSettings.configPath
    if (-not $BootstrapAdminEmail) {
        $BootstrapAdminEmail = [string] $savedSettings.bootstrapAdminEmail
    }
}

$resolvedConfig = Resolve-Path -LiteralPath $ConfigPath
$installation = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
$projectId = [string] $installation.gcpProjectId
if ($projectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw 'Invalid gcpProjectId.' }
if (-not $BootstrapAdminEmail) { $BootstrapAdminEmail = [string] $installation.auth.supportEmail }
if ($BootstrapAdminEmail -notmatch '^.+@.+\..+$') { throw 'A valid bootstrap administrator email is required.' }

if (-not (Get-Command 'node' -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }
if (-not (Get-Command 'gcloud' -ErrorAction SilentlyContinue)) { throw 'Google Cloud CLI is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.env.local'))) {
    throw 'The root .env.local is missing. Run scripts/install.ps1 first.'
}

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& gcloud auth application-default print-access-token 1>$null 2>$null
$adcExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($adcExitCode -ne 0) {
    throw 'Application Default Credentials are unavailable. Run scripts/install.ps1 to complete Google authorization.'
}

$venvDirectory = Join-Path $repoRoot '.venv'
$venvPython = Join-Path $venvDirectory 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host '正在建立本機 Python 環境…' -ForegroundColor Cyan
    New-LocalVirtualEnvironment -Destination $venvDirectory
}
if (-not (Test-PythonImports -PythonPath $venvPython)) {
    Write-Host '正在安裝 Identity API Python 相依套件…' -ForegroundColor Cyan
    & $venvPython -m pip install --disable-pip-version-check --use-feature=truststore `
        'setuptools>=75' 'wheel'
    if ($LASTEXITCODE -ne 0) { throw 'Python build dependencies could not be installed.' }
    & $venvPython -m pip install --disable-pip-version-check --use-feature=truststore `
        --no-build-isolation -e (Join-Path $repoRoot 'backend')
    if ($LASTEXITCODE -ne 0 -or -not (Test-PythonImports -PythonPath $venvPython)) {
        throw 'Identity API Python dependencies could not be installed.'
    }
}

New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
$identityStdout = Join-Path $runtimeDirectory 'identity.stdout.log'
$identityStderr = Join-Path $runtimeDirectory 'identity.stderr.log'
$frontendStdout = Join-Path $runtimeDirectory 'frontend.stdout.log'
$frontendStderr = Join-Path $runtimeDirectory 'frontend.stderr.log'

if (-not (Stop-OwnedListener -Port $identityPort -Kind identity)) {
    throw "Port $identityPort is used by a process that does not belong to this StratExec checkout."
}

$frontendPort = $null
foreach ($candidate in $frontendCandidates) {
    $available = Stop-OwnedListener -Port $candidate -Kind frontend
    if ($available) { $frontendPort = $candidate; break }
}
if (-not $frontendPort) { throw 'Ports 5175 and 3001 are both occupied by other applications.' }

$previousProject = $env:GOOGLE_CLOUD_PROJECT
$previousAdmins = $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS
try {
    $env:GOOGLE_CLOUD_PROJECT = $projectId
    $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS = $BootstrapAdminEmail
    $identityProcess = Start-Process -FilePath $venvPython -ArgumentList @(
        '-m', 'uvicorn', 'stratexec.api.main:app', '--app-dir', 'backend/src',
        '--host', '127.0.0.1', '--port', [string] $identityPort
    ) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $identityStdout `
        -RedirectStandardError $identityStderr -PassThru
}
finally {
    $env:GOOGLE_CLOUD_PROJECT = $previousProject
    $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS = $previousAdmins
}

$identityHealth = Wait-HttpReady -Uri "http://127.0.0.1:$identityPort/healthz"
if (-not $identityHealth) {
    Stop-Process -Id $identityProcess.Id -ErrorAction SilentlyContinue
    $details = Get-Content -LiteralPath $identityStderr -Tail 10 -ErrorAction SilentlyContinue
    throw "Identity API did not become healthy. $($details -join ' ')"
}
$identityApps = Wait-HttpReady -Uri "http://127.0.0.1:$identityPort/api/identity/v1/apps" -Attempts 10
if (-not $identityApps) {
    Stop-Process -Id $identityProcess.Id -ErrorAction SilentlyContinue
    throw 'Identity API is running, but Firestore App catalog verification failed.'
}

$nodeExecutable = (Get-Command 'node').Source
$viteScript = Join-Path $repoRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteScript)) {
    Stop-Process -Id $identityProcess.Id -ErrorAction SilentlyContinue
    throw 'Vite is unavailable. Run scripts/install.ps1 to install npm dependencies.'
}
$frontendProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @(
    $viteScript, 'apps/console', '--host', '127.0.0.1', '--port', [string] $frontendPort, '--strictPort'
) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $frontendStdout `
    -RedirectStandardError $frontendStderr -PassThru

$frontendUrl = "http://127.0.0.1:$frontendPort/"
$frontendHealth = Wait-HttpReady -Uri $frontendUrl
if (-not $frontendHealth -or $frontendHealth.Content -notmatch 'StratExec') {
    Stop-Process -Id $frontendProcess.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $identityProcess.Id -ErrorAction SilentlyContinue
    $details = Get-Content -LiteralPath $frontendStderr -Tail 10 -ErrorAction SilentlyContinue
    throw "StratExec Console did not become healthy. $($details -join ' ')"
}

Write-JsonFile -Path $settingsPath -Value ([ordered]@{
    schemaVersion = 1
    configPath = [string] $resolvedConfig
    bootstrapAdminEmail = $BootstrapAdminEmail
})
Write-JsonFile -Path $processStatePath -Value ([ordered]@{
    schemaVersion = 1
    configPath = [string] $resolvedConfig
    projectId = $projectId
    identity = [ordered]@{ pid = $identityProcess.Id; url = "http://127.0.0.1:$identityPort" }
    frontend = [ordered]@{ pid = $frontendProcess.Id; url = $frontendUrl }
    startedAt = [DateTime]::UtcNow.ToString('o')
})

Write-Host ''
Write-Host 'StratExec 完整本地環境已啟動。' -ForegroundColor Green
Write-Host "Console:      $frontendUrl"
Write-Host "Identity API: http://127.0.0.1:$identityPort"
Write-Host "本機日誌：   $runtimeDirectory"
Write-Host '停止服務：   .\scripts\stop-local.ps1'
