#!/usr/bin/env bash
# Builds the Android release APK, checks its signature, writes its SHA-256
# checksum and the download manifest, and publishes it on Firebase Hosting:
#
#   https://monticello-villas-f600e.web.app/downloads/monticello-v<version>-release.apk
#   https://monticello-villas-f600e.web.app/downloads/latest.json
#
# The portals' /download page (DirectDownloadCard) reads latest.json, so a
# release appears there the moment this script finishes — no portal redeploy.
#
# Usage (Git Bash / macOS / Linux), from anywhere in the repo:
#   scripts/deploy-apk.sh               build, verify, publish
#   scripts/deploy-apk.sh --no-deploy   build and verify only (inspect first)
#
# Before the first release:
#   1. android/key.properties must point at the upload keystore (see
#      GO_LIVE_RUNBOOK.md). The script refuses debug-signed builds.
#   2. dart_defines.json must exist at the repo root (Mapbox token).
#   3. Bump `version:` in pubspec.yaml for every release (1.0.1+2 …). The
#      build number must grow, or installed apps will refuse the update.
set -euo pipefail

PROJECT_ID="monticello-villas-f600e"
HOSTING_URL="https://${PROJECT_ID}.web.app"
DEPLOY=1
[[ "${1:-}" == "--no-deploy" ]] && DEPLOY=0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DOWNLOADS="hosting/public/downloads"
fail() { echo -e "\nRefusing to release: $*\n" >&2; exit 1; }

# ── preconditions ────────────────────────────────────────────────────────────
[[ -f android/key.properties ]] || fail "android/key.properties is missing, so the APK would be signed with the debug key. See GO_LIVE_RUNBOOK.md → Release signing."
[[ -f dart_defines.json ]] || fail "dart_defines.json is missing (the Mapbox token is read from it at build time)."

VERSION_LINE="$(grep -E '^version:' pubspec.yaml | head -1 | awk '{print $2}')"
VERSION_NAME="${VERSION_LINE%%+*}"
BUILD_NUMBER="${VERSION_LINE##*+}"
[[ -n "$VERSION_NAME" && "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || fail "could not read 'version: x.y.z+N' from pubspec.yaml."
FILE="monticello-v${VERSION_NAME}-release.apk"

mkdir -p "$DOWNLOADS"
if [[ -f "$DOWNLOADS/$FILE" ]]; then
  fail "$FILE was already released. Bump 'version:' in pubspec.yaml (e.g. ${VERSION_NAME}+$((BUILD_NUMBER + 1)) and a new version name)."
fi
if [[ -f "$DOWNLOADS/latest.json" ]]; then
  LAST_BUILD="$(node -e "console.log((require('./$DOWNLOADS/latest.json') || {}).buildNumber ?? 0)")"
  (( BUILD_NUMBER > LAST_BUILD )) || fail "build number $BUILD_NUMBER is not above the last release ($LAST_BUILD). Phones refuse updates that do not increase it."
fi

# ── build ────────────────────────────────────────────────────────────────────
# One universal APK rather than --split-per-abi: residents pick one file and
# it works on any phone; split APKs make them choose an ABI they cannot name.
# --obfuscate needs the symbols to read crash stack traces, so they are kept.
SYMBOLS="release-symbols/${VERSION_NAME}+${BUILD_NUMBER}"
echo "Building ${FILE} (versionCode ${BUILD_NUMBER})…"
flutter build apk --release \
  --obfuscate --split-debug-info="$SYMBOLS" \
  --dart-define-from-file=dart_defines.json

APK="build/app/outputs/flutter-apk/app-release.apk"
[[ -f "$APK" ]] || fail "the build produced no $APK."

# ── signature check ──────────────────────────────────────────────────────────
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk}}"
APKSIGNER="$(ls -d "$SDK"/build-tools/*/ 2>/dev/null | sort -V | tail -1)apksigner"
[[ -f "$APKSIGNER" || -f "${APKSIGNER}.bat" ]] || fail "apksigner not found under $SDK/build-tools."
[[ -f "${APKSIGNER}.bat" ]] && APKSIGNER="${APKSIGNER}.bat"
CERT="$("$APKSIGNER" verify --print-certs "$APK")" || fail "apksigner could not verify $APK."
if grep -qi "CN=Android Debug" <<<"$CERT"; then
  fail "$APK is signed with the DEBUG key. Check android/key.properties."
fi
echo "Signature OK: $(grep -m1 'certificate DN' <<<"$CERT" | sed 's/.*certificate DN: //')"

# ── publish files ────────────────────────────────────────────────────────────
cp "$APK" "$DOWNLOADS/$FILE"
SHA256="$(sha256sum "$DOWNLOADS/$FILE" | awk '{print $1}')"
echo "$SHA256  $FILE" > "$DOWNLOADS/$FILE.sha256"
SIZE="$(wc -c < "$DOWNLOADS/$FILE" | tr -d ' ')"
RELEASED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node -e '
  const [file, version, build, size, sha256, releasedAt, base, out] = process.argv.slice(1)
  require("fs").writeFileSync(out, JSON.stringify({
    app: "Monticello Villas",
    version, buildNumber: Number(build),
    fileName: file,
    url: `${base}/downloads/${file}`,
    sizeBytes: Number(size),
    sha256,
    releasedAt,
    minAndroid: "5.0",
  }, null, 2) + "\n")
' "$FILE" "$VERSION_NAME" "$BUILD_NUMBER" "$SIZE" "$SHA256" "$RELEASED_AT" "$HOSTING_URL" "$DOWNLOADS/latest.json"

echo
echo "  file     $FILE"
echo "  size     $(( SIZE / 1048576 )) MB"
echo "  sha256   $SHA256"
echo "  symbols  $SYMBOLS  (keep these to read obfuscated crash reports)"

if (( DEPLOY == 0 )); then
  echo -e "\n--no-deploy: nothing published. Run again without it to release.\n"
  exit 0
fi

npx --yes firebase-tools deploy --only hosting --project "$PROJECT_ID"
echo -e "\nReleased: ${HOSTING_URL}/downloads/${FILE}\n"
