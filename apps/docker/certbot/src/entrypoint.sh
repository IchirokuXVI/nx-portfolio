#!/bin/sh
set -e

# EMAIL="you@example.com"

if [ -z "$DOMAINS" ]; then
  echo "Error: DOMAINS environment variable is required"
  exit 1
fi

DOMAINS=$(echo "$DOMAINS" | tr '\n' ' ')

# Skip email if not defined
if [ -n "$EMAIL" ]; then
  EMAIL_ARG="--email $EMAIL"
else
  EMAIL_ARG="--register-unsafely-without-email"
fi

echo "Checking and requesting certificates..."

# Retry schedule for a failed initial request. ACME can fail transiently (DNS not
# propagated yet, HTTP-01 challenge not reachable), so back off instead of giving
# up: the first 5 retries wait a few minutes, after that every 15 minutes, capped
# at 100 attempts. Stops as soon as the request succeeds.
MAX_ATTEMPTS=100
SHORT_RETRIES=5
SHORT_DELAY=180 # 3 minutes for the first attempts
LONG_DELAY=900  # 15 minutes afterwards

# Request a certificate for a single domain, retrying with backoff on failure.
# Returns 0 on success, 1 once the attempt cap is reached.
request_cert() {
  domain="$1"
  attempt=1
  while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    echo "Requesting certificate for $domain (attempt $attempt/$MAX_ATTEMPTS)..."
    if certbot certonly \
      --webroot -w /var/www/certbot \
      -d "$domain" \
      $EMAIL_ARG \
      --agree-tos --no-eff-email --non-interactive \
      --deploy-hook "/deploy-hook.sh"; then
      echo "✅ Certificate issued for $domain."
      return 0
    fi

    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
      echo "❌ Giving up on $domain after $attempt attempts."
      return 1
    fi

    if [ "$attempt" -le "$SHORT_RETRIES" ]; then
      delay="$SHORT_DELAY"
    else
      delay="$LONG_DELAY"
    fi
    echo "Request for $domain failed; retrying in $((delay / 60)) min..."
    sleep "$delay"
    attempt=$((attempt + 1))
  done
  return 1
}

NEW_CERTS=0

# Loop over each domain and request cert if not found
for domain in $DOMAINS; do
  CERT_DIR="/etc/letsencrypt/live/$domain"
  if [ ! -d "$CERT_DIR" ]; then
    if request_cert "$domain"; then
      NEW_CERTS=$((NEW_CERTS + 1))
    fi
  else
    echo "✅ Certificate for $domain already exists. Will renew if needed"
  fi
done

if [ "$NEW_CERTS" -gt 0 ]; then
  echo "$NEW_CERTS were requested. Reloading Nginx inside the same Pod..."
  # Send reload signal to Nginx process (in the same Pod)
  pkill -HUP nginx || nginx -s reload
fi

echo "Starting certbot renew loop..."
trap exit TERM
while :; do
  certbot renew --deploy-hook "/deploy-hook.sh"
  sleep 12h & wait $!
done
