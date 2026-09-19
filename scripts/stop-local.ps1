[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $repoRoot '.stratexec\local-runtime'
$processStatePath = Join-Path $runtimeDirectory 'processes.json'

if (-not (Test-Path -LiteralPath $processStatePath)) {
    Write-Host '沒有由 StratExec 本地啟動器管理的執行中服務。'
    exit 0
}

$state = Get-Content -LiteralPath $processStatePath -Raw | ConvertFrom-Json
$stopped = @()

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int] $ProcessId)

    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" `
        -ErrorAction SilentlyContinue)
    foreach ($child in $children) { Stop-ProcessTree -ProcessId ([int] $child.ProcessId) }
    Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}

foreach ($entry in @($state.identity, $state.frontend)) {
    if (-not $entry -or -not $entry.pid) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int] $entry.pid)" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if ([string] $process.CommandLine -notmatch [regex]::Escape($repoRoot)) {
        throw "Refusing to stop PID $($entry.pid) because it does not belong to this StratExec checkout."
    }
    Stop-ProcessTree -ProcessId ([int] $entry.pid)
    $stopped += [int] $entry.pid
}

Remove-Item -LiteralPath $processStatePath -Force
Write-Host "已停止 StratExec 本地服務。PID：$($stopped -join ', ')" -ForegroundColor Green
