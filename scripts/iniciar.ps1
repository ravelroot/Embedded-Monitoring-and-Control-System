$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'desktop'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'Node.js 22 ou mais recente nao foi encontrado. Instale em https://nodejs.org e rode de novo.' -ForegroundColor Yellow
    exit 1
}
$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) {
    Write-Host "Node.js $major encontrado. A Malha precisa da versao 22 ou mais recente." -ForegroundColor Yellow
    exit 1
}

Set-Location $desktop
if (-not (Test-Path (Join-Path $desktop 'node_modules'))) {
    Write-Host 'Instalando dependencias (primeira execucao)...' -ForegroundColor Cyan
    npm ci --no-fund --no-audit
}
Write-Host 'Compilando e abrindo a Malha...' -ForegroundColor Cyan
npm start
