[CmdletBinding()]
param(
    [string] $ConfigPath,

    [switch] $PrepareOnly,

    [switch] $Apply,

    [switch] $FinalizeAdmin,

    [string[]] $BootstrapAdminEmails = @(),

    [switch] $ConfirmBillableResources,

    [switch] $ConfirmPublicIngress
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $FinalizeAdmin) { throw 'Choose either -Apply or -FinalizeAdmin, not both.' }
if ($PrepareOnly -and ($Apply -or $FinalizeAdmin)) {
    throw '-PrepareOnly cannot be combined with -Apply or -FinalizeAdmin.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot

function Read-InstallerValue {
    param(
        [Parameter(Mandatory = $true)][string] $Label,
        [string] $Default = '',
        [Parameter(Mandatory = $true)][scriptblock] $Validator,
        [Parameter(Mandatory = $true)][string] $ValidationMessage
    )

    while ($true) {
        $prompt = if ($Default) { "$Label [$Default]" } else { $Label }
        $value = (Read-Host $prompt).Trim()
        if (-not $value) { $value = $Default }
        if (& $Validator $value) { return $value }
        Write-Host $ValidationMessage -ForegroundColor Yellow
    }
}

function ConvertTo-InstallationKey {
    param([Parameter(Mandatory = $true)][string] $Value)

    $candidate = $Value.Trim().ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    $candidate = $candidate.Trim('-')
    if (-not $candidate -or $candidate[0] -notmatch '[a-z]') { return 'customer-installation' }
    if ($candidate.Length -gt 40) { $candidate = $candidate.Substring(0, 40).TrimEnd('-') }
    if ($candidate.Length -lt 3) { return 'customer-installation' }
    return $candidate
}

function Get-DefaultServiceName {
    param([Parameter(Mandatory = $true)][string] $InstallationKey)

    $prefix = $InstallationKey
    if ($prefix.Length -gt 53) { $prefix = $prefix.Substring(0, 53).TrimEnd('-') }
    return "$prefix-identity"
}

function Read-YesNo {
    param(
        [Parameter(Mandatory = $true)][string] $Label,
        [bool] $DefaultYes = $true
    )

    $suffix = if ($DefaultYes) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        $answer = (Read-Host "$Label $suffix").Trim().ToLowerInvariant()
        if (-not $answer) { return $DefaultYes }
        if ($answer -in @('y', 'yes')) { return $true }
        if ($answer -in @('n', 'no')) { return $false }
        Write-Host '請輸入 Y 或 N。' -ForegroundColor Yellow
    }
}

