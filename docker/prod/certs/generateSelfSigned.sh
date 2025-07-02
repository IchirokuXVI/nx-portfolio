#!/bin/bash
# This file might be needed to generate self-signed certificates before doing the first ACME challenge because NGINX needs a valid certificate to start.
set -e

CERT_NAME="$1"

if [ -z "$CERT_NAME" ]; then
  echo "Usage: $0 <cert-name>"
  echo "Example: $0 mycert"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

KEY_FILE="${SCRIPT_DIR}/${CERT_NAME}.key"
CRT_FILE="${SCRIPT_DIR}/${CERT_NAME}.crt"

# Optional: Certificate subject (customize if needed)
SUBJECT="//C=US/ST=State/L=City/O=MyOrg/OU=Dev/CN=localhost"

# Create self-signed cert and private key
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CRT_FILE" \
  -subj "$SUBJECT"

echo "✅ Created:"
echo "  - Key:  $KEY_FILE"
echo "  - Cert: $CRT_FILE"
