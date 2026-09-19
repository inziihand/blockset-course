[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ConfigPath,

    [string] $StatePath,

    [switch] $RecordEvidence
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedConfig = Resolve-Path -LiteralPath $ConfigPath
$installation = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
$registry = Get-Content -LiteralPath (Join-Path $repoRoot 'infrastructure\services.json') -Raw | ConvertFrom-Json
$planJson = & node (Join-Path $repoRoot 'scripts\plan-deployment.mjs') '--installation' ([string] $resolvedConfig) '--json'
if ($LASTEXITCODE -ne 0 -or -not $planJson) { throw 'Unable to resolve the App deployment plan.' }
$deploymentPlan = ($planJson -join [Environment]::NewLine) | ConvertFrom-Json
$selectedServiceKeys = @($deploymentPlan.requiredServiceKeys)
if (-not $StatePath) {
    $StatePath = Join-Path $repoRoot ".stratexec\installations\$($installation.installationKey)\state.json"
}
if (-not (Test-Path -LiteralPath $StatePath)) { throw 'Installation state was not found.' }
$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if ($state.projectId -ne $installation.gcpProjectId) { throw 'Installation state belongs to a different project.' }
if ($state.schemaVersion -ne 3 -or -not $state.services) {
    throw 'Installation state must use schemaVersion 3 with generic service checkpoints.'
}

function Invoke-ExternalJson {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)
    $output = & gcloud @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { throw "gcloud verification failed: $($Arguments -join ' ')" }
    return ($output -join [Environment]::NewLine | ConvertFrom-Json)
}

function Assert-Unauthorized {
    param(
        [Parameter(Mandatory = $true)][string] $Uri,
        [Parameter(Mandatory = $true)][string] $Method,
        [Parameter(Mandatory = $true)][string] $Label,
        [Parameter(Mandatory = $true)][int] $ExpectedStatus
    )
    $result = Invoke-WebRequest -Method $Method -Uri $Uri -SkipHttpErrorCheck
    if ($result.StatusCode -ne $ExpectedStatus) {
        throw "$Label must reject an unauthenticated request with HTTP $ExpectedStatus; received $($result.StatusCode)."
    }
    return $result.StatusCode
}

$projectId = [string] $installation.gcpProjectId
$hostingUrl = if ($state.hostingUrl) { [string] $state.hostingUrl } else { "https://$projectId.web.app" }
$evidence = [ordered]@{}
$routeEvidence = @()
foreach ($placement in $installation.servicePlacements) {
    if ($selectedServiceKeys -notcontains $placement.serviceKey) { continue }
    $service = $registry.services | Where-Object { $_.key -eq $placement.serviceKey } | Select-Object -First 1
    if (-not $service -or
        $service.deployment.productionReadiness -ne 'ready' -or
        $placement.selectedTarget -ne 'cloud-run-service') { continue }
    $description = Invoke-ExternalJson @(
        'run', 'services', 'describe', [string] $placement.serviceName,
        "--project=$projectId", "--region=$($placement.region)", '--format=json'
    )
    $url = [string] $description.status.url
    $revision = [string] $description.status.latestReadyRevisionName
    if (-not $url -or -not $revision) { throw "$($placement.serviceKey) has no ready Cloud Run URL or revision." }
    $serviceStateProperty = $state.services.PSObject.Properties |
        Where-Object { $_.Name -eq [string] $placement.serviceKey } | Select-Object -First 1
    if (-not $serviceStateProperty) { throw "Installer checkpoint is missing $($placement.serviceKey)." }
    $serviceState = $serviceStateProperty.Value
    if ($serviceState.revision -and $serviceState.revision -ne $revision) {
        throw "$($placement.serviceKey) revision differs from the installer checkpoint."
    }
    $health = Invoke-RestMethod -Method Get -Uri "$url$($service.deployment.listen.healthPath)"
    if ($health.status -ne 'ok') { throw "$($placement.serviceKey) health check failed." }
    if ($service.deployment.trafficControl -and
        $service.deployment.trafficControl.requiresSingleInstance -eq $true) {
        $maxScale = [string] $description.spec.template.metadata.annotations.'autoscaling.knative.dev/maxScale'
        if ($maxScale -ne '1') { throw "$($placement.serviceKey) must remain maxInstances=1 for its in-memory traffic controls." }
    }
    $revisionDescription = Invoke-ExternalJson @(
        'run', 'revisions', 'describe', $revision,
        "--project=$projectId", "--region=$($placement.region)", '--format=json'
    )
    $digest = [string] $revisionDescription.status.imageDigest
    if (-not $digest) { throw "$($placement.serviceKey) revision has no image digest evidence." }
    $evidence[$placement.serviceKey] = [ordered]@{
        serviceName = [string] $placement.serviceName
        revision = $revision
        imageDigest = $digest
        health = 'ok'
    }
    foreach ($request in @($service.deployment.verification.unauthenticatedRequests)) {
        $status = Assert-Unauthorized "$hostingUrl$([string] $request.path)" `
            ([string] $request.method) "$($placement.serviceKey) Hosting route" ([int] $request.expectedStatus)
        $routeEvidence += [ordered]@{
            serviceKey = [string] $placement.serviceKey
            method = [string] $request.method
            path = [string] $request.path
            expectedStatus = [int] $request.expectedStatus
            actualStatus = [int] $status
        }
    }
}

if ($RecordEvidence) {
    $merged = [ordered]@{}
    foreach ($property in $state.PSObject.Properties) { $merged[$property.Name] = $property.Value }
    $merged.verification = [ordered]@{
        verifiedAt = [DateTime]::UtcNow.ToString('o')
        hostingUrl = $hostingUrl
        unauthenticatedRoutes = $routeEvidence
        services = $evidence
    }
    $merged | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $StatePath -Encoding utf8
}

Write-Host "Verified installation: $($installation.installationKey)"
Write-Host "Hosting: $hostingUrl"
foreach ($entry in $evidence.GetEnumerator()) {
    Write-Host "$($entry.Key): $($entry.Value.revision) / $($entry.Value.imageDigest)"
}
Write-Host "Declared unauthenticated Hosting checks passed: $($routeEvidence.Count)."
