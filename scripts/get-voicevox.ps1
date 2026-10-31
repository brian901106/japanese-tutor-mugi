# get-voicevox.ps1: 下載並解壓縮 VOICEVOX ENGINE（選用，Windows）。
# Downloads and unpacks the VOICEVOX ENGINE (optional, Windows) from its GitHub Releases.
# 引擎不屬於本專案的 MIT 授權，有它自己的使用條款，各角色聲音也有各自的條款（請以 VOICEVOX:角色名 標註）。
# The engine is NOT covered by this repo's MIT licence. It has its own terms of use, and each voice character has its own terms (credit as VOICEVOX:<character name>).
# 這是方便用的腳本；如果壞了（例如官方改了檔名），請參閱 README 的『安裝 VOICEVOX 引擎（選用）』段落手動安裝。
# This is a convenience script; if it breaks (for example the release file names change), follow the 'Installing the VOICEVOX engine (optional)' section in the README.
param(
    [ValidateSet('cpu', 'directml', 'nvidia')]
    [string]$Variant = 'cpu',
    [string]$Version = '',
    [string]$Dest = '',
    [string]$Archive = '',
    [switch]$DryRun,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Hint = '如果這個腳本失敗，請照 README「安裝 VOICEVOX 引擎（選用）」手動安裝。 / If this script fails, follow "Installing the VOICEVOX engine (optional)" in README.en.md.'
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Dest) { $Dest = Join-Path $RepoRoot 'voicevox_engine' }
$Dest = [IO.Path]::GetFullPath($Dest)
$DefaultDest = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'voicevox_engine'))
$DlDir = Join-Path $Dest '.download'
$CreatedDownload = $false

function Stop-Script([string]$Message) {
    if ($script:CreatedDownload -and (Test-Path -LiteralPath $script:DlDir)) {
        Remove-Item -LiteralPath $script:DlDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host ('錯誤 / ERROR: ' + $Message) -ForegroundColor Red
    Write-Host $Hint -ForegroundColor Yellow
    exit 1
}

function Find-EngineExe([string]$Folder) {
    if (-not (Test-Path -LiteralPath $Folder)) { return $null }
    return (Get-ChildItem -LiteralPath $Folder -Recurse -Filter 'run.exe' -File -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } | Select-Object -First 1)
}

