[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts')
)

$ErrorActionPreference = 'Stop'
$radice = Split-Path $PSScriptRoot -Parent
$pacchetto = Get-Content -LiteralPath (Join-Path $radice 'package.json') -Raw | ConvertFrom-Json
$versione = [string]$pacchetto.version
if ($versione -notmatch '^\d+\.\d+\.\d+$') {
    throw "Versione non valida in package.json: $versione"
}

$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$nome = "Interfaccia-pi-$versione-sorgente-completo"
$archivio = Join-Path $output "$nome.zip"
$hashFile = Join-Path $output 'SORGENTE-SHA256.txt'
$temporanea = Join-Path ([IO.Path]::GetTempPath()) ("pi-gui-source-" + [guid]::NewGuid().ToString('N'))
$staging = Join-Path $temporanea $nome

$fileRadice = @(
    '.gitattributes',
    '.gitignore',
    '.graphifyignore',
    'avvia-pi-locale.bat',
    'avvia.mjs',
    'CHANGELOG.md',
    'COMPILA-SU-ALTRO-PC.md',
    'DISTRIBUZIONE-E-AGGIORNAMENTI.md',
    'GUIDA-PI.md',
    'icona.png',
    'Interfaccia pi.bat',
    'LICENSE',
    'LEGGIMI.md',
    'package-lock.json',
    'package.json',
    'README.md',
    'rust-toolchain.toml',
    'SECURITY.md'
)
$cartelle = @('.github', 'app', 'licenses', 'scripts', 'src-tauri', 'tests', 'vendor')

try {
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    foreach ($file in $fileRadice) {
        $sorgente = Join-Path $radice $file
        if (-not (Test-Path -LiteralPath $sorgente -PathType Leaf)) {
            throw "File richiesto mancante: $file"
        }
        Copy-Item -LiteralPath $sorgente -Destination (Join-Path $staging $file) -Force
    }
    foreach ($cartella in $cartelle) {
        $sorgente = Join-Path $radice $cartella
        if (-not (Test-Path -LiteralPath $sorgente -PathType Container)) {
            throw "Cartella richiesta mancante: $cartella"
        }
        Copy-Item -LiteralPath $sorgente -Destination (Join-Path $staging $cartella) -Recurse -Force
    }

    Get-ChildItem -LiteralPath (Join-Path $staging 'src-tauri') -Directory -Filter 'target*' -ErrorAction SilentlyContinue |
        ForEach-Object {
            $risolto = [IO.Path]::GetFullPath($_.FullName)
            if (-not $risolto.StartsWith([IO.Path]::GetFullPath($staging), [StringComparison]::OrdinalIgnoreCase)) {
                throw "Target temporaneo fuori staging: $risolto"
            }
            Remove-Item -LiteralPath $risolto -Recurse -Force
        }
    Remove-Item -LiteralPath (Join-Path $staging 'vendor\pi-runtime\.pi-runtime.lock') -Force -ErrorAction SilentlyContinue

    Remove-Item -LiteralPath $archivio -Force -ErrorAction SilentlyContinue
    Compress-Archive -LiteralPath $staging -DestinationPath $archivio -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $archivio -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $hashFile -Value "$hash  $([IO.Path]::GetFileName($archivio))" -Encoding utf8
    [pscustomobject]@{
        Versione = $versione
        Archivio = $archivio
        Sha256 = $hash
        DimensioneMiB = [Math]::Round((Get-Item -LiteralPath $archivio).Length / 1MB, 1)
    }
}
finally {
    if (Test-Path -LiteralPath $temporanea) {
        $risolto = [IO.Path]::GetFullPath($temporanea)
        $radiceTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($risolto.StartsWith($radiceTemp, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $risolto -Recurse -Force
        }
    }
}
