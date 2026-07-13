# Convenience wrapper — delegates to the standalone hermes-a2a repo's link script.
# Default HERMES_HOME: %LOCALAPPDATA%\hermes (matches install.ps1 / desktop default).
# Default hermes-a2a root: sibling directory next to hermes-desktop (../hermes-a2a).
# Override with -HermesA2aRoot or HERMES_A2A_ROOT (for packaged installs).
# @lat: [[a2a-integration#A2A integration]]

param(
    [string]$HermesHome = "$env:LOCALAPPDATA\hermes",
    [string]$HermesA2aRoot = ""
)

$ErrorActionPreference = "Stop"

function Resolve-HermesA2aRoot {
    param([string]$Override)

    if ($Override) {
        return (Resolve-Path $Override).Path
    }
    if ($env:HERMES_A2A_ROOT) {
        return (Resolve-Path $env:HERMES_A2A_ROOT).Path
    }

    $desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $sibling = Join-Path (Split-Path $desktopRoot -Parent) "hermes-a2a"
    if (Test-Path $sibling) {
        return (Resolve-Path $sibling).Path
    }

    throw @"
hermes-a2a not found.
  Expected sibling: $sibling
  Or pass -HermesA2aRoot, or set HERMES_A2A_ROOT.
"@
}

$HermesA2aRoot = Resolve-HermesA2aRoot -Override $HermesA2aRoot
$linkScript = Join-Path $HermesA2aRoot "scripts\link-to-hermes-home.ps1"
if (-not (Test-Path $linkScript)) {
    throw "hermes-a2a link script not found at $linkScript"
}

Write-Host "Using hermes-a2a root: $HermesA2aRoot"
& $linkScript -HermesHome $HermesHome
