[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ConfigPath,

    [switch] $ApplyCloudChanges,

    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedConfig = Resolve-Path -LiteralPath $ConfigPath
$config = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
$localFirebase = Join-Path $repoRoot 'node_modules\.bin\firebase.cmd'
$firebaseExecutable = if (Test-Path -LiteralPath $localFirebase) { $localFirebase } else { 'firebase' }
if (-not $OutputPath) { $OutputPath = Join-Path $repoRoot '.env.local' }

function Invoke-ExternalJsonResult {
    param(
        [Parameter(Mandatory = $true)][string] $Executable,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $Executable @Arguments 1>$stdoutPath 2>$stderrPath
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        $stdout = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
        $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
        if ($exitCode -ne 0) {
            return [pscustomobject]@{
                Succeeded = $false
                Value = $null
                Error = (@($stderr, $stdout) | Where-Object { $_ } | Select-Object -First 1)
            }
        }
        return [pscustomobject]@{
            Succeeded = $true
            Value = if ([string]::IsNullOrWhiteSpace($stdout)) { $null } else { $stdout | ConvertFrom-Json }
            Error = ''
        }
    }
    finally {
        $ErrorActionPreference = $previousPreference
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory = $true)][string] $Executable,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $Executable @Arguments
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    foreach ($line in @($output)) { Write-Host $line }
    if ($exitCode -ne 0) { throw "$Executable exited with code $exitCode." }
}

function Get-FirebasePayload {
    param($Response)
    if ($null -ne $Response.result) { return $Response.result }
    return $Response
}

function Get-AppId {
    param($WebApp)
    if ($WebApp.appId) { return [string] $WebApp.appId }
    if ($WebApp.app_id) { return [string] $WebApp.app_id }
    return [string] $WebApp.name
}

function Get-GcloudHeaders {
    param([Parameter(Mandatory = $true)][string] $ProjectId)

    $accessToken = (& gcloud auth print-access-token 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $accessToken) {
        throw 'Unable to obtain a Google Cloud access token for Firebase Authentication inspection.'
    }
    return @{
        Authorization = "Bearer $accessToken"
        'x-goog-user-project' = $ProjectId
    }
}

function Get-IdentityReadiness {
    param(
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string[]] $RequiredDomains
    )

    $missing = @()
    try {
        $headers = Get-GcloudHeaders -ProjectId $ProjectId
        $configUri = "https://identitytoolkit.googleapis.com/admin/v2/projects/$ProjectId/config"
        $identityConfig = Invoke-RestMethod -Method Get -Uri $configUri -Headers $headers
        $configuredDomains = @($identityConfig.authorizedDomains)
        if (@($RequiredDomains | Where-Object { $configuredDomains -notcontains $_ }).Count -gt 0) {
            $missing += 'authorized-domains'
        }

        $providerUri = "https://identitytoolkit.googleapis.com/admin/v2/projects/$ProjectId/defaultSupportedIdpConfigs/google.com"
        try {
            $provider = Invoke-RestMethod -Method Get -Uri $providerUri -Headers $headers
            if (-not $provider.enabled) { $missing += 'google-provider' }
        }
        catch {
            $missing += 'google-provider'
        }
    }
    catch {
        $missing += 'identity-platform'
    }
    return @($missing | Sort-Object -Unique)
}

