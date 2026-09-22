[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string] $ConfigPath,

    [switch] $Apply,

    [string[]] $BootstrapAdminEmails = @()
)

$ErrorActionPreference = 'Stop'
$previousNodeOptions = $env:NODE_OPTIONS
if ($env:NODE_OPTIONS -notmatch '(^|\s)--use-system-ca($|\s)') {
    $env:NODE_OPTIONS = (($env:NODE_OPTIONS, '--use-system-ca') | Where-Object { $_ }) -join ' '
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$localFirebase = Join-Path $repoRoot 'node_modules\.bin\firebase.cmd'
$firebaseExecutable = if (Test-Path -LiteralPath $localFirebase) { $localFirebase } else { 'firebase' }
$resolvedConfig = Resolve-Path -LiteralPath $ConfigPath
$config = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json

function Invoke-ExternalJson {
    param(
        [Parameter(Mandatory = $true)][string] $Executable,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )

    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $output = & $Executable @Arguments 2>$stderrPath
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($exitCode -ne 0) {
            $stderr = Get-Content -LiteralPath $stderrPath -Raw
            throw "$Executable failed: $stderr"
        }
        return ($output -join [Environment]::NewLine) | ConvertFrom-Json
    }
    finally {
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string] $Executable,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $Executable @Arguments
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -ne 0) {
        throw "$Executable exited with code $exitCode."
    }
}

function Get-FirebaseResult {
    param([Parameter(Mandatory = $true)] $Response)
    if ($null -ne $Response.result) { return $Response.result }
    return $Response
}

if ($config.schemaVersion -ne 1) { throw 'Only installation schemaVersion 1 is supported.' }
$projectId = [string] $config.gcpProjectId
$databaseRegion = [string] $config.region
$webAppName = [string] $config.firebaseWebAppDisplayName
if ($projectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw 'Invalid gcpProjectId.' }
if ($databaseRegion -notmatch '^[a-z]+-[a-z]+[0-9]$') { throw 'Invalid Firestore region.' }

$requestedAdmins = @($BootstrapAdminEmails)
if ($env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS) {
    $requestedAdmins += $env:STRATEXEC_BOOTSTRAP_ADMIN_EMAILS -split ','
}
$requestedAdmins = @($requestedAdmins | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | Sort-Object -Unique)

Write-Host "Installation: $($config.installationKey)"
Write-Host "GCP project:  $projectId"
Write-Host "Firestore:    (default) in $databaseRegion"
Write-Host "Web App:      $webAppName"
Write-Host "Mode:         $(if ($Apply) { 'APPLY' } else { 'DRY RUN' })"
Write-Host 'Bootstrap admin addresses are never written to the installation manifest.'

if (-not $Apply) {
    Write-Host ''
    Write-Host 'No cloud or local files were changed. Re-run with -Apply after reviewing this plan.'
    exit 0
}

