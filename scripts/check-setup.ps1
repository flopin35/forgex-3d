# Checks that this Windows PC has what FORGEX 3D needs to run and build.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1

$ErrorActionPreference = 'SilentlyContinue'
$missing = 0

function Report($name, $ok, $detail, $fix) {
  if ($ok) {
    Write-Host ("  [ok]      {0,-28} {1}" -f $name, $detail) -ForegroundColor Green
  } else {
    Write-Host ("  [missing] {0,-28} {1}" -f $name, $fix) -ForegroundColor Yellow
    $script:missing++
  }
}

Write-Host ""
Write-Host "FORGEX 3D setup check" -ForegroundColor Cyan
Write-Host ""

$node = (node --version) 2>$null
$nodeMajor = 0
if ($node) { $nodeMajor = [int]($node.TrimStart('v').Split('.')[0]) }
Report "Node.js 20 or newer" ($nodeMajor -ge 20) $node "Install the LTS version from https://nodejs.org"

$npm = (npm --version) 2>$null
Report "npm" ([bool]$npm) $npm "Comes with Node.js"

$rustc = (rustc --version) 2>$null
Report "Rust compiler" ([bool]$rustc) $rustc "Install from https://rustup.rs (choose the default MSVC option)"

$cargo = (cargo --version) 2>$null
Report "Cargo" ([bool]$cargo) $cargo "Comes with Rust"

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msvc = $null
if (Test-Path $vswhere) {
  $msvc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
}
Report "Microsoft C++ Build Tools" ([bool]$msvc) $msvc "Install 'Desktop development with C++' from https://visualstudio.microsoft.com/visual-cpp-build-tools/"

$webview = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' 2>$null
if (-not $webview) { $webview = Get-ItemProperty 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' 2>$null }
Report "WebView2 runtime" ([bool]$webview) $webview.pv "Install from https://developer.microsoft.com/microsoft-edge/webview2/"

Write-Host ""
if ((Get-Location).Path -like '*OneDrive*') {
  Write-Host "  Note: this folder is synced by OneDrive. If installs or builds fail with 'EBUSY'," -ForegroundColor DarkYellow
  Write-Host "  'EPERM' or 'access denied', pause OneDrive syncing or move the project to e.g. C:\dev\forgex-3d." -ForegroundColor DarkYellow
  Write-Host ""
}

if ($missing -eq 0) {
  Write-Host "Everything is installed. Next: npm install, then npm run desktop" -ForegroundColor Green
} elseif ($nodeMajor -ge 20) {
  Write-Host "$missing item(s) missing. You can already run the tests and the browser preview:" -ForegroundColor Yellow
  Write-Host "  npm install; npm test; npm run dev"
  Write-Host "Install the missing items, open a new terminal, and run this check again for the desktop app."
} else {
  Write-Host "$missing item(s) missing. Install them, open a new terminal, and run this check again." -ForegroundColor Yellow
}
Write-Host ""
