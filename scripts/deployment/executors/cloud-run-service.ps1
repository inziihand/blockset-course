[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $ConfigPath,
    [Parameter(Mandatory = $true)][string] $ServiceKey,
    [Parameter(Mandatory = $true)][string] $ArtifactRepository,
    [Parameter(Mandatory = $true)][string] $StatePath,
    [Parameter(Mandatory = $true)][string] $ResultPath,
    [string] $ExistingImage
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$installation = Get-Content -LiteralPath (Resolve-Path -LiteralPath $ConfigPath) -Raw | ConvertFrom-Json
$registry = Get-Content -LiteralPath (Join-Path $repoRoot 'infrastructure\services.json') -Raw | ConvertFrom-Json
$service = $registry.services | Where-Object { $_.key -eq $ServiceKey } | Select-Object -First 1
$placement = $installation.servicePlacements | Where-Object { $_.serviceKey -eq $ServiceKey } | Select-Object -First 1
if (-not $service -or -not $placement) { throw "Unknown service or placement: $ServiceKey" }
if ($placement.selectedTarget -ne 'cloud-run-service') { throw "Cloud Run executor cannot deploy $($placement.selectedTarget)." }
if ($service.deployment.productionReadiness -ne 'ready') { throw "$ServiceKey is not productionReadiness=ready." }

function Invoke-External {
    param([Parameter(Mandatory = $true)][string] $Executable, [Parameter(Mandatory = $true)][string[]] $Arguments, [switch] $Quiet)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    if ($Quiet) { & $Executable @Arguments 1>$null } else { & $Executable @Arguments }
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -ne 0) { throw "$Executable exited with code $exitCode." }
}

function Invoke-ExternalValue {
    param([Parameter(Mandatory = $true)][string] $Executable, [Parameter(Mandatory = $true)][string[]] $Arguments)
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
    & gcloud @Arguments 1>$null 2>$null
    return $LASTEXITCODE -eq 0
}

function Add-ProjectRole {
    param([string] $ProjectId, [string] $Member, [string] $Role)
    Invoke-External 'gcloud' @(
        'projects', 'add-iam-policy-binding', $ProjectId,
        "--member=$Member", "--role=$Role", '--condition=None', '--quiet'
    ) -Quiet
}

$projectId = [string] $installation.gcpProjectId
$region = [string] $placement.region
$run = $service.deployment.cloudRun
$runtimeServiceAccountId = "$($placement.serviceName)-runtime"
if ($runtimeServiceAccountId.Length -gt 30) { $runtimeServiceAccountId = $runtimeServiceAccountId.Substring(0, 30).TrimEnd('-') }
$runtimeServiceAccount = "$runtimeServiceAccountId@$projectId.iam.gserviceaccount.com"
if (-not (Test-GcloudResource @('iam', 'service-accounts', 'describe', $runtimeServiceAccount, "--project=$projectId"))) {
    Invoke-External 'gcloud' @(
        'iam', 'service-accounts', 'create', $runtimeServiceAccountId,
        "--display-name=StratExec $ServiceKey runtime", "--project=$projectId", '--quiet'
    )
}
foreach ($role in @($run.serviceAccountRoles)) {
    Add-ProjectRole $projectId "serviceAccount:$runtimeServiceAccount" ([string] $role)
}

$secretMappings = @()
foreach ($secret in @($run.secrets)) {
    $secretName = [string] $secret.secretName
    if (-not (Test-GcloudResource @('secrets', 'describe', $secretName, "--project=$projectId", '--format=value(name)'))) {
        Invoke-External 'gcloud' @('secrets', 'create', $secretName, '--replication-policy=automatic', "--project=$projectId", '--quiet')
    }
    $secretValue = if ($secret.source -eq 'bootstrap-admin-emails') { $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS } else { $null }
    if (-not $secretValue) { throw "Secret source is unavailable for $ServiceKey/$($secret.environment)." }
    $secretInput = New-TemporaryFile
    try {
        [System.IO.File]::WriteAllText(
            $secretInput,
            [string] $secretValue,
            [System.Text.UTF8Encoding]::new($false)
        )
        Invoke-External 'gcloud' @('secrets', 'versions', 'add', $secretName, "--data-file=$secretInput", "--project=$projectId", '--quiet') -Quiet
    }
    finally { Remove-Item -LiteralPath $secretInput -Force -ErrorAction SilentlyContinue }
    Invoke-External 'gcloud' @(
        'secrets', 'add-iam-policy-binding', $secretName,
        "--member=serviceAccount:$runtimeServiceAccount", '--role=roles/secretmanager.secretAccessor',
        "--project=$projectId", '--quiet'
    ) -Quiet
    $secretMappings += "$($secret.environment)=$secretName`:latest"
}