Push-Location $repoRoot
try {
    Invoke-External 'gcloud' @('projects', 'describe', $projectId, '--format=value(projectId)')

    $firebaseProjects = Get-FirebaseResult (Invoke-ExternalJson $firebaseExecutable @('projects:list', '--json'))
    $firebaseProjectIds = @($firebaseProjects | ForEach-Object {
        if ($_.projectId) { $_.projectId }
        elseif ($_.project_id) { $_.project_id }
    })
    if ($firebaseProjectIds -notcontains $projectId) {
        Invoke-External $firebaseExecutable @('projects:addfirebase', $projectId, '--non-interactive')
    }

    Invoke-External 'gcloud' @(
        'services', 'enable',
        'firebase.googleapis.com',
        'identitytoolkit.googleapis.com',
        'firestore.googleapis.com',
        'firebaserules.googleapis.com',
        '--project', $projectId,
        '--quiet'
    )

    $accessToken = (& gcloud auth print-access-token).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $accessToken) { throw 'Unable to obtain a Google Cloud access token.' }
    $identityHeaders = @{
        Authorization = "Bearer $accessToken"
        'x-goog-user-project' = $projectId
    }
    $identityConfigUri = "https://identitytoolkit.googleapis.com/admin/v2/projects/$projectId/config"
    $identityConfig = Invoke-RestMethod -Method Get -Uri $identityConfigUri -Headers $identityHeaders
    $authorizedDomains = @(
        @($identityConfig.authorizedDomains) + @($config.auth.authorizedDomains) |
            Where-Object { $_ } |
            Sort-Object -Unique
    )
    if (Compare-Object @($identityConfig.authorizedDomains) $authorizedDomains) {
        $body = @{ authorizedDomains = $authorizedDomains } | ConvertTo-Json
        $patchArguments = @{
            Method = 'Patch'
            Uri = "$identityConfigUri`?updateMask=authorizedDomains"
            Headers = $identityHeaders
            ContentType = 'application/json'
            Body = $body
        }
        Invoke-RestMethod @patchArguments | Out-Null
    }
    try {
        $googleProviderUri = "https://identitytoolkit.googleapis.com/admin/v2/projects/$projectId/defaultSupportedIdpConfigs/google.com"
        $googleProvider = Invoke-RestMethod -Method Get -Uri $googleProviderUri -Headers $identityHeaders
    }
    catch {
        throw 'Google sign-in is not configured. Enable it in Firebase Authentication, then re-run the bootstrap.'
    }
    if (-not $googleProvider.enabled) {
        throw 'Google sign-in exists but is disabled. Enable it in Firebase Authentication, then re-run the bootstrap.'
    }

    $appsResponse = Get-FirebaseResult (Invoke-ExternalJson $firebaseExecutable @('apps:list', 'WEB', '--project', $projectId, '--json'))
    $apps = if ($appsResponse.apps) { @($appsResponse.apps) } else { @($appsResponse) }
    $webApp = $apps | Where-Object { $_.displayName -eq $webAppName } | Select-Object -First 1
    if (-not $webApp) {
        $created = Get-FirebaseResult (Invoke-ExternalJson $firebaseExecutable @('apps:create', 'WEB', $webAppName, '--project', $projectId, '--json'))
        $webApp = $created
    }
    $appId = [string] $(if ($webApp.appId) { $webApp.appId } elseif ($webApp.app_id) { $webApp.app_id } else { $webApp.name })
    if (-not $appId) { throw 'Firebase Web App was found or created, but appId could not be resolved.' }

    $databaseExists = $true
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & gcloud firestore databases describe '--database=(default)' '--project' $projectId '--format=value(name)' 1>$null 2>$null
    $databaseDescribeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($databaseDescribeExitCode -ne 0) { $databaseExists = $false }
    if (-not $databaseExists) {
        Invoke-External 'gcloud' @(
            'firestore', 'databases', 'create',
            '--database=(default)',
            "--location=$databaseRegion",
            '--type=firestore-native',
            '--delete-protection',
            '--project', $projectId,
            '--quiet'
        )
    }

    Invoke-External $firebaseExecutable @(
        'deploy', '--only', 'firestore:rules,firestore:indexes',
        '--project', $projectId,
        '--config', (Join-Path $repoRoot 'firebase.json'),
        '--non-interactive'
    )

    $enabledAppValues = @($config.enabledApps | ForEach-Object { @{ stringValue = [string] $_ } })
    $schemaDocument = @{
        fields = @{
            schemaVersion = @{ integerValue = '1' }
            installationKey = @{ stringValue = [string] $config.installationKey }
            enabledApps = @{ arrayValue = @{ values = $enabledAppValues } }
            updatedAt = @{ timestampValue = [DateTime]::UtcNow.ToString('o') }
        }
    } | ConvertTo-Json -Depth 10
    $schemaUri = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/platformMeta/schema"
    $schemaArguments = @{
        Method = 'Patch'
        Uri = $schemaUri
        Headers = $identityHeaders
        ContentType = 'application/json'
        Body = $schemaDocument
    }
    Invoke-RestMethod @schemaArguments | Out-Null

    $appManifests = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'infrastructure/apps') -Filter '*.json' |
        ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } |
        Where-Object { $_.kind -eq 'frontend-app' })
    foreach ($manifest in $appManifests) {
        $appKey = [string] $manifest.appKey
        $configuredAsEnabled = @($config.enabledApps) -contains $appKey
        $policyUri = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/appPolicies/$appKey"
        $policyExists = $true
        $existingPolicy = $null
        try {
            $existingPolicy = Invoke-RestMethod -Method Get -Uri $policyUri -Headers $identityHeaders
        }
        catch {
            if ($_.Exception.Response.StatusCode -eq [System.Net.HttpStatusCode]::NotFound) {
                $policyExists = $false
            }
            else {
                throw
            }
        }

        $declaredAllowedModes = @(
            @($manifest.access.allowedModes | ForEach-Object { [string] $_ }) + 'admins_only' |
                Select-Object -Unique
        )
        $allowedModeValues = @($declaredAllowedModes | ForEach-Object { @{ stringValue = [string] $_ } })

        if (-not $policyExists) {
            $entitlementValues = @($manifest.access.entitlements | ForEach-Object {
                $fields = @{
                    key = @{ stringValue = [string] $_.key }
                    displayName = @{ stringValue = [string] $_.displayName }
                }
                if ($_.description) { $fields.description = @{ stringValue = [string] $_.description } }
                @{ mapValue = @{ fields = $fields } }
            })
            $policyDocument = @{
                fields = @{
                    appKey = @{ stringValue = [string] $manifest.appKey }
                    displayName = @{ stringValue = [string] $manifest.displayName }
                    accessMode = @{ stringValue = [string] $manifest.access.defaultMode }
                    allowedAccessModes = @{ arrayValue = @{ values = $allowedModeValues } }
                    entitlements = @{ arrayValue = @{ values = $entitlementValues } }
                    adminAllowed = @{ booleanValue = [bool] $manifest.access.adminAllowed }
                    protected = @{ booleanValue = [bool] $manifest.access.protected }
                    updatedAt = @{ timestampValue = [DateTime]::UtcNow.ToString('o') }
                    updatedBy = @{ stringValue = 'installation-bootstrap' }
                }
            } | ConvertTo-Json -Depth 10
            Invoke-RestMethod -Method Patch -Uri $policyUri -Headers $identityHeaders `
                -ContentType 'application/json' -Body $policyDocument | Out-Null
        }
        else {
            $entitlementValues = @($manifest.access.entitlements | ForEach-Object {
                $fields = @{
                    key = @{ stringValue = [string] $_.key }
                    displayName = @{ stringValue = [string] $_.displayName }
                }
                if ($_.description) { $fields.description = @{ stringValue = [string] $_.description } }
                @{ mapValue = @{ fields = $fields } }
            })
            $currentAccessMode = [string] $existingPolicy.fields.accessMode.stringValue
            $nextAccessMode = if ($declaredAllowedModes -contains $currentAccessMode) {
                $currentAccessMode
            }
            else {
                [string] $manifest.access.defaultMode
            }
            $storedAdminAllowed = $existingPolicy.fields.adminAllowed.booleanValue
            $nextAdminAllowed = if ($nextAccessMode -eq 'admins_only') {
                $true
            }
            elseif ($null -ne $storedAdminAllowed) {
                [bool] $storedAdminAllowed
            }
            else {
                [bool] $manifest.access.adminAllowed
            }
            $policyMigration = @{
                fields = @{
                    accessMode = @{ stringValue = $nextAccessMode }
                    allowedAccessModes = @{ arrayValue = @{ values = $allowedModeValues } }
                    entitlements = @{ arrayValue = @{ values = $entitlementValues } }
                    adminAllowed = @{ booleanValue = $nextAdminAllowed }
                }
            } | ConvertTo-Json -Depth 10
            $migrationUri = "$policyUri`?updateMask.fieldPaths=accessMode&updateMask.fieldPaths=allowedAccessModes&updateMask.fieldPaths=entitlements&updateMask.fieldPaths=adminAllowed"
            Invoke-RestMethod -Method Patch -Uri $migrationUri -Headers $identityHeaders `
                -ContentType 'application/json' -Body $policyMigration | Out-Null
        }

        $installationUri = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/appInstallations/$appKey"
        $installationExists = $true
        try {
            Invoke-RestMethod -Method Get -Uri $installationUri -Headers $identityHeaders | Out-Null
        }
        catch {
            if ($_.Exception.Response.StatusCode -eq [System.Net.HttpStatusCode]::NotFound) {
                $installationExists = $false
            }
            else {
                throw
            }
        }
        $requiredServiceValues = @($manifest.requiredServices | ForEach-Object { @{ stringValue = [string] $_ } })
        $installationFields = @{
            appKey = @{ stringValue = $appKey }
            displayName = @{ stringValue = [string] $manifest.displayName }
            category = @{ stringValue = [string] $manifest.lifecycle.category }
            removable = @{ booleanValue = [bool] $manifest.lifecycle.removable }
            protected = @{ booleanValue = [bool] $manifest.access.protected }
            requiredServices = @{ arrayValue = @{ values = $requiredServiceValues } }
            updatedAt = @{ timestampValue = [DateTime]::UtcNow.ToString('o') }
            updatedBy = @{ stringValue = 'installation-bootstrap' }
        }
        if (-not $installationExists) {
            $initialStatus = if ($configuredAsEnabled) { 'installed' } else { 'uninstalled' }
            $installationFields.status = @{ stringValue = $initialStatus }
            $installationDocument = @{ fields = $installationFields } | ConvertTo-Json -Depth 10
            Invoke-RestMethod -Method Patch -Uri $installationUri -Headers $identityHeaders `
                -ContentType 'application/json' -Body $installationDocument | Out-Null
        }
        else {
            $installationMetadata = @{ fields = $installationFields } | ConvertTo-Json -Depth 10
            $fieldMasks = @('appKey', 'displayName', 'category', 'removable', 'protected', 'requiredServices', 'updatedAt', 'updatedBy') |
                ForEach-Object { "updateMask.fieldPaths=$_" }
            $installationMigrationUri = "$installationUri`?" + ($fieldMasks -join '&')
            Invoke-RestMethod -Method Patch -Uri $installationMigrationUri -Headers $identityHeaders `
                -ContentType 'application/json' -Body $installationMetadata | Out-Null
        }
    }

    $sdkResponse = Get-FirebaseResult (Invoke-ExternalJson $firebaseExecutable @('apps:sdkconfig', 'WEB', $appId, '--project', $projectId, '--json'))
    $sdk = if ($sdkResponse.sdkConfig) { $sdkResponse.sdkConfig } else { $sdkResponse }
    $requiredKeys = @('apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId')
    foreach ($key in $requiredKeys) {
        if (-not $sdk.$key) { throw "Firebase SDK configuration is missing $key." }
    }

    $envLines = @(
        "VITE_STRATEXEC_INSTALLATION_KEY=$($config.installationKey)",
        "VITE_FIREBASE_API_KEY=$($sdk.apiKey)",
        "VITE_FIREBASE_AUTH_DOMAIN=$($sdk.authDomain)",
        "VITE_FIREBASE_PROJECT_ID=$($sdk.projectId)",
        "VITE_FIREBASE_STORAGE_BUCKET=$($sdk.storageBucket)",
        "VITE_FIREBASE_MESSAGING_SENDER_ID=$($sdk.messagingSenderId)",
        "VITE_FIREBASE_APP_ID=$($sdk.appId)",
        "VITE_FIREBASE_MEASUREMENT_ID=$($sdk.measurementId)",
        "STRATEXEC_BOOTSTRAP_ADMIN_EMAILS=$($requestedAdmins -join ',')",
        'STRATEXEC_IDENTITY_BASE_URL=http://127.0.0.1:8180',
        'STRATEXEC_ALLOW_UNSIGNED_APP_PACKAGES=true'
    )
    # Windows PowerShell 5.1 writes a UTF-8 BOM with Set-Content -Encoding utf8.
    # Vite/dotenv then treats the BOM-prefixed first key as a different name,
    # which can silently hide VITE_FIREBASE_API_KEY from the browser runtime.
    [System.IO.File]::WriteAllLines(
        (Join-Path $repoRoot '.env.local'),
        [string[]] $envLines,
        [System.Text.UTF8Encoding]::new($false)
    )

    Write-Host ''
    Write-Host 'Firebase Web App, Firestore rules/indexes, and local public SDK config are ready.'
    Write-Host 'Google sign-in is enabled and the manifest authorized domains are present; production OAuth consent still requires review.'
    Write-Host 'No user records, source-project data, OAuth secrets, or service-account keys were copied.'
}
finally {
    Pop-Location
    $env:NODE_OPTIONS = $previousNodeOptions
}
