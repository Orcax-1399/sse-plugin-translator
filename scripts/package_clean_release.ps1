param(
    [string]$OutputDir,
    [switch]$NoZip
)

$ErrorActionPreference = 'Stop'

function Get-UniqueOutputDir {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseDir
    )

    if (-not (Test-Path -LiteralPath $BaseDir)) {
        return $BaseDir
    }

    for ($i = 1; $i -le 99; $i++) {
        $candidate = '{0}-{1:D2}' -f $BaseDir, $i
        if (-not (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    throw "Cannot find available output directory for: $BaseDir"
}

function Get-UniqueFilePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BasePath
    )

    if (-not (Test-Path -LiteralPath $BasePath)) {
        return $BasePath
    }

    $directory = [System.IO.Path]::GetDirectoryName($BasePath)
    $fileName = [System.IO.Path]::GetFileNameWithoutExtension($BasePath)
    $extension = [System.IO.Path]::GetExtension($BasePath)

    for ($i = 1; $i -le 99; $i++) {
        $candidate = Join-Path $directory ('{0}-{1:D2}{2}' -f $fileName, $i, $extension)
        if (-not (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    throw "Cannot find available output file path for: $BasePath"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseDir = Join-Path $repoRoot 'src-tauri\target\release'
$sourceExe = Join-Path $releaseDir 'sse-plugin-translator.exe'
$sourceUserdata = Join-Path $releaseDir 'userdata'

if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw "Release executable not found: $sourceExe"
}

if (-not (Test-Path -LiteralPath $sourceUserdata)) {
    throw "Source userdata directory not found: $sourceUserdata"
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $outputRoot = Join-Path $repoRoot 'release-output'
    $packageDir = Get-UniqueOutputDir -BaseDir (Join-Path $outputRoot 'portable-clean')
} elseif ([System.IO.Path]::IsPathRooted($OutputDir)) {
    if (Test-Path -LiteralPath $OutputDir) {
        throw "Output directory already exists: $OutputDir"
    }
    $packageDir = $OutputDir
} else {
    $resolvedOutput = Join-Path $repoRoot $OutputDir
    if (Test-Path -LiteralPath $resolvedOutput) {
        throw "Output directory already exists: $resolvedOutput"
    }
    $packageDir = $resolvedOutput
}

$targetUserdata = Join-Path $packageDir 'userdata'
$zipPath = Get-UniqueFilePath -BasePath ("{0}.zip" -f $packageDir)

New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination $packageDir -Force
Copy-Item -LiteralPath $sourceUserdata -Destination $targetUserdata -Recurse -Force

$translationsDb = Join-Path $targetUserdata 'translations.db'
if (-not (Test-Path -LiteralPath $translationsDb)) {
    Write-Warning "translations.db not found in copied userdata: $translationsDb"
}

Get-ChildItem -LiteralPath $targetUserdata -Force |
    Where-Object { $_.Name -ne 'translations.db' } |
    Remove-Item -Force -Recurse

if (-not $NoZip) {
    Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -CompressionLevel Optimal
}

Write-Host ''
Write-Host 'Package created successfully:'
Write-Host "  $packageDir"
Write-Host ''
Write-Host 'Included files:'
Write-Host "  $(Join-Path $packageDir 'sse-plugin-translator.exe')"
Write-Host "  $translationsDb"
if (-not $NoZip) {
    Write-Host "  $zipPath"
}