function Write-ManagedDotEnv {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)] $Sdk,
        [Parameter(Mandatory = $true)][string] $InstallationKey
    )

    $managed = [ordered]@{
        VITE_STRATEXEC_INSTALLATION_KEY = $InstallationKey
        VITE_FIREBASE_API_KEY = [string] $Sdk.apiKey
        VITE_FIREBASE_AUTH_DOMAIN = [string] $Sdk.authDomain
        VITE_FIREBASE_PROJECT_ID = [string] $Sdk.projectId
        VITE_FIREBASE_STORAGE_BUCKET = [string] $Sdk.storageBucket
        VITE_FIREBASE_MESSAGING_SENDER_ID = [string] $Sdk.messagingSenderId
        VITE_FIREBASE_APP_ID = [string] $Sdk.appId
        VITE_FIREBASE_MEASUREMENT_ID = [string] $Sdk.measurementId
        STRATEXEC_IDENTITY_BASE_URL = 'http://127.0.0.1:8180'
    }
    $managedNames = @($managed.Keys)
    $preserved = @()
    if (Test-Path -LiteralPath $Path) {
        $preserved = @(Get-Content -LiteralPath $Path | Where-Object {
            $line = $_
            -not @($managedNames | Where-Object { $line -match "^$([regex]::Escape($_))=" }).Count
        })
    }
    while ($preserved.Count -gt 0 -and [string]::IsNullOrWhiteSpace($preserved[-1])) {
        if ($preserved.Count -eq 1) { $preserved = @() }
        else { $preserved = @($preserved[0..($preserved.Count - 2)]) }
    }
    $lines = @($preserved)
    if ($lines.Count -gt 0) { $lines += '' }
    $lines += '# Managed by scripts/configure-local-auth.ps1. Firebase Web values are public project identifiers.'
    $lines += @($managed.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })

    $directory = Split-Path -Parent $Path
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    [System.IO.File]::WriteAllLines(
        $Path,
        [string[]] $lines,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Get-FirebaseState {
    param(
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $WebAppName,
        [Parameter(Mandatory = $true)][string[]] $RequiredDomains
    )

    $projectsResult = Invoke-ExternalJsonResult $firebaseExecutable @('projects:list', '--json')
    if (-not $projectsResult.Succeeded) {
        return [pscustomobject]@{
            Status = 'firebase-cli-access-required'
            Missing = @('firebase-cli-access')
            WebApp = $null
            Error = [string] $projectsResult.Error
        }
    }
    $projects = @(Get-FirebasePayload $projectsResult.Value)
    $firebaseEnabled = @($projects | Where-Object { $_.projectId -eq $ProjectId }).Count -gt 0
    $missing = @()
    $webApp = $null
    if (-not $firebaseEnabled) {
        $missing += @('firebase-project', 'web-app')
    }
    else {
        $appsResult = Invoke-ExternalJsonResult $firebaseExecutable @(
            'apps:list', 'WEB', '--project', $ProjectId, '--json'
        )
        if (-not $appsResult.Succeeded) {
            return [pscustomobject]@{
                Status = 'firebase-cli-access-required'
                Missing = @('firebase-cli-access')
                WebApp = $null
                Error = [string] $appsResult.Error
            }
        }
        $appsPayload = Get-FirebasePayload $appsResult.Value
        $apps = if ($appsPayload.apps) { @($appsPayload.apps) } else { @($appsPayload) }
        $webApp = $apps | Where-Object { $_.displayName -eq $WebAppName } | Select-Object -First 1
        if (-not $webApp) { $missing += 'web-app' }
    }
    $missing += Get-IdentityReadiness -ProjectId $ProjectId -RequiredDomains $RequiredDomains
    $missing = @($missing | Sort-Object -Unique)
    return [pscustomobject]@{
        Status = if ($missing.Count) { 'needs-cloud-configuration' } else { 'ready' }
        Missing = $missing
        WebApp = $webApp
        Error = ''
    }
}

function Write-AuthDeploymentConfig {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $DisplayName,
        [Parameter(Mandatory = $true)][string] $SupportEmail
    )

    $firebaseConfig = [ordered]@{
        auth = [ordered]@{
            providers = [ordered]@{
                googleSignIn = [ordered]@{
                    oAuthBrandDisplayName = $DisplayName
                    supportEmail = $SupportEmail
                    authorizedRedirectUris = @(
                        'http://localhost', 'http://127.0.0.1',
                        'http://localhost:5175', 'http://127.0.0.1:5175',
                        'http://localhost:3001', 'http://127.0.0.1:3001'
                    )
                }
            }
        }
    }
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    [System.IO.File]::WriteAllText(
        $Path,
        "$($firebaseConfig | ConvertTo-Json -Depth 10)$([Environment]::NewLine)",
        [System.Text.UTF8Encoding]::new($false)
    )
}

if (-not (Get-Command 'gcloud' -ErrorAction SilentlyContinue)) { throw 'Required command is not available: gcloud' }
if (-not (Get-Command $firebaseExecutable -ErrorAction SilentlyContinue)) { throw 'Firebase CLI is not available.' }
if ($config.schemaVersion -ne 1) { throw 'Only installation schemaVersion 1 is supported.' }

