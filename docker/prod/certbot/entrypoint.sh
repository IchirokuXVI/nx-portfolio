#!/bin/sh
set -e

# EMAIL="you@example.com"

if [ -z "$DOMAINS" ]; then
  echo "❌ Error: DOMAINS environment variable is required"
  exit 1
fi

DOMAINS=$(echo "$DOMAINS" | tr '\n' ' ')

# Skip email if not defined
if [ -n "$EMAIL" ]; then
  EMAIL_ARG="--email $EMAIL"
else
  EMAIL_ARG="--register-unsafely-without-email"
fi

echo "🔍 Checking and requesting certificates..."

# Loop over each domain and request cert if not found
for domain in $DOMAINS; do
  CERT_DIR="/etc/letsencrypt/live/$domain"
  if [ ! -d "$CERT_DIR" ]; then
    echo "⚡ Requesting certificate for $domain..."
    certbot certonly \
      --standalone \
      -d "$domain" \
      $EMAIL_ARG \
      --agree-tos --no-eff-email --non-interactive \
      --deploy-hook "/deploy-hook.sh"
  else
    echo "✅ Certificate for $domain already exists. Will renew if needed"
  fi
done

echo "🔁 Starting certbot renew loop..."
trap exit TERM
while :; do
  certbot renew --deploy-hook "/deploy-hook.sh"
  sleep 12h & wait $!
done
