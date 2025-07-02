#!/bin/sh
set -e

# Directory to move certificates to
TARGET_DIR="/certs"

DOMAIN_FOLDER=$(basename "$RENEWED_LINEAGE")

echo "Deploy hook triggered for domains: $DOMAIN_FOLDER"
echo "Certificate files located at: $RENEWED_LINEAGE"

# Make sure target directory exists
mkdir -p "$TARGET_DIR"

# Copy cert files to target directory under domain folder
cp "$RENEWED_LINEAGE/privkey.pem" "$TARGET_DIR/$DOMAIN_FOLDER.key"
cp "$RENEWED_LINEAGE/fullchain.pem" "$TARGET_DIR/$DOMAIN_FOLDER.crt"

echo "Certificates copied to $TARGET_DIR"

docker exec reverse-proxy nginx -s reload