$projectId = [string] $config.gcpProjectId
$webAppName = [string] $config.firebaseWebAppDisplayName
$installationKey = [string] $config.installationKey
$requiredDomains = @($config.auth.authorizedDomains)
if ($projectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw 'Invalid gcpProjectId.' }
if ([string]::IsNullOrWhiteSpace($webAppName)) { throw 'firebaseWebAppDisplayName is required.' }

$previousNodeOptions = $env:NODE_OPTIONS
if ($env:NODE_OPTIONS -notmatch '(^|\s)--use-system-ca($|\s)') {
    $env:NODE_OPTIONS = (($env:NODE_OPTIONS, '--use-system-ca') | Where-Object { $_ }) -join ' '
}

try {
    $state = Get-FirebaseState -ProjectId $projectId -WebAppName $webAppName -RequiredDomains $requiredDomains
    if ($state.Status -eq 'firebase-cli-access-required') {
        return $state
    }

    $cloudChanged = $false
    if ($state.Status -eq 'needs-cloud-configuration') {
        if (-not $ApplyCloudChanges) { return $state }

        if ($state.Missing -contains 'firebase-project') {
            Invoke-ExternalCommand $firebaseExecutable @('projects:addfirebase', $projectId, '--non-interactive')
        }
        Invoke-ExternalCommand 'gcloud' @(
            'services', 'enable', 'firebase.googleapis.com', 'identitytoolkit.googleapis.com',
            '--project', $projectId, '--quiet'
        )
        $authConfigPath = Join-Path $repoRoot ".stratexec\installations\$installationKey\local-auth.firebase.json"
        Write-AuthDeploymentConfig -Path $authConfigPath `
            -DisplayName ([string] $config.auth.oauthBrandDisplayName) `
            -SupportEmail ([string] $config.auth.supportEmail)
        Invoke-ExternalCommand $firebaseExecutable @(
            'deploy', '--only', 'auth', '--project', $projectId,
            '--config', $authConfigPath, '--non-interactive'
        )

        if ($state.Missing -contains 'web-app') {
            $createResult = Invoke-ExternalJsonResult $firebaseExecutable @(
                'apps:create', 'WEB', $webAppName, '--project', $projectId, '--json'
            )
            if (-not $createResult.Succeeded) { throw "Unable to create Firebase Web App: $($createResult.Error)" }
        }
        $cloudChanged = $true
        for ($attempt = 1; $attempt -le 5; $attempt += 1) {
            $state = Get-FirebaseState -ProjectId $projectId -WebAppName $webAppName -RequiredDomains $requiredDomains
            if ($state.Status -eq 'ready') { break }
            if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
        }
        if ($state.Status -ne 'ready') {
            throw "Firebase Authentication configuration is still incomplete: $($state.Missing -join ', ')."
        }
    }

    $appId = Get-AppId $state.WebApp
    if (-not $appId) { throw 'Firebase Web App appId could not be resolved.' }
    $sdkResult = Invoke-ExternalJsonResult $firebaseExecutable @(
        'apps:sdkconfig', 'WEB', $appId, '--project', $projectId, '--json'
    )
    if (-not $sdkResult.Succeeded) { throw "Unable to read Firebase Web SDK configuration: $($sdkResult.Error)" }
    $sdkPayload = Get-FirebasePayload $sdkResult.Value
    $sdk = if ($sdkPayload.sdkConfig) { $sdkPayload.sdkConfig } else { $sdkPayload }
    foreach ($key in @('apiKey', 'authDomain', 'projectId', 'appId')) {
        if (-not $sdk.$key) { throw "Firebase SDK configuration is missing $key." }
    }
    Write-ManagedDotEnv -Path $OutputPath -Sdk $sdk -InstallationKey $installationKey
    return [pscustomobject]@{
        Status = 'ready'
        Missing = @()
        WebApp = $state.WebApp
        OutputPath = $OutputPath
        CloudChanged = $cloudChanged
    }
}
finally {
    $env:NODE_OPTIONS = $previousNodeOptions
}