function Invoke-GcloudCapture {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)

    if (-not (Get-Command 'gcloud' -ErrorAction SilentlyContinue)) {
        throw '找不到 gcloud CLI。請先安裝 Google Cloud CLI，再重新執行安裝精靈。'
    }

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & gcloud @Arguments 1> $stdoutPath 2> $stderrPath
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        $stdout = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
        $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
        return [pscustomobject]@{
            ExitCode = $exitCode
            StdOut = if ($null -eq $stdout) { '' } else { $stdout.Trim() }
            StdErr = if ($null -eq $stderr) { '' } else { $stderr.Trim() }
        }
    }
    finally {
        $ErrorActionPreference = $previousPreference
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Throw-GcloudCommandFailure {
    param(
        [Parameter(Mandatory = $true)][string] $Action,
        [Parameter(Mandatory = $true)] $Result
    )

    $details = @($Result.StdErr, $Result.StdOut) | Where-Object { $_ } | Select-Object -First 1
    $detailText = [string] $details
    if ($detailText -match 'CERTIFICATE_VERIFY_FAILED|SSLCertVerificationError|unable to get local issuer certificate') {
        throw "gcloud 執行「${Action}」時無法驗證 Google TLS 憑證。請修復 Google Cloud CLI／系統 CA 信任後重試；安裝器不會停用 TLS 驗證。原始訊息：$detailText"
    }
    if ($detailText -match 'gcloud auth login|invalid_grant|reauth|credentials') {
        throw "gcloud 執行「${Action}」時需要重新登入。請先執行 gcloud auth login，再重新執行安裝精靈。原始訊息：$detailText"
    }
    throw "gcloud 無法${Action}（exit code $($Result.ExitCode)）。原始訊息：$detailText"
}

function Get-GcloudRequiredValue {
    param(
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $Action
    )

    $result = Invoke-GcloudCapture -Arguments $Arguments
    if ($result.ExitCode -ne 0) { Throw-GcloudCommandFailure -Action $Action -Result $result }
    return [string] $result.StdOut
}

function Get-GcloudWizardContext {
    $account = Get-GcloudRequiredValue -Arguments @(
        'auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'
    ) -Action '讀取目前登入帳號'
    if ([string]::IsNullOrWhiteSpace($account)) {
        throw '目前沒有啟用中的 gcloud 帳號。請先執行 gcloud auth login，再重新執行安裝精靈。'
    }

    $configuredProject = Get-GcloudRequiredValue -Arguments @(
        'config', 'get-value', 'project'
    ) -Action '讀取預設 project'
    $projectsJson = Get-GcloudRequiredValue -Arguments @(
        'projects', 'list', '--format=json(projectId,name)'
    ) -Action '列出可存取的 Google Cloud projects'
    $projects = if ([string]::IsNullOrWhiteSpace($projectsJson)) {
        @()
    }
    else {
        @($projectsJson | ConvertFrom-Json | Sort-Object name, projectId)
    }
    if ($projects.Count -eq 0) {
        throw '目前帳號沒有可列出的 Google Cloud project。請先建立 project 或取得 project 存取權。'
    }

    return [pscustomobject]@{
        Account = $account.Trim()
        ConfiguredProject = $configuredProject.Trim()
        Projects = $projects
    }
}

function Select-GcloudProject {
    param([Parameter(Mandatory = $true)] $Context)

    $projects = @($Context.Projects)
    if ($projects.Count -eq 1) {
        Write-Host "自動選用唯一可存取的 project：$($projects[0].name) ($($projects[0].projectId))"
        return [string] $projects[0].projectId
    }

    Write-Host ''
    Write-Host '可存取的 Google Cloud projects：' -ForegroundColor Cyan
    $defaultSelection = 1
    for ($index = 0; $index -lt $projects.Count; $index += 1) {
        $marker = if ($projects[$index].projectId -eq $Context.ConfiguredProject) { '（目前預設）' } else { '' }
        if ($marker) { $defaultSelection = $index + 1 }
        Write-Host "  $($index + 1). $($projects[$index].name) [$($projects[$index].projectId)] $marker"
    }
    Write-Host '  0. 手動輸入 project ID'
    $selection = Read-InstallerValue '請選擇 project 編號' ([string] $defaultSelection) {
        param($value)
        $number = 0
        [int]::TryParse($value, [ref] $number) -and $number -ge 0 -and $number -le $projects.Count
    } "請輸入 0～$($projects.Count)。"
    if ([int] $selection -gt 0) { return [string] $projects[[int] $selection - 1].projectId }
    return Read-InstallerValue 'Google Cloud project ID' $Context.ConfiguredProject {
        param($value) $value -match '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
    } '請輸入有效的 Google Cloud project ID（不是專案顯示名稱）。'
}

function Confirm-InstallationDefaults {
    param(
        [Parameter(Mandatory = $true)][string] $DisplayName,
        [Parameter(Mandatory = $true)][string] $InstallationKey,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Region,
        [Parameter(Mandatory = $true)][string] $SupportEmail
    )

    while ($true) {
        Write-Host ''
        Write-Host '安裝設定摘要' -ForegroundColor Cyan
        Write-Host "  顯示名稱：$DisplayName"
        Write-Host "  安裝代號：$InstallationKey"
        Write-Host "  GCP project：$ProjectId"
        Write-Host "  GCP region：$Region"
        Write-Host "  Support email：$SupportEmail"
        if (Read-YesNo '使用以上設定並建立本機設定嗎？') {
            return [pscustomobject]@{
                InstallationKey = $InstallationKey
                ProjectId = $ProjectId
                Region = $Region
                SupportEmail = $SupportEmail
            }
        }

        Write-Host '請自訂要變更的值；直接按 Enter 可保留目前設定。' -ForegroundColor Yellow
        $InstallationKey = Read-InstallerValue '安裝代號（英文小寫、數字與連字號）' $InstallationKey {
            param($value) $value -match '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'
        } '安裝代號必須為 3～40 字元，英文小寫開頭，只能包含英文小寫、數字與連字號。'
        $ProjectId = Read-InstallerValue 'Google Cloud project ID' $ProjectId {
            param($value) $value -match '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
        } '請輸入有效的 Google Cloud project ID（不是專案顯示名稱）。'
        $Region = Read-InstallerValue 'GCP region' $Region {
            param($value) $value -match '^[a-z]+-[a-z]+[0-9]$'
        } '請輸入有效的 region，例如 asia-east1。'
        $SupportEmail = Read-InstallerValue 'Firebase／OAuth support email' $SupportEmail {
            param($value) $value -match '^.+@.+\..+$'
        } '請輸入有效的 email。'
    }
}

function Write-InstallationConfig {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][hashtable] $Configuration
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporaryPath = Join-Path $directory ".$(Split-Path -Leaf $Path).$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $json = $Configuration | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            "$json$([Environment]::NewLine)",
            [System.Text.UTF8Encoding]::new($false)
        )
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Test-InstallationConfigReady {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $IdentityServiceKey
    )

    try {
        $candidate = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        $placement = @($candidate.servicePlacements | Where-Object {
            $_.serviceKey -eq $IdentityServiceKey
        }) | Select-Object -First 1
        return (
            $candidate.installationKey -match '^[a-z][a-z0-9-]{1,38}[a-z0-9]$' -and
            -not [string]::IsNullOrWhiteSpace([string] $candidate.displayName) -and
            $candidate.displayName -ne 'Customer name' -and
            $candidate.gcpProjectId -match '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' -and
            $candidate.gcpProjectId -ne 'customer-project-id' -and
            $candidate.region -match '^[a-z]+-[a-z]+[0-9]$' -and
            $candidate.auth.supportEmail -match '^.+@.+\..+$' -and
            $candidate.auth.supportEmail -ne 'support@example.com' -and
            $placement -and
            $placement.selectedTarget -eq 'cloud-run-service' -and
            $placement.region -eq $candidate.region -and
            $placement.serviceName -match '^[a-z][a-z0-9-]{1,61}[a-z0-9]$'
        )
    }
    catch {
        return $false
    }
}

