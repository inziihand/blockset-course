[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ConfigPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]*$')]
    [string] $ServiceKey,

    [string] $Revision,

    [switch] $Apply,

    [switch] $ConfirmTrafficChange
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$installation = Get-Content -LiteralPath (Resolve-Path -LiteralPath $ConfigPath) -Raw | ConvertFrom-Json
$registry = Get-Content -LiteralPath (Join-Path $repoRoot 'infrastructure\services.json') -Raw | ConvertFrom-Json
$planJson = & node (Join-Path $repoRoot 'scripts\plan-deployment.mjs') '--installation' ([string] (Resolve-Path -LiteralPath $ConfigPath)) '--json'
if ($LASTEXITCODE -ne 0 -or -not $planJson) { throw 'Unable to resolve the App deployment plan.' }
$deploymentPlan = ($planJson -join [Environment]::NewLine) | ConvertFrom-Json
if (@($deploymentPlan.requiredServiceKeys) -notcontains $ServiceKey) {
    throw "$ServiceKey is not required by the enabled Apps in this installation."
}
$service = $registry.services | Where-Object { $_.key -eq $ServiceKey } | Select-Object -First 1
if (-not $service) { throw "Unknown service key: $ServiceKey" }
$placement = $installation.servicePlacements | Where-Object { $_.serviceKey -eq $ServiceKey } | Select-Object -First 1
if (-not $placement -or $placement.selectedTarget -ne 'cloud-run-service') {
    throw "$ServiceKey is not assigned to Cloud Run Service in this installation."
}
$projectId = [string] $installation.gcpProjectId
$region = [string] $placement.region
$serviceName = [string] $placement.serviceName

$current = & gcloud run services describe $serviceName "--project=$projectId" "--region=$region" '--format=value(status.latestReadyRevisionName)'
if ($LASTEXITCODE -ne 0 -or -not $current) { throw 'Unable to read the current Cloud Run revision.' }
$revisions = @(& gcloud run revisions list "--service=$serviceName" "--project=$projectId" "--region=$region" '--format=value(metadata.name)' '--sort-by=~metadata.creationTimestamp' |
    Where-Object { $_ })
if ($LASTEXITCODE -ne 0) { throw 'Unable to list Cloud Run revisions.' }

Write-Host "Service:  $serviceName"
Write-Host "Current:  $current"
Write-Host 'Available revisions:'
$revisions | ForEach-Object { if ($_) { Write-Host "  $_" } }
if (-not $Apply) {
    Write-Host 'Dry run only. Provide -Revision, -Apply and -ConfirmTrafficChange to move traffic.'
    exit 0
}
if (-not $ConfirmTrafficChange) { throw 'Rollback requires -ConfirmTrafficChange immediately before changing Cloud Run traffic.' }
if (-not $Revision -or $revisions -notcontains $Revision) { throw 'Revision must name one of the listed revisions.' }

& gcloud run services update-traffic $serviceName "--project=$projectId" "--region=$region" "--to-revisions=$Revision=100" '--quiet'
if ($LASTEXITCODE -ne 0) { throw 'Cloud Run traffic rollback failed.' }
$after = & gcloud run services describe $serviceName "--project=$projectId" "--region=$region" '--format=value(status.traffic[0].revisionName)'
if ($LASTEXITCODE -ne 0 -or $after -ne $Revision) { throw 'Cloud Run rollback could not be verified.' }
Write-Host "Rollback verified: $serviceName -> $Revision"
Write-Host 'If Hosting must also be restored, use Firebase Hosting release history after separately confirming that content rollback.'
