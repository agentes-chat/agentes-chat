#!/bin/sh
# Makes the code-signing certificate the Desktop workflow signs the macOS app with while there is no Developer ID
# (ADR 0255 §6), and prints the two repository secrets it reads. Run it once and keep the .p12: a new certificate is a
# new designated requirement, so every Mac would have to allow Screen Recording and the rest again.
#   sh apps/desktop/scripts/self-signed-cert.sh [out-dir]
#   gh secret set MACOS_SELF_SIGNED_P12 < <out-dir>/signing.p12.b64
#   gh secret set MACOS_SELF_SIGNED_PASSWORD < <out-dir>/signing.password
set -eu
OUT=${1:-.}
NAME="agentes.chat Signing"
mkdir -p "$OUT"
umask 077
openssl rand -hex 24 > "$OUT/signing.password"
openssl req -x509 -newkey rsa:3072 -sha256 -days 7300 -nodes -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -keyout "$OUT/signing.key" -out "$OUT/signing.pem"
# -legacy: the Keychain reads only the older PKCS#12 ciphers.
openssl pkcs12 -export -legacy -name "$NAME" -inkey "$OUT/signing.key" -in "$OUT/signing.pem" \
  -passout "file:$OUT/signing.password" -out "$OUT/signing.p12"
base64 < "$OUT/signing.p12" | tr -d '\n' > "$OUT/signing.p12.b64"
rm "$OUT/signing.key"
echo "Made $OUT/signing.p12 for \"$NAME\". Set the secrets MACOS_SELF_SIGNED_P12 (signing.p12.b64) and"
echo "MACOS_SELF_SIGNED_PASSWORD (signing.password), then keep signing.p12 and its password somewhere safe."
