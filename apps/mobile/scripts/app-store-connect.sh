#!/usr/bin/env bash
# What the iOS build workflow asks App Store Connect itself (.github/workflows/ios.yml), with the API key from
# the environment: ASC_API_KEY_ID, ASC_API_ISSUER_ID and ASC_API_KEY_FILE (the .p8 file's path). Sourced, not run.
# Only curl, openssl and python3, which every macOS runner has: no account, no tool to install.

# A token for the key, good for five minutes (ES256, as App Store Connect asks).
asc_token() {
  local now header claims signature
  _asc_b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  now=$(date +%s)
  header=$(printf '{"alg":"ES256","kid":"%s","typ":"JWT"}' "$ASC_API_KEY_ID" | _asc_b64)
  claims=$(printf '{"iss":"%s","iat":%s,"exp":%s,"aud":"appstoreconnect-v1"}' \
    "$ASC_API_ISSUER_ID" "$now" "$((now + 300))" | _asc_b64)
  # openssl signs in DER; a token carries the two 32-byte numbers side by side.
  signature=$(printf '%s.%s' "$header" "$claims" | openssl dgst -sha256 -sign "$ASC_API_KEY_FILE" | python3 -c '
import sys
d = sys.stdin.buffer.read()
i = 2 if d[1] < 0x80 else 2 + (d[1] & 0x7F)
out = b""
for _ in range(2):
    n = d[i + 1]
    out += d[i + 2 : i + 2 + n].lstrip(b"\x00").rjust(32, b"\x00")
    i += 2 + n
sys.stdout.buffer.write(out)' | _asc_b64)
  printf '%s.%s.%s' "$header" "$claims" "$signature"
}

# The HTTP status App Store Connect gives this key (200: it takes it).
asc_status() {
  curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(asc_token)" \
    "https://api.appstoreconnect.apple.com/v1/apps?limit=1"
}

# GET a path of the API ("/v1/…"); fails on anything but a success.
asc_get() {
  curl -sS --fail -g -H "Authorization: Bearer $(asc_token)" "https://api.appstoreconnect.apple.com$1"
}

# The App Store provisioning profile of a bundle id, written to the folder given: prints its name. The newest
# active one; none is an error that says what to make.
asc_store_profile() {
  local identifier=$1 folder=$2 bundle
  bundle=$(asc_get "/v1/bundleIds?filter[identifier]=$identifier&limit=200" | python3 -c '
import json, sys
wanted = sys.argv[1]
print(next((b["id"] for b in json.load(sys.stdin)["data"] if b["attributes"]["identifier"] == wanted), ""))' \
    "$identifier")
  if [ -z "$bundle" ]; then
    echo "::error::No bundle id $identifier in the Apple Developer account" >&2
    return 1
  fi
  asc_get "/v1/bundleIds/$bundle/profiles?limit=200" | python3 -c '
import base64, json, os, sys
identifier, folder = sys.argv[1], sys.argv[2]
profiles = [
    p["attributes"]
    for p in json.load(sys.stdin)["data"]
    if p["attributes"]["profileType"] == "IOS_APP_STORE" and p["attributes"]["profileState"] == "ACTIVE"
]
if not profiles:
    sys.exit(f"::error::No active App Store provisioning profile for {identifier}: make one in the Apple Developer account")
newest = max(profiles, key=lambda a: a["expirationDate"])
os.makedirs(folder, exist_ok=True)
with open(os.path.join(folder, newest["uuid"] + ".mobileprovision"), "wb") as out:
    out.write(base64.b64decode(newest["profileContent"]))
print(newest["name"])' "$identifier" "$folder"
}
