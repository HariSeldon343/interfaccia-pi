[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$SourcePath
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $PSCommandPath
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
$vendorScript = Join-Path $scriptRoot 'vendor-sistema-guidato.mjs'
$bundleToken = [string]$env:SISTEMA_GUIDATO_BUNDLE_TOKEN
Remove-Item Env:SISTEMA_GUIDATO_BUNDLE_TOKEN -ErrorAction SilentlyContinue

function Invoke-VendorScript {
  param([Parameter(Mandatory = $true)][string]$Argument)

  & node $vendorScript $Argument
  if ($LASTEXITCODE -ne 0) {
    throw "Vendoring Sistema Guidato non riuscito (exit code $LASTEXITCODE)"
  }
  & node $vendorScript '--check'
  if ($LASTEXITCODE -ne 0) {
    throw "Verifica Sistema Guidato non riuscita (exit code $LASTEXITCODE)"
  }
}

function Assert-SafeTemporaryPath {
  param(
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$TemporaryRoot
  )

  $resolvedCandidate = [System.IO.Path]::GetFullPath($Candidate)
  $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($TemporaryRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $prefix = $resolvedTemporaryRoot + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedCandidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Directory temporanea non confinata: cleanup annullato'
  }
  return $resolvedCandidate
}

$explicitSource = if ($SourcePath) { $SourcePath } else { [string]$env:SISTEMA_GUIDATO_SOURCE }
if ($explicitSource) {
  $resolvedSource = [System.IO.Path]::GetFullPath($explicitSource)
  if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
    throw "Monorepo Sistema Guidato non trovato: $resolvedSource"
  }
  Invoke-VendorScript -Argument "--source=$resolvedSource"
  exit 0
}

$privateRepository = [string]$env:SISTEMA_GUIDATO_BUNDLE_REPOSITORY
$releaseTag = [string]$env:SISTEMA_GUIDATO_BUNDLE_TAG
$assetName = [string]$env:SISTEMA_GUIDATO_BUNDLE_ASSET
$expectedSha256 = ([string]$env:SISTEMA_GUIDATO_BUNDLE_SHA256).ToLowerInvariant()

if ($privateRepository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
  throw 'SISTEMA_GUIDATO_BUNDLE_REPOSITORY deve indicare owner/repository'
}
if (-not $releaseTag -or $releaseTag.Length -gt 120) {
  throw 'SISTEMA_GUIDATO_BUNDLE_TAG obbligatorio o non valido'
}
if ($assetName -notmatch '^[A-Za-z0-9_.-]+\.zip$') {
  throw 'SISTEMA_GUIDATO_BUNDLE_ASSET deve essere il nome semplice di un file .zip'
}
if ($expectedSha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'SISTEMA_GUIDATO_BUNDLE_SHA256 deve essere un digest SHA-256 bloccato'
}
if (-not $bundleToken) {
  throw 'Secret SISTEMA_GUIDATO_BUNDLE_TOKEN assente: download privato rifiutato'
}

$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$workDirectory = Assert-SafeTemporaryPath -Candidate (
  Join-Path $temporaryRoot ("pi-gui-sistema-guidato-" + [guid]::NewGuid().ToString('N'))
) -TemporaryRoot $temporaryRoot
$archivePath = Join-Path $workDirectory $assetName
$extractPath = Join-Path $workDirectory 'estratto'

try {
  New-Item -ItemType Directory -Path $extractPath -Force | Out-Null

  $repoParts = $privateRepository.Split('/')
  $encodedOwner = [uri]::EscapeDataString($repoParts[0])
  $encodedRepository = [uri]::EscapeDataString($repoParts[1])
  $encodedTag = [uri]::EscapeDataString($releaseTag)
  $releaseUri = "https://api.github.com/repos/$encodedOwner/$encodedRepository/releases/tags/$encodedTag"
  $headers = @{
    Authorization = "Bearer $bundleToken"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'interfaccia-pi-bundle-fetcher/2.6.1'
  }
  $release = Invoke-RestMethod -Uri $releaseUri -Headers $headers -Method Get
  $assets = @($release.assets | Where-Object { $_.name -ceq $assetName })
  if ($assets.Count -ne 1) {
    throw 'La release privata non contiene esattamente il file bloccato richiesto'
  }
  $assetUri = [uri]$assets[0].url
  $expectedPrefix = "/repos/$privateRepository/releases/assets/"
  if ($assetUri.Scheme -ne 'https' -or $assetUri.Host -ne 'api.github.com' -or
      -not $assetUri.AbsolutePath.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'URL del file GitHub non conforme al repository bloccato'
  }
  $downloadHeaders = $headers.Clone()
  $downloadHeaders.Accept = 'application/octet-stream'
  Invoke-WebRequest -Uri $assetUri.AbsoluteUri -Headers $downloadHeaders -Method Get -OutFile $archivePath

  $actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -cne $expectedSha256) {
    throw 'Digest SHA-256 del file Sistema Guidato non corrispondente'
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $required = @('runtime', 'release-manifest.json', 'pi-package-compatibility.json')
  $topLevel = @(Get-ChildItem -LiteralPath $extractPath | Select-Object -ExpandProperty Name)
  if ($topLevel.Count -ne $required.Count -or @($required | Where-Object { $_ -notin $topLevel }).Count -ne 0) {
    throw 'Layout del file Sistema Guidato non valido'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $extractPath 'runtime') -PathType Container) -or
      -not (Test-Path -LiteralPath (Join-Path $extractPath 'release-manifest.json') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $extractPath 'pi-package-compatibility.json') -PathType Leaf)) {
    throw 'Asset Sistema Guidato incompleto'
  }

  Invoke-VendorScript -Argument "--artifact-root=$extractPath"
}
finally {
  if (Test-Path -LiteralPath $workDirectory) {
    $safeWorkDirectory = Assert-SafeTemporaryPath -Candidate $workDirectory -TemporaryRoot $temporaryRoot
    Remove-Item -LiteralPath $safeWorkDirectory -Recurse -Force
  }
}