try {
    $existing = Find-EngineExe $Dest
    if ($existing) {
        Write-Host ('已經有引擎 / Engine already present: ' + $existing.FullName)
        Write-Host ('VOICEVOX_DIR = ' + $existing.DirectoryName)
        Write-Host ('若要重裝，請先刪除 ' + $Dest + ' 裡的檔案 / To reinstall, delete the files in ' + $Dest + ' first.')
        Stop-Script '拒絕覆蓋既有的引擎 / refusing to overwrite the existing engine.'
    }

    if ($Archive) {
        # 使用已下載的 .vvpp，不查 API、不驗證雜湊 / Use an already-downloaded .vvpp; no API call, no hash check.
        if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { Stop-Script ('找不到檔案 / archive not found: ' + $Archive) }
        $Zip = [IO.Path]::GetFullPath($Archive)
        if ($DryRun) {
            Write-Host ('[dry run] 會解壓縮 / would extract ' + $Zip + ' into ' + $Dest)
            exit 0
        }
        New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    }
    else {
        $api = 'https://api.github.com/repos/VOICEVOX/voicevox_engine/releases/latest'
        if ($Version) { $api = 'https://api.github.com/repos/VOICEVOX/voicevox_engine/releases/tags/' + $Version }
        Write-Host ('查詢 / Querying ' + $api)
        $release = Invoke-RestMethod -Uri $api -UserAgent 'mugi-tutor' -Headers @{ Accept = 'application/vnd.github+json' }

        $prefix = 'voicevox_engine-windows-' + $Variant + '-'
        $cands = @($release.assets | Where-Object { $_.name.StartsWith($prefix) })
        if ($Variant -eq 'nvidia') {
            $sel = @($cands | Where-Object { $_.name -match '\.\d{3}\.vvppp$' } | Sort-Object name)
        }
        else {
            $sel = @($cands | Where-Object { $_.name -match '\.vvpp$' } | Sort-Object name)
            if ($sel.Count -gt 1) { Stop-Script ('找到多個檔案 / more than one asset matches: ' + $prefix) }
        }
        if ($sel.Count -eq 0) { Stop-Script ('找不到 ' + $prefix + '* 的檔案 / no ' + $prefix + '* assets in release ' + $release.tag_name) }

        $total = [int64]0
        foreach ($a in $sel) { $total += [int64]$a.size }
        $totalMB = [math]::Round($total / 1MB)

        Write-Host ('版本 / Version: ' + $release.tag_name)
        foreach ($a in $sel) {
            Write-Host ('  ' + $a.name + '  (' + [math]::Round([int64]$a.size / 1MB) + ' MB)')
            Write-Host ('    ' + $a.browser_download_url)
        }
        Write-Host ('目的資料夾 / Destination: ' + $Dest)
        Write-Host ('合計 / Total: about ' + $totalMB + ' MB')

        if ($DryRun) {
            Write-Host '[dry run] 沒有下載任何檔案 / no files downloaded.'
            exit 0
        }
        if (-not $Yes) {
            $ans = Read-Host ('Download about ' + $totalMB + ' MB? [y/N]')
            if ($ans -notmatch '^(y|yes)$') {
                Write-Host '已取消 / Cancelled.'
                exit 0
            }
        }

        New-Item -ItemType Directory -Force -Path $Dest | Out-Null
        if (Test-Path -LiteralPath $DlDir) { Remove-Item -LiteralPath $DlDir -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $DlDir | Out-Null
        $script:CreatedDownload = $true

        $hasCurl = [bool](Get-Command curl.exe -ErrorAction SilentlyContinue)
        $files = @()
        foreach ($a in $sel) {
            $out = Join-Path $DlDir $a.name
            Write-Host ('下載 / Downloading ' + $a.name)
            if ($hasCurl) {
                & curl.exe -L --fail --retry 3 -o $out $a.browser_download_url
                if ($LASTEXITCODE -ne 0) { Stop-Script ('下載失敗 / download failed: ' + $a.name) }
            }
            else {
                Invoke-WebRequest -Uri $a.browser_download_url -OutFile $out -UserAgent 'mugi-tutor' -UseBasicParsing
            }

            $digest = [string]$a.digest
            if (-not $digest.StartsWith('sha256:')) { Stop-Script ('沒有 SHA-256 資料可以驗證 / no sha256 digest to verify: ' + $a.name) }
            $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash
            if ($got -ine $digest.Substring(7)) { Stop-Script ('SHA-256 不符 / SHA-256 mismatch: ' + $a.name) }
            $files += $out
        }

        if ($Variant -eq 'nvidia') {
            $base = $sel[0].name -replace '\.\d{3}\.vvppp$', '.vvpp'
            $Zip = Join-Path $DlDir $base
            Write-Host ('合併分割檔 / Joining parts into ' + $base)
            $outStream = [IO.File]::Create($Zip)
            try {
                foreach ($f in $files) {
                    $inStream = [IO.File]::OpenRead($f)
                    try { $inStream.CopyTo($outStream) } finally { $inStream.Dispose() }
                }
            }
            finally { $outStream.Dispose() }
        }
        else {
            $Zip = $files[0]
        }
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Write-Host ('解壓縮 / Extracting into ' + $Dest)
    try {
        [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Dest)
    }
    catch {
        Stop-Script ('解壓縮失敗 / extraction failed: ' + $_.Exception.Message + '（若 ' + $Dest + ' 裡有上次中斷留下的檔案，請先刪掉 / delete leftovers from an earlier failed run first）')
    }

    $exe = Find-EngineExe $Dest
    if (-not $exe) { Stop-Script ('解壓縮後找不到 run.exe / run.exe not found after extraction in ' + $Dest) }
    $folder = $exe.DirectoryName

    if ($script:CreatedDownload) {
        Remove-Item -LiteralPath $DlDir -Recurse -Force
        $script:CreatedDownload = $false
    }

    Write-Host ''
    Write-Host ('完成 / Done. 引擎資料夾 / Engine folder: ' + $folder)
    # the default folder (run.exe there or one sub-folder down) is found by the dev server: no setting needed
    $inDefault = ($Dest -eq $DefaultDest) -and (($folder -eq $Dest) -or ((Split-Path -Parent $folder) -eq $Dest))
    if ($inDefault) {
        Write-Host '已放在預設位置，不用設定 VOICEVOX_DIR，直接 npm run dev / Installed in the default place: no VOICEVOX_DIR needed, just run npm run dev.'
    } else {
        Write-Host ('VOICEVOX_DIR = ' + $folder)
        Write-Host '在專案資料夾的 PowerShell 複製下面這一行來啟動 / Copy this line into PowerShell in the project folder:'
        Write-Host ('$env:VOICEVOX_DIR = "' + $folder + '"; npm run dev')
    }
}
catch {
    Stop-Script $_.Exception.Message
}
