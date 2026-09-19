[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ConfigPath,

    [switch] $Apply,

    [switch] $FinalizeAdmin,

    [string[]] $BootstrapAdminEmails = @(),

    [switch] $ConfirmBillableResources,

    [switch] $ConfirmPublicIngress
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $FinalizeAdmin) { throw 'Choose either -Apply or -FinalizeAdmin, not both.' }

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedConfig = Resolve-Path -LiteralPath $ConfigPath
$installation = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
$registry = Get-Content -LiteralPath (Join-Path $repoRoot 'infrastructure\services.json') -Raw | ConvertFrom-Json
$localFirebase = Join-Path $repoRoot 'node_modules\.bin\firebase.cmd'
$firebaseExecutable = if (Test-Path -LiteralPath $localFirebase) { $localFirebase } else { 'firebase' }
$stateDirectory = Join-Path $repoRoot ".stratexec\installations\$($installation.installationKey)"
$statePath = Join-Path $stateDirectory 'state.json'
$generatedFirebase = Join-Path $stateDirectory 'firebase.json'
$artifactRepository = 'stratexec'

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

    $activeAccount = Invoke-ExternalValue 'gcloud' @('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)')
    if (-not $activeAccount) { throw 'No active gcloud account. Run gcloud auth login first.' }
    if (-not (Test-GcloudResource @('projects', 'describe', $projectId, '--format=value(projectId)'))) {
        throw "The active account cannot access project $projectId."
    }
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
