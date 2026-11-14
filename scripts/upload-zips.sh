#!/usr/bin/env bash
# Upload BMaGlass Pay integration ZIPs to the public Supabase Storage bucket
# `downloads` (project paymentgetway, ref hhxwwozpvgktuqutfkhc) and fill in
# each entry's size + SHA-256 in public/downloads.json — the one manifest
# /developers renders its download buttons from.
#
#   ./scripts/upload-zips.sh zips/bmaglasspay-woocommerce-1.0.0.zip [...]
#   ./scripts/upload-zips.sh            # uploads zips/*.zip
#
# Required environment (never commit a key, never pass one on the command
# line — the script never prints it):
#   SUPABASE_SERVICE_ROLE_KEY   service_role key from the Supabase dashboard
#                               (Project Settings -> API). Uploads bypass RLS
#                               with this key; the anon key cannot upload.
# Optional:
#   SUPABASE_URL  default https://hhxwwozpvgktuqutfkhc.supabase.co
#   BUCKET        default downloads
#   MANIFEST      default public/downloads.json (repo-relative)
#
# Manifest schema (one object per download, regenerated here — the assembly
# step adds new files by adding an entry first, then running this script):
#   { name, platform, version, file, url, size?, sha256? }
#   - file is the object name in the bucket, always
#     `bmaglasspay-<platform>-<version>.zip`
#   - url is the public storage URL:
#     $SUPABASE_URL/storage/v1/object/public/$BUCKET/<file>
#   - size (bytes) and sha256 (hex) are filled in by this script from the
#     uploaded file. Never write a placeholder hash: an entry without
#     size/sha256 simply shows no hash on the page until its ZIP lands.
#
# Bucket rules (set when the bucket was created, 2026-11-14):
#   public, 50 MB per-file limit, application/zip only. Public read is via
#   the "Public read downloads" storage policy (SELECT to public); there is
#   NO anonymous write policy — uploads go through this script only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SUPABASE_URL="${SUPABASE_URL:-https://hhxwwozpvgktuqutfkhc.supabase.co}"
BUCKET="${BUCKET:-downloads}"
MANIFEST="${MANIFEST:-public/downloads.json}"

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "error: SUPABASE_SERVICE_ROLE_KEY is not set." >&2
  echo "Get it from the Supabase dashboard (Project Settings -> API -> service_role)" >&2
  echo "and export it for this run only; never commit it." >&2
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "error: manifest not found: $MANIFEST" >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  ZIPS=("$@")
else
  shopt -s nullglob
  ZIPS=(zips/*.zip)
  if [ "${#ZIPS[@]}" -eq 0 ]; then
    echo "error: no ZIPs given and no zips/*.zip found." >&2
    echo "usage: $0 <zip> [<zip> ...]   (or place ZIPs in zips/)" >&2
    exit 1
  fi
fi

for ZIP in "${ZIPS[@]}"; do
  [ -f "$ZIP" ] || { echo "error: not a file: $ZIP" >&2; exit 1; }
  FILE="$(basename "$ZIP")"
  case "$FILE" in
    bmaglasspay-*-*.zip) ;;
    *) echo "error: $FILE does not match bmaglasspay-<platform>-<version>.zip" >&2; exit 1 ;;
  esac
  # The ZIP must already have a manifest entry (name/platform/version/url).
  python3 - "$MANIFEST" "$FILE" <<'PY'
import json, sys
manifest_path, filename = sys.argv[1], sys.argv[2]
with open(manifest_path) as f:
    manifest = json.load(f)
if not any(e.get("file") == filename for e in manifest):
    print(f"error: no manifest entry for {filename} in {manifest_path}", file=sys.stderr)
    print("Add the entry first (name, platform, version, file, url), then re-run.", file=sys.stderr)
    sys.exit(1)
PY

  echo "Uploading $FILE ..."
  RESP="$(curl -s -w "\n%{http_code}" -X POST \
    "$SUPABASE_URL/storage/v1/object/$BUCKET/$FILE?upsert=true" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/zip" \
    --data-binary "@$ZIP")"
  HTTP="${RESP##*$'\n'}"
  if [ "$HTTP" -ge 200 ] && [ "$HTTP" -lt 300 ]; then
    echo "  storage: HTTP $HTTP"
  else
    echo "  storage upload failed: HTTP $HTTP" >&2
    echo "${RESP%$'\n'*}" >&2
    exit 1
  fi

  SIZE="$(stat -c%s "$ZIP")"
  SHA="$(sha256sum "$ZIP" | cut -d' ' -f1)"
  URL="$SUPABASE_URL/storage/v1/object/public/$BUCKET/$FILE"

  python3 - "$MANIFEST" "$FILE" "$SIZE" "$SHA" <<'PY'
import json, sys
manifest_path, filename, size, sha = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
with open(manifest_path) as f:
    manifest = json.load(f)
for entry in manifest:
    if entry.get("file") == filename:
        entry["size"] = size
        entry["sha256"] = sha
with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
PY

  # Prove the public URL serves the file we just uploaded.
  CODE="$(curl -s -o /dev/null -w "%{http_code}" "$URL")"
  if [ "$CODE" != "200" ]; then
    echo "  public URL check failed: HTTP $CODE for $URL" >&2
    exit 1
  fi
  echo "  $FILE — $SIZE bytes, sha256 $SHA"
  echo "  $URL (public: HTTP $CODE)"
done

echo "Done. Manifest updated: $MANIFEST"
