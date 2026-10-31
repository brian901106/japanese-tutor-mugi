#!/usr/bin/env bash
# 下載並解壓縮 VOICEVOX ENGINE（選用，macOS／Linux）。Downloads and unpacks the VOICEVOX ENGINE (optional, macOS / Linux) from its GitHub Releases.
# 引擎不屬於本專案的 MIT 授權，有它自己的使用條款，各角色聲音也有各自的條款（請以 VOICEVOX:角色名 標註）。
# The engine is NOT covered by this repo's MIT licence. It has its own terms of use, and each voice character has its own terms (credit as VOICEVOX:<character name>).
# 這是方便用的腳本；如果壞了（例如官方改了檔名），請參閱 README 的『安裝 VOICEVOX 引擎（選用）』段落手動安裝。
# This is a convenience script; if it breaks (for example the release file names change), follow the 'Installing the VOICEVOX engine (optional)' section in the README.
set -euo pipefail

HINT='如果這個腳本失敗，請照 README「安裝 VOICEVOX 引擎（選用）」手動安裝。 / If this script fails, follow "Installing the VOICEVOX engine (optional)" in README.en.md.'

die() {
  echo "錯誤 / ERROR: $*" >&2
  echo "$HINT" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: bash scripts/get-voicevox.sh [--variant cpu|nvidia] [--version V] [--dest DIR]
                                    [--archive FILE] [--dry-run] [--yes]
EOF
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Parses the GitHub release JSON into TAG / ASSET / ERROR lines (tab separated).
PY_CODE='import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
if "assets" not in d:
    print("ERROR\t" + str(d.get("message", "no assets")))
    sys.exit(0)
print("TAG\t" + str(d.get("tag_name", "")))
for a in d["assets"]:
    print("\t".join(["ASSET", a["name"], str(a["size"]), a["browser_download_url"], a.get("digest") or ""]))'

JS_CODE='const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(d.assets)) { console.log("ERROR\t" + (d.message || "no assets")); process.exit(0); }
console.log("TAG\t" + (d.tag_name || ""));
for (const a of d.assets) console.log(["ASSET", a.name, a.size, a.browser_download_url, a.digest || ""].join("\t"));'

variant=cpu
version=""
dest=""
archive=""
dry_run=0
yes=0
tmp_dir=""
dl_dir=""
created_dl=0

cleanup() {
  if [ -n "$tmp_dir" ]; then rm -rf -- "$tmp_dir"; fi
  if [ "$created_dl" = 1 ] && [ -n "$dl_dir" ]; then rm -rf -- "$dl_dir"; fi
}
trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --variant) variant="${2:-}"; shift 2 ;;
    --version) version="${2:-}"; shift 2 ;;
    --dest) dest="${2:-}"; shift 2 ;;
    --archive) archive="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --yes|-y) yes=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

case "$variant" in
  cpu|nvidia) ;;
  *) die "--variant must be cpu or nvidia (got: $variant)" ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(dirname "$script_dir")"
if [ -z "$dest" ]; then dest="$repo_root/voicevox_engine"; fi
dl_dir="$dest/.download"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    die "這是 Windows 環境：請改用 PowerShell 執行 scripts/get-voicevox.ps1 / Windows detected: use scripts/get-voicevox.ps1 in PowerShell instead." ;;
  Darwin) os_key=macos ;;
  Linux) os_key=linux ;;
  *) die "不支援的系統 / unsupported OS: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) die "不支援的 CPU / unsupported CPU: $(uname -m)" ;;
esac

multi=0
if [ "$os_key" = macos ]; then
  [ "$variant" = cpu ] || die "macOS 只有 cpu 版本 / the nvidia variant is not available on macOS"
  prefix="voicevox_engine-macos-$arch-"
elif [ "$variant" = nvidia ]; then
  [ "$arch" = x64 ] || die "nvidia 版本只有 Linux x64 / the nvidia variant is Linux x64 only"
  prefix="voicevox_engine-linux-nvidia-"
  multi=1
else
  prefix="voicevox_engine-linux-cpu-$arch-"
fi

# 不覆蓋既有的引擎 / Refuse to overwrite an existing engine.
existing="$(find "$dest" -maxdepth 2 -name run -type f 2>/dev/null | head -n 1 || true)"
if [ -n "$existing" ]; then
  echo "已經有引擎 / Engine already present: $existing" >&2
  echo "VOICEVOX_DIR = $(cd "$(dirname "$existing")" && pwd)" >&2
  die "拒絕覆蓋既有的引擎 / refusing to overwrite the existing engine. To reinstall, delete the files in $dest first."
fi

if [ -n "$archive" ]; then
  # 使用已下載的 .vvpp，不查 API、不驗證雜湊 / Use an already-downloaded archive; no API call, no hash check.
  [ -f "$archive" ] || die "找不到檔案 / archive not found: $archive"
  zip="$archive"
  if [ "$dry_run" = 1 ]; then
    echo "[dry run] 會解壓縮 / would extract $archive into $dest"
    exit 0
  fi