function New-InteractiveInstallationConfig {
    $environmentDirectory = Join-Path $repoRoot 'infrastructure\environments'
    $serviceRegistry = Get-Content -LiteralPath (Join-Path $repoRoot 'infrastructure\services.json') -Raw |
        ConvertFrom-Json
    $identityServices = @($serviceRegistry.services | Where-Object {
        $_.capabilities -contains 'identity:session' -and
        $_.deployment.allowedTargets -contains 'cloud-run-service'
    })
    if ($identityServices.Count -ne 1) {
        throw 'Installation wizard requires exactly one Cloud Run capable identity:session service.'
    }
    $identityServiceKey = [string] $identityServices[0].key
    $localConfigs = @(Get-ChildItem -LiteralPath $environmentDirectory -Filter '*.local.json' -File)
    $existingConfigs = @($localConfigs | Where-Object {
        Test-InstallationConfigReady -Path $_.FullName -IdentityServiceKey $identityServiceKey
    })
    $incompleteConfigs = @($localConfigs | Where-Object {
        -not (Test-InstallationConfigReady -Path $_.FullName -IdentityServiceKey $identityServiceKey)
    })
    foreach ($incompleteConfig in $incompleteConfigs) {
        Write-Host "略過尚未填完的安裝設定：$($incompleteConfig.FullName)" -ForegroundColor Yellow
    }
    if ($existingConfigs.Count -eq 1) {
        $existingPath = $existingConfigs[0].FullName
        if (Read-YesNo "偵測到既有安裝設定 $existingPath，直接使用嗎？") {
            return $existingPath
        }
    }
    elseif ($existingConfigs.Count -gt 1) {
        Write-Host '偵測到多份可用的本機安裝設定：' -ForegroundColor Cyan
        for ($index = 0; $index -lt $existingConfigs.Count; $index += 1) {
            Write-Host "  $($index + 1). $($existingConfigs[$index].FullName)"
        }
        Write-Host '  0. 建立新的安裝設定'
        $selection = Read-InstallerValue '請選擇設定編號' '' {
            param($value)
            $number = 0
            [int]::TryParse($value, [ref] $number) -and $number -ge 0 -and $number -le $existingConfigs.Count
        } "請輸入 0～$($existingConfigs.Count)。"
        if ([int] $selection -gt 0) { return $existingConfigs[[int] $selection - 1].FullName }
    }

    Write-Host ''
    Write-Host 'StratExec 安裝設定精靈' -ForegroundColor Cyan
    Write-Host '本階段只建立被 Git 忽略的本機設定，接著執行唯讀 dry-run。'
    if ($PrepareOnly) {
        Write-Host 'PrepareOnly 模式不查詢 gcloud；請手動輸入安裝資料。'
    }
    else {
        Write-Host '正在讀取目前 gcloud 帳號與可存取的既有 Google Cloud projects。'
    }
    Write-Host ''

    $gcloudContext = if ($PrepareOnly) { $null } else { Get-GcloudWizardContext }
    if ($gcloudContext) {
        Write-Host "gcloud 帳號：$($gcloudContext.Account)" -ForegroundColor Green
    }

    $displayName = Read-InstallerValue '客戶／環境顯示名稱' '' {
        param($value) -not [string]::IsNullOrWhiteSpace($value)
    } '顯示名稱不可空白。'
    $suggestedKey = ConvertTo-InstallationKey $displayName
    if ($PrepareOnly) {
        $installationKey = Read-InstallerValue '安裝代號（英文小寫、數字與連字號）' $suggestedKey {
            param($value) $value -match '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'
        } '安裝代號必須為 3～40 字元，英文小寫開頭，只能包含英文小寫、數字與連字號。'
        $projectId = Read-InstallerValue '既有 Google Cloud project ID' '' {
            param($value) $value -match '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
        } '請輸入有效的 Google Cloud project ID（不是專案顯示名稱）。'
        $region = Read-InstallerValue 'GCP region' 'asia-east1' {
            param($value) $value -match '^[a-z]+-[a-z]+[0-9]$'
        } '請輸入有效的 region，例如 asia-east1。'
        $supportEmail = Read-InstallerValue 'Firebase／OAuth support email' '' {
            param($value) $value -match '^.+@.+\..+$'
        } '請輸入有效的 email。'
    }
    else {
        $installationKey = $suggestedKey
        $projectId = Select-GcloudProject -Context $gcloudContext
        $region = 'asia-east1'
        $supportEmail = if ($gcloudContext.Account -match '^.+@.+\..+$') {
            [string] $gcloudContext.Account
        }
        else {
            Read-InstallerValue 'Firebase／OAuth support email' '' {
                param($value) $value -match '^.+@.+\..+$'
            } '請輸入有效的 email。'
        }
    }

    $confirmed = Confirm-InstallationDefaults -DisplayName $displayName -InstallationKey $installationKey `
        -ProjectId $projectId -Region $region -SupportEmail $supportEmail
    $installationKey = $confirmed.InstallationKey
    $projectId = $confirmed.ProjectId
    $region = $confirmed.Region
    $supportEmail = $confirmed.SupportEmail

    $configPath = Join-Path $environmentDirectory "$installationKey.local.json"
    if (Test-Path -LiteralPath $configPath) {
        $confirmation = Read-Host "設定檔已存在。若要覆寫，請輸入 OVERWRITE：$configPath"
        if ($confirmation -cne 'OVERWRITE') { throw '未確認覆寫，安裝設定未變更。' }
    }

    $configuration = [ordered]@{
        schemaVersion = 1
        installationKey = $installationKey
        displayName = $displayName
        gcpProjectId = $projectId
        region = $region
        firebaseWebAppDisplayName = 'stratexec-platform'
        auth = [ordered]@{
            providers = @('google')
            oauthBrandDisplayName = $displayName
            supportEmail = $supportEmail
            authorizedDomains = @('localhost', '127.0.0.1')
        }
        enabledApps = @('demo', 'demo-compact', 'access-control')
        servicePlacements = @(
            [ordered]@{
                serviceKey = $identityServiceKey
                selectedTarget = 'cloud-run-service'
                region = $region
                serviceName = Get-DefaultServiceName $installationKey
                status = 'planned'
            }
        )
    }
    Write-InstallationConfig -Path $configPath -Configuration $configuration
    Write-Host ''
    Write-Host "已建立本機安裝設定：$configPath" -ForegroundColor Green
    Write-Host '管理員 email、OAuth secret、服務帳號 key 與其他秘密不會寫入此檔案。'
    return $configPath
}

if (-not $ConfigPath) {
    $ConfigPath = New-InteractiveInstallationConfig
}
$resolvedConfig = Resolve-Path -LiteralPath $ConfigPath
$installation = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
$registry = Get-Content -LiteralPath (Join-Path $repoRoot 'infrastructure\services.json') -Raw | ConvertFrom-Json
$localFirebase = Join-Path $repoRoot 'node_modules\.bin\firebase.cmd'
$firebaseExecutable = if (Test-Path -LiteralPath $localFirebase) { $localFirebase } else { 'firebase' }
$stateDirectory = Join-Path $repoRoot ".stratexec\installations\$($installation.installationKey)"
$statePath = Join-Path $stateDirectory 'state.json'
$generatedFirebase = Join-Path $stateDirectory 'firebase.json'
$artifactRepository = 'stratexec'

if ($PrepareOnly) {
    Write-Host ''
    Write-Host "設定準備完成：$resolvedConfig"
    Write-Host '尚未查詢或修改任何雲端資源。'
    exit 0
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string] $Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command is not available: $Name"
    }
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string] $Executable,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [switch] $Quiet
    )
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    if ($Quiet) { & $Executable @Arguments 1>$null }
    else { & $Executable @Arguments }
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -ne 0) { throw "$Executable exited with code $exitCode." }
}

function Invoke-ExternalValue {
    param(
        [Parameter(Mandatory = $true)][string] $Executable,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $Executable @Arguments 2>$null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -ne 0) { return $null }
    return (($output -join [Environment]::NewLine).Trim())
}

function Test-GcloudResource {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & gcloud @Arguments 1>$null 2>$null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    return $exitCode -eq 0
}

function Get-RequestedAdmins {
    $requested = @($BootstrapAdminEmails)
    if ($env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS) {
        $requested += $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS -split ','
    }
    return @($requested | ForEach-Object { $_.Trim().ToLowerInvariant() } |
        Where-Object { $_ } | Sort-Object -Unique)
}

function Get-ServicePlacement {
    param([Parameter(Mandatory = $true)][string] $ServiceKey)
    $placement = $installation.servicePlacements | Where-Object { $_.serviceKey -eq $ServiceKey } |
        Select-Object -First 1
    if (-not $placement) { throw "Installation is missing the $ServiceKey placement." }
    $service = $registry.services | Where-Object { $_.key -eq $ServiceKey } | Select-Object -First 1
    if (-not $service) { throw "Service registry is missing $ServiceKey." }
    if ($placement.selectedTarget -ne 'cloud-run-service') {
        throw "Installer requires $ServiceKey selectedTarget=cloud-run-service."
    }
    if ($service.deployment.productionReadiness -ne 'ready') {
        throw "$ServiceKey is not productionReadiness=ready."
    }
    return @{ Placement = $placement; Service = $service }
}

function Add-ProjectRole {
    param(
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Member,
        [Parameter(Mandatory = $true)][string] $Role
    )
    Invoke-External 'gcloud' @(
        'projects', 'add-iam-policy-binding', $ProjectId,
        "--member=$Member", "--role=$Role", '--condition=None', '--quiet'
    ) -Quiet
}

function Write-InstallState {
    param([Parameter(Mandatory = $true)][hashtable] $State)
    New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
    $merged = [ordered]@{}
    if (Test-Path -LiteralPath $statePath) {
        $existing = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        foreach ($property in $existing.PSObject.Properties) { $merged[$property.Name] = $property.Value }
    }
    foreach ($key in $State.Keys) { $merged[$key] = $State[$key] }
    $merged | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $statePath -Encoding utf8
}

Assert-Command 'node'
Assert-Command 'npm'
Assert-Command 'gcloud'
Assert-Command $firebaseExecutable

Push-Location $repoRoot
try {
    Invoke-External 'node' @('scripts/check-installation-config.mjs') -Quiet
    Invoke-External 'node' @('scripts/check-service-registry.mjs') -Quiet
    Invoke-External 'node' @('scripts/check-app-manifests.mjs') -Quiet

    $deploymentPlanJson = Invoke-ExternalValue 'node' @(
        'scripts/plan-deployment.mjs', '--installation', [string] $resolvedConfig, '--json'
    )
    if (-not $deploymentPlanJson) { throw 'Unable to resolve the App deployment plan.' }
    $deploymentPlan = $deploymentPlanJson | ConvertFrom-Json
    $selectedServiceKeys = @($deploymentPlan.requiredServiceKeys)

    $projectId = [string] $installation.gcpProjectId
    $region = [string] $installation.region
    if (-not $projectId -or -not $region) { throw 'Installation project and region are required.' }
    $identityCandidates = @($registry.services | Where-Object {
        $selectedServiceKeys -contains $_.key -and $_.capabilities -contains 'identity:session'
    })
    if ($identityCandidates.Count -ne 1) { throw 'Installation requires exactly one selected identity:session service.' }
    $identityServiceKey = [string] $identityCandidates[0].key
    $identity = Get-ServicePlacement $identityServiceKey
    $identityPlacement = $identity.Placement
    $identityService = $identity.Service

    $activeAccount = Get-GcloudRequiredValue -Arguments @(
        'auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'
    ) -Action '讀取目前登入帳號'
    if (-not $activeAccount) { throw 'No active gcloud account. Run gcloud auth login first.' }
    $projectCheck = Get-GcloudRequiredValue -Arguments @(
        'projects', 'describe', $projectId, '--format=value(projectId)'
    ) -Action "驗證 project $projectId 的存取權"
    if ($projectCheck -ne $projectId) { throw "gcloud 回傳的 project 與安裝設定不一致：$projectCheck" }
    $billingEnabled = Invoke-ExternalValue 'gcloud' @(
        'billing', 'projects', 'describe', $projectId, '--format=value(billingEnabled)'
    )
    $enabledServicesRaw = Invoke-ExternalValue 'gcloud' @(
        'services', 'list', '--enabled', '--project', $projectId, '--format=value(config.name)'
    )
    $enabledServices = @($enabledServicesRaw -split '\r?\n' | Where-Object { $_ })
    $requiredApis = @(
        'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'firebase.googleapis.com',
        'firebasehosting.googleapis.com', 'firestore.googleapis.com', 'identitytoolkit.googleapis.com',
        'run.googleapis.com', 'secretmanager.googleapis.com'
    )
    $missingApis = @($requiredApis | Where-Object { $enabledServices -notcontains $_ })

    Write-Host "Installation: $($installation.installationKey)"
    Write-Host "Project:      $projectId"
    Write-Host "Region:       $region"
    Write-Host "gcloud user:  $activeAccount"
    Write-Host "Billing:      $(if ($billingEnabled -eq 'True') { 'enabled' } else { 'disabled or unavailable' })"
    Write-Host "Apps:         $($deploymentPlan.selectedApps -join ', ')"
    Write-Host "Identity:     $($identityPlacement.serviceName) / $($identityService.deployment.productionReadiness)"
    foreach ($entry in $deploymentPlan.plan) {
        Write-Host "Driver:       $($entry.serviceKey) -> $($entry.deploymentDriver) / $($entry.driverApplySupport)"
    }
    Write-Host "Missing APIs: $(if ($missingApis.Count) { $missingApis -join ', ' } else { 'none' })"
    Write-Host "Mode:         $(if ($Apply) { 'APPLY' } elseif ($FinalizeAdmin) { 'FINALIZE ADMIN' } else { 'DRY RUN' })"
    Write-Host 'Bootstrap administrator addresses are not printed or stored in the installation manifest.'

    if (-not $Apply -and -not $FinalizeAdmin) {
        Write-Host ''
        Write-Host 'Dry run complete. No cloud or local files were changed.'
        Write-Host 'Apply requires both -ConfirmBillableResources and -ConfirmPublicIngress.'
        exit 0
    }

    $notDeployable = @($deploymentPlan.plan | Where-Object { -not $_.deployable })
    if ($notDeployable.Count -gt 0) {
        $details = @($notDeployable | ForEach-Object { "$($_.serviceKey): $($_.blockers -join '; ')" }) -join ' | '
        throw "Selected App services are not deployable by the current target drivers. $details"
    }
    $missingExecutors = @($deploymentPlan.plan | Where-Object {
        -not $_.executor -or -not (Test-Path -LiteralPath (Join-Path $repoRoot ([string] $_.executor)))
    })
    if ($missingExecutors.Count -gt 0) {
        throw "Selected deployment drivers have no executable hook: $(@($missingExecutors.serviceKey) -join ', ')."
    }

    $admins = Get-RequestedAdmins
    if ($admins.Count -eq 0) {
        throw 'At least one bootstrap administrator email is required through the process environment or -BootstrapAdminEmails.'
    }

    if ($FinalizeAdmin) {
        if (-not (Test-Path -LiteralPath $statePath)) {
            throw 'No pending installation state was found. Run -Apply first.'
        }
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($state.phase -ne 'awaiting-admin-login') {
            throw "Installation is not awaiting administrator login (phase=$($state.phase))."
        }

        $accessToken = Invoke-ExternalValue 'gcloud' @('auth', 'print-access-token')
        if (-not $accessToken) { throw 'Unable to obtain a Google Cloud access token.' }
        $queryBody = @{
            structuredQuery = @{
                from = @(@{ collectionId = 'members' })
                where = @{
                    fieldFilter = @{
                        field = @{ fieldPath = 'email' }
                        op = 'EQUAL'
                        value = @{ stringValue = $admins[0] }
                    }
                }
                limit = 1
            }
        } | ConvertTo-Json -Depth 10
        $queryUri = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents:runQuery"
        $documents = Invoke-RestMethod -Method Post -Uri $queryUri -Headers @{
            Authorization = "Bearer $accessToken"
            'x-goog-user-project' = $projectId
        } -ContentType 'application/json' -Body $queryBody
        $member = @($documents | Where-Object { $_.document })[0].document
        if (-not $member -or $member.fields.role.stringValue -ne 'admin' -or
            $member.fields.status.stringValue -ne 'active') {
            throw 'The requested account has not completed Google sign-in as an active administrator.'
        }

        $serviceStates = [ordered]@{}
        if ($state.services) {
            foreach ($property in $state.services.PSObject.Properties) { $serviceStates[$property.Name] = $property.Value }
        }
        $disabledSecretNames = @()
        foreach ($entry in $deploymentPlan.plan) {
            $entryKey = [string] $entry.serviceKey
            $service = $registry.services | Where-Object { $_.key -eq $entry.serviceKey } | Select-Object -First 1
            $placement = $installation.servicePlacements | Where-Object { $_.serviceKey -eq $entry.serviceKey } | Select-Object -First 1
            $serviceState = $serviceStates[$entryKey]
            if (-not $serviceState) { throw "Installer state is missing service $($entry.serviceKey)." }
            $temporarySecrets = @($service.deployment.cloudRun.secrets | Where-Object { $_.temporary -eq $true })
            if ($temporarySecrets.Count -gt 0) {
                $environmentNames = @($temporarySecrets | ForEach-Object { [string] $_.environment }) -join ','
                Invoke-External 'gcloud' @(
                    'run', 'services', 'update', [string] $placement.serviceName,
                    "--project=$projectId", "--region=$($placement.region)",
                    "--remove-secrets=$environmentNames", '--quiet'
                ) -Quiet
                foreach ($secret in $temporarySecrets) {
                    $secretName = [string] $secret.secretName
                    if ($disabledSecretNames -contains $secretName) { continue }
                    $enabledSecretVersionsRaw = Invoke-ExternalValue 'gcloud' @(
                        'secrets', 'versions', 'list', $secretName, "--project=$projectId",
                        '--filter=state=enabled', '--format=value(name)'
                    )
                    foreach ($version in @($enabledSecretVersionsRaw -split '\r?\n' | Where-Object { $_ })) {
                        Invoke-External 'gcloud' @(
                            'secrets', 'versions', 'disable', $version, "--secret=$secretName",
                            "--project=$projectId", '--quiet'
                        ) -Quiet
                    }
                    $disabledSecretNames += $secretName
                }
            }
            $revision = Invoke-ExternalValue 'gcloud' @(
                'run', 'services', 'describe', [string] $placement.serviceName,
                "--project=$projectId", "--region=$($placement.region)",
                '--format=value(status.latestReadyRevisionName)'
            )
            if (-not $revision) { throw "$($entry.serviceKey) Cloud Run revision was not found during final verification." }
            $serviceState.revision = $revision
            $serviceStates[$entryKey] = $serviceState
        }
        $identityState = $serviceStates[$identityServiceKey]
        $identityHealth = Invoke-RestMethod -Method Get -Uri "$([string] $identityState.url)$($identityService.deployment.listen.healthPath)"
        if ($identityHealth.status -ne 'ok') { throw 'Identity API health check failed after removing bootstrap access.' }
        Invoke-External 'npm' @('run', 'build')
        Invoke-External 'node' @('scripts/render-hosting-config.mjs', [string] $resolvedConfig, $generatedFirebase)
        Invoke-External $firebaseExecutable @(
            'deploy', '--only', 'hosting', '--project', $projectId,
            '--config', $generatedFirebase, '--non-interactive'
        )
        $localEnvPath = Join-Path $repoRoot '.env.local'
        if (Test-Path -LiteralPath $localEnvPath) {
            $localEnvLines = Get-Content -LiteralPath $localEnvPath | ForEach-Object {
                if ($_ -match '^STRATEXEC_BOOTSTRAP_ADMIN_EMAILS=') { 'STRATEXEC_BOOTSTRAP_ADMIN_EMAILS=' }
                else { $_ }
            }
            # Preserve dotenv key names when this installer runs under Windows
            # PowerShell 5.1, whose Set-Content -Encoding utf8 adds a BOM.
            [System.IO.File]::WriteAllLines(
                $localEnvPath,
                [string[]] $localEnvLines,
                [System.Text.UTF8Encoding]::new($false)
            )
        }
        Write-InstallState @{
            schemaVersion = 3
            installationKey = [string] $installation.installationKey
            projectId = $projectId
            phase = 'complete'
            services = $serviceStates
            hostingUrl = [string] $state.hostingUrl
            completedAt = [DateTime]::UtcNow.ToString('o')
        }
        & (Join-Path $PSScriptRoot 'verify-installation.ps1') -ConfigPath $resolvedConfig -StatePath $statePath -RecordEvidence
        $evidencePath = Join-Path $repoRoot "docs\evidence\INSTALL-$($installation.installationKey)-$([DateTime]::UtcNow.ToString('yyyyMMdd')).md"
        $serviceEvidence = @($serviceStates.GetEnumerator() | ForEach-Object {
            "- $($_.Key)：$($_.Value.serviceName) / $($_.Value.revision)"
        }) -join [Environment]::NewLine
        @"
# StratExec 安裝驗收

- Installation：$($installation.installationKey)
- GCP project：$projectId
$serviceEvidence
- Hosting：$($state.hostingUrl)
- 驗收：首位管理員已建立為 active admin；bootstrap runtime secret 已移除並停用；已選服務的 health、revision 與 Hosting 未授權拒絕已通過自動檢查。
- App 驗收界線：通用檢查只涵蓋部署 revision、health 與未授權拒絕；登入後業務流程仍依各 App 的 `DEPLOYMENT.md` 驗收。
- 完成時間（UTC）：$([DateTime]::UtcNow.ToString('o'))
"@ | Set-Content -LiteralPath $evidencePath -Encoding utf8
        Write-Host ''
        Write-Host 'Installation is complete. Bootstrap runtime access was removed.'
        Write-Host 'All selected service routes passed server-side verification.'
        exit 0
    }

    if (-not $ConfirmBillableResources) {
        throw 'Apply requires -ConfirmBillableResources immediately before enabling APIs, builds, and Cloud Run resources.'
    }
    if (-not $ConfirmPublicIngress) {
        throw 'Apply requires -ConfirmPublicIngress before allowing browser access to the selected app-authenticated APIs.'
    }
    if ($billingEnabled -ne 'True') {
        throw 'Cloud Billing is disabled. Link or enable billing only after separate explicit authorization, then re-run.'
    }

    $resumeState = $null
    if (Test-Path -LiteralPath $statePath) {
        $resumeState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($resumeState.projectId -ne $projectId) { throw 'Installer state belongs to a different GCP project.' }
        if ($resumeState.phase -eq 'awaiting-admin-login') {
            throw 'Selected services and Hosting are already deployed. Complete Google sign-in, then use -FinalizeAdmin.'
        }
        if ($resumeState.phase -eq 'complete') {
            throw 'Installation is already complete.'
        }
    }

    $enableApiArguments = @('services', 'enable') + $requiredApis + @("--project=$projectId", '--quiet')
    Invoke-External 'gcloud' $enableApiArguments

    $previousBootstrapAdmins = $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS
    try {
        $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS = $admins -join ','
        & (Join-Path $PSScriptRoot 'bootstrap-installation.ps1') -ConfigPath $resolvedConfig -Apply
        if ($LASTEXITCODE -ne 0) { throw 'Firebase bootstrap failed.' }
    }
    finally {
        $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS = $previousBootstrapAdmins
    }

    if (-not (Test-GcloudResource @(
        'artifacts', 'repositories', 'describe', $artifactRepository,
        "--location=$region", "--project=$projectId", '--format=value(name)'
    ))) {
        Invoke-External 'gcloud' @(
            'artifacts', 'repositories', 'create', $artifactRepository,
            '--repository-format=docker', "--location=$region", "--project=$projectId",
            '--description=StratExec service images', '--quiet'
        )
    }

    $projectNumber = Invoke-ExternalValue 'gcloud' @('projects', 'describe', $projectId, '--format=value(projectNumber)')
    $buildServiceAccount = Invoke-ExternalValue 'gcloud' @('builds', 'get-default-service-account', "--project=$projectId")
    if ($buildServiceAccount -and $buildServiceAccount.Contains('/')) {
        $buildServiceAccount = $buildServiceAccount.Split('/')[-1]
    }
    if (-not $buildServiceAccount) { $buildServiceAccount = "${projectNumber}-compute@developer.gserviceaccount.com" }
    Invoke-External 'gcloud' @(
        'artifacts', 'repositories', 'add-iam-policy-binding', $artifactRepository,
        "--location=$region", "--project=$projectId",
        "--member=serviceAccount:$buildServiceAccount", '--role=roles/artifactregistry.writer', '--quiet'
    ) -Quiet

    $serviceStates = [ordered]@{}
    if ($resumeState -and $resumeState.services) {
        foreach ($property in $resumeState.services.PSObject.Properties) { $serviceStates[$property.Name] = $property.Value }
    }
    $previousBootstrapAdmins = $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS
    try {
        $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS = $admins -join ','
        foreach ($entry in $deploymentPlan.plan) {
            $entryKey = [string] $entry.serviceKey
            $existing = $serviceStates[$entryKey]
            if ($existing -and $existing.url -and $existing.revision -and $existing.image) {
                $serviceStates[$entryKey] = $existing
                continue
            }
            New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
            $resultPath = Join-Path $stateDirectory "$($entry.serviceKey)-result.json"
            $executorArguments = @{
                ConfigPath = [string] $resolvedConfig
                ServiceKey = [string] $entry.serviceKey
                ArtifactRepository = $artifactRepository
                StatePath = $statePath
                ResultPath = $resultPath
            }
            if ($existing -and $existing.image) { $executorArguments.ExistingImage = [string] $existing.image }
            & (Join-Path $repoRoot ([string] $entry.executor)) @executorArguments
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $resultPath)) {
                throw "Deployment executor failed for $($entry.serviceKey)."
            }
            $serviceStates[$entryKey] = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
            Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue
            Write-InstallState @{
                schemaVersion = 3
                installationKey = [string] $installation.installationKey
                projectId = $projectId
                phase = "service-$($entry.serviceKey)-deployed"
                services = $serviceStates
                updatedAt = [DateTime]::UtcNow.ToString('o')
            }
        }
    }
    finally { $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS = $previousBootstrapAdmins }

    Invoke-External 'npm' @('run', 'build')
    Invoke-External 'node' @('scripts/render-hosting-config.mjs', [string] $resolvedConfig, $generatedFirebase)
    Invoke-External $firebaseExecutable @(
        'deploy', '--only', 'hosting', '--project', $projectId,
        '--config', $generatedFirebase, '--non-interactive'
    )
    $hostingUrl = "https://$projectId.web.app"
    foreach ($entry in $deploymentPlan.plan) {
        $service = $registry.services | Where-Object { $_.key -eq $entry.serviceKey } | Select-Object -First 1
        foreach ($request in @($service.deployment.verification.unauthenticatedRequests)) {
            $response = Invoke-WebRequest -Method ([string] $request.method) `
                -Uri "$hostingUrl$([string] $request.path)" -SkipHttpErrorCheck
            if ($response.StatusCode -ne [int] $request.expectedStatus) {
                throw "$($entry.serviceKey) Hosting verification expected HTTP $($request.expectedStatus), received $($response.StatusCode)."
            }
        }
    }
    Write-InstallState @{
        schemaVersion = 3
        installationKey = [string] $installation.installationKey
        projectId = $projectId
        phase = 'awaiting-admin-login'
        services = $serviceStates
        hostingUrl = $hostingUrl
        updatedAt = [DateTime]::UtcNow.ToString('o')
    }
    Write-Host ''
    Write-Host "Console: $hostingUrl"
    Write-Host 'Open the Console, sign in with the requested Google account, then re-run with -FinalizeAdmin.'
    Write-Host 'All selected services are deployed and their declared unauthenticated checks passed.'
}
finally {
    Pop-Location
}