$image = $ExistingImage
if (-not $image) {
    $imageTag = "install-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
    $image = "${region}-docker.pkg.dev/$projectId/$ArtifactRepository/$($placement.serviceName):$imageTag"
    $context = Join-Path $repoRoot ([string] $service.deployment.artifact.context)
    $dockerfile = Join-Path $repoRoot ([string] $service.deployment.artifact.dockerfile)
    if ((Resolve-Path -LiteralPath $dockerfile).Path -ne (Join-Path (Resolve-Path -LiteralPath $context).Path 'Dockerfile')) {
        throw 'Cloud Run executor requires Dockerfile at the root of the declared build context.'
    }
    Invoke-External 'gcloud' @('builds', 'submit', $context, "--tag=$image", "--region=$region", "--project=$projectId", '--quiet')
}

$state = if (Test-Path -LiteralPath $StatePath) { Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json } else { $null }
$environmentMappings = @()
foreach ($variable in @($run.environment)) {
    $value = switch ($variable.source) {
        'project-id' { $projectId }
        'service-url' {
            if (-not $state.services) { throw "Dependency state is unavailable for $ServiceKey." }
            $dependencyKey = [string] $variable.serviceKey
            $dependencyProperty = $state.services.PSObject.Properties |
                Where-Object { $_.Name -eq $dependencyKey } | Select-Object -First 1
            if (-not $dependencyProperty) { throw "Dependency state is unavailable: $dependencyKey." }
            $dependency = $dependencyProperty.Value
            if (-not $dependency.url) { throw "Dependency URL is unavailable: $($variable.serviceKey)." }
            [string] $dependency.url
        }
        default { throw "Unsupported environment source: $($variable.source)" }
    }
    if ($value -match '[,\r\n]') { throw "Environment value cannot be encoded safely for $($variable.name)." }
    $environmentMappings += "$($variable.name)=$value"
}

$deployArguments = @(
    'run', 'deploy', [string] $placement.serviceName,
    "--image=$image", "--region=$region", "--project=$projectId",
    "--service-account=$runtimeServiceAccount", "--ingress=$($run.ingress)",
    "--cpu=$($run.cpu)", "--memory=$($run.memory)", "--timeout=$($run.timeoutSeconds)s",
    "--concurrency=$($run.concurrency)", "--min=$($run.minInstances)", "--max=$($run.maxInstances)"
)
$deployArguments += if ($run.iamInvocation -eq 'public-app-auth') { '--allow-unauthenticated' } else { '--no-allow-unauthenticated' }
if ($environmentMappings.Count -gt 0) { $deployArguments += "--set-env-vars=$($environmentMappings -join ',')" }
if ($secretMappings.Count -gt 0) { $deployArguments += "--set-secrets=$($secretMappings -join ',')" }
$deployArguments += '--quiet'
Invoke-External 'gcloud' $deployArguments

$url = Invoke-ExternalValue 'gcloud' @(
    'run', 'services', 'describe', [string] $placement.serviceName,
    "--project=$projectId", "--region=$region", '--format=value(status.url)'
)
$revision = Invoke-ExternalValue 'gcloud' @(
    'run', 'services', 'describe', [string] $placement.serviceName,
    "--project=$projectId", "--region=$region", '--format=value(status.latestReadyRevisionName)'
)
if (-not $url -or -not $revision) { throw "$ServiceKey did not return a ready Cloud Run URL and revision." }
$health = Invoke-RestMethod -Method Get -Uri "$url$($service.deployment.listen.healthPath)"
if ($health.status -ne 'ok') { throw "$ServiceKey health check failed." }

$result = [ordered]@{
    serviceKey = $ServiceKey
    serviceName = [string] $placement.serviceName
    target = 'cloud-run-service'
    region = $region
    image = $image
    url = $url
    revision = $revision
    health = 'ok'
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ResultPath -Encoding utf8