else
  command -v curl >/dev/null 2>&1 || die "需要 curl / curl is required"
  command -v unzip >/dev/null 2>&1 || die "需要 unzip / unzip is required"

  api="https://api.github.com/repos/VOICEVOX/voicevox_engine/releases/latest"
  if [ -n "$version" ]; then api="https://api.github.com/repos/VOICEVOX/voicevox_engine/releases/tags/$version"; fi

  tmp_dir="$(mktemp -d)"
  json="$tmp_dir/release.json"
  parsed="$tmp_dir/parsed.tsv"
  sel="$tmp_dir/selected.tsv"

  echo "查詢 / Querying $api"
  curl -fsSL -H "User-Agent: mugi-tutor" -H "Accept: application/vnd.github+json" -o "$json" "$api" \
    || die "無法查詢 GitHub 發行版 / cannot query GitHub releases: $api"

  if command -v python3 >/dev/null 2>&1; then
    python3 -I -c "$PY_CODE" "$json" > "$parsed" || die "無法解析 JSON / cannot parse the release JSON"
  elif command -v node >/dev/null 2>&1; then
    node -e "$JS_CODE" "$json" > "$parsed" || die "無法解析 JSON / cannot parse the release JSON"
  else
    die "需要 python3 或 node 來解析 JSON / python3 or node is required to parse the JSON"
  fi

  if grep -q '^ERROR' "$parsed"; then
    die "GitHub 回應錯誤 / GitHub error: $(awk -F'\t' '$1=="ERROR"{print $2}' "$parsed")"
  fi
  tag="$(awk -F'\t' '$1=="TAG"{print $2}' "$parsed")"

  awk -F'\t' -v p="$prefix" -v multi="$multi" '
    $1 == "ASSET" {
      n = $2
      if (index(n, p) != 1) next
      if (multi == 1) { if (n !~ /\.[0-9][0-9][0-9]\.vvppp$/) next }
      else { if (n !~ /\.vvpp$/) next }
      print $2 "\t" $3 "\t" $4 "\t" $5
    }' "$parsed" | sort > "$sel"

  [ -s "$sel" ] || die "找不到 ${prefix}* 的檔案 / no ${prefix}* assets in release $tag"
  if [ "$multi" = 0 ] && [ "$(wc -l < "$sel" | tr -d ' ')" != 1 ]; then
    die "找到多個檔案 / more than one asset matches ${prefix}*"
  fi

  total=0
  while IFS=$'\t' read -r name size url digest; do
    total=$((total + size))
    printf '  %s  (%d MB)\n    %s\n' "$name" $(( (size + 524288) / 1048576 )) "$url"
  done < "$sel"
  total_mb=$(( (total + 524288) / 1048576 ))
  echo "版本 / Version: $tag"
  echo "目的資料夾 / Destination: $dest"
  echo "合計 / Total: about ${total_mb} MB"

  if [ "$dry_run" = 1 ]; then
    echo "[dry run] 沒有下載任何檔案 / no files downloaded."
    exit 0
  fi

  if [ "$yes" != 1 ]; then
    printf 'Download about %d MB? [y/N] ' "$total_mb"
    ans=""
    read -r ans < /dev/tty || true
    case "$ans" in
      y|Y|yes|YES) ;;
      *) echo "已取消 / Cancelled."; exit 0 ;;
    esac
  fi

  mkdir -p "$dest"
  rm -rf -- "$dl_dir"
  mkdir -p "$dl_dir"
  created_dl=1

  files=()
  while IFS=$'\t' read -r name size url digest; do
    out="$dl_dir/$name"
    echo "下載 / Downloading $name"
    curl -fL --retry 3 -o "$out" "$url" || die "下載失敗 / download failed: $name"
    case "$digest" in
      sha256:*) ;;
      *) die "沒有 SHA-256 資料可以驗證 / no sha256 digest to verify: $name" ;;
    esac
    got="$(sha256_file "$out")"
    [ "$got" = "${digest#sha256:}" ] || die "SHA-256 不符 / SHA-256 mismatch: $name"
    files+=("$out")
  done < "$sel"

  if [ "$multi" = 1 ]; then
    first_name="$(basename "${files[0]}")"
    zip="$dl_dir/${first_name%.001.vvppp}.vvpp"
    echo "合併分割檔 / Joining parts into $(basename "$zip")"
    cat "${files[@]}" > "$zip"
  else
    zip="${files[0]}"
  fi
fi

echo "解壓縮 / Extracting into $dest"
unzip -q -o "$zip" -d "$dest" || die "解壓縮失敗 / extraction failed"

run_path="$(find "$dest" -maxdepth 2 -name run -type f -not -path "$dl_dir/*" 2>/dev/null | head -n 1 || true)"
[ -n "$run_path" ] || die "解壓縮後找不到 run / run not found after extraction in $dest"
chmod +x "$run_path"
folder="$(cd "$(dirname "$run_path")" && pwd)"

if [ "$created_dl" = 1 ]; then
  rm -rf -- "$dl_dir"
  created_dl=0
fi

echo ""
echo "完成 / Done. 引擎資料夾 / Engine folder: $folder"
# the default folder (run there or one sub-folder down) is found by the dev server: no setting needed
if [ "$dest" = "$repo_root/voicevox_engine" ] && { [ "$folder" = "$dest" ] || [ "$(dirname "$folder")" = "$dest" ]; }; then
  echo "已放在預設位置，不用設定 VOICEVOX_DIR，直接 npm run dev / Installed in the default place: no VOICEVOX_DIR needed, just run npm run dev."
else
  echo "VOICEVOX_DIR = $folder"
  echo "在專案資料夾複製下面這一行來啟動 / Copy this line in the project folder:"
  echo "VOICEVOX_DIR=\"$folder\" npm run dev"
fi
