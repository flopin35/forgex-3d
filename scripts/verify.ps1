# Installs dependencies (first run only), runs every automated check and writes a log.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
# The log goes to logs\verify.log so it can be shared when something fails.

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force -Path logs | Out-Null
$log = Join-Path $root 'logs\verify.log'
"FORGEX 3D verification $(Get-Date -Format s)" | Out-File $log -Encoding utf8

function Step($title, $command) {
  Write-Host "== $title" -ForegroundColor Cyan
  "`n== $title`n> $command" | Out-File $log -Append -Encoding utf8
  $output = cmd /c "$command 2>&1"
  $code = $LASTEXITCODE
  $output | Out-File $log -Append -Encoding utf8
  "exit code: $code" | Out-File $log -Append -Encoding utf8
  if ($code -eq 0) { Write-Host "   passed" -ForegroundColor Green } else { Write-Host "   FAILED (see logs\verify.log)" -ForegroundColor Red }
  return $code
}

$failed = 0
"node $(node --version), npm $(npm --version)" | Out-File $log -Append -Encoding utf8
if (-not (Test-Path node_modules)) { $failed += [int]((Step 'Install dependencies' 'npm install') -ne 0) }
$failed += [int]((Step 'Unit tests, including the FORGEX Cube Test' 'npm test') -ne 0)
$failed += [int]((Step 'Type check and production build' 'npm run build') -ne 0)
if (Get-Command cargo -ErrorAction SilentlyContinue) {
  $failed += [int]((Step 'Rust file-safety tests' 'cd src-tauri && cargo test') -ne 0)
} else {
  "`n== Rust tests skipped: cargo is not installed" | Out-File $log -Append -Encoding utf8
  Write-Host "== Rust tests skipped: install Rust from https://rustup.rs" -ForegroundColor Yellow
}

"`nfailed steps: $failed" | Out-File $log -Append -Encoding utf8
if ($failed -eq 0) { Write-Host "`nAll checks passed." -ForegroundColor Green } else { Write-Host "`n$failed step(s) failed. Details: logs\verify.log" -ForegroundColor Red }
