$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'desktop'

Set-Location $desktop
Write-Host 'Instalando dependencias...' -ForegroundColor Cyan
npm ci --no-fund --no-audit
Write-Host 'Rodando verificacao de tipos e testes...' -ForegroundColor Cyan
npm run typecheck
npm test
Write-Host 'Gerando instalador e versao portatil...' -ForegroundColor Cyan
npm run dist

$version = (Get-Content (Join-Path $root 'VERSION')).Trim()
foreach ($file in @("Malha-Setup-$version.exe", "Malha-$version-portatil.exe")) {
    $source = Join-Path $desktop "release\$file"
    if (Test-Path $source) {
        Copy-Item $source (Join-Path $root $file) -Force
        Write-Host "Pronto: $file" -ForegroundColor Green
    }
}
