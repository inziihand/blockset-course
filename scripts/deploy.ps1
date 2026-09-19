[CmdletBinding()]
param(
    [string] $ConfigPath,

    [switch] $FinalizeAdmin,

    [string[]] $BootstrapAdminEmails = @(),

    [switch] $ConfirmBillableResources,

    [switch] $ConfirmPublicIngress
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localSettingsPath = Join-Path $repoRoot '.stratexec\local-runtime\settings.json'
if (-not (Test-Path -LiteralPath $localSettingsPath)) {
    throw 'Local installation has not completed. Run scripts/install.ps1 and finish local testing before deployment.'
}
$localSettings = Get-Content -LiteralPath $localSettingsPath -Raw | ConvertFrom-Json
$installedConfig = [string] (Resolve-Path -LiteralPath ([string] $localSettings.configPath))
$installedAdmin = [string] $localSettings.bootstrapAdminEmail
if (-not $ConfigPath) {
    $ConfigPath = $installedConfig
}
elseif ([string] (Resolve-Path -LiteralPath $ConfigPath) -ne $installedConfig) {
    throw 'The requested deployment config is not the locally installed and tested config. Run scripts/install.ps1 for that config first.'
}
if ($BootstrapAdminEmails.Count -eq 0 -and $installedAdmin) {
    $BootstrapAdminEmails = @($installedAdmin)
}

$installer = Join-Path $PSScriptRoot 'install.ps1'
$arguments = @{
    ConfigPath = $ConfigPath
    BootstrapAdminEmails = $BootstrapAdminEmails
    ConfirmBillableResources = $ConfirmBillableResources
    ConfirmPublicIngress = $ConfirmPublicIngress
}
if ($FinalizeAdmin) { $arguments.FinalizeAdmin = $true }
else { $arguments.Apply = $true }

& $installer @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
