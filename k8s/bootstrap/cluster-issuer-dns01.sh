#!/usr/bin/env bash
#
# A Let's Encrypt ClusterIssuer that proves domain control over the Cloudflare
# API instead of over an inbound HTTP connection.
#
# install.sh creates `letsencrypt-prod`, which solves HTTP-01 by attaching a
# challenge route to the chart's Gateway. That is the right solver on a VPS with
# a public address and ports 80 and 443 open to the world. It is the wrong one on
# a home connection: many domestic ISPs block inbound port 80, and behind CGNAT
# there is no inbound path at all, so the challenge can never be reached and
# every certificate request fails.
#
# DNS-01 has no such requirement. cert-manager writes a TXT record through the
# Cloudflare API, Let's Encrypt reads it, and no connection is ever made to this
# machine. It is therefore also the solver to use if the site is ever put behind
# Cloudflare's proxy, where the origin address is deliberately unreachable.
#
# This is separate from install.sh rather than a flag on it because it is a
# temporary arrangement for the home hosting window (see k8s/README-homelab.md).
# The netcup box will use install.sh's HTTP-01 issuer like the VPS before it.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=... ./k8s/bootstrap/cluster-issuer-dns01.sh
#   CLOUDFLARE_API_TOKEN=... ./k8s/bootstrap/cluster-issuer-dns01.sh --email you@example.com
#
# The token is the SAME one docker/ddns uses, and needs the same two permissions:
# Zone:DNS:Edit and Zone:Zone:Read, scoped to the ichirokuxvi.com zone. One token
# for both is correct here: they are the same capability (rewrite records in one
# zone) held by two processes on one machine.
#
# Idempotent: every step is an apply.

set -euo pipefail

ACME_EMAIL='danieliyo65@gmail.com'
ISSUER_NAME='letsencrypt-dns01'
# cert-manager reads the token from a Secret in its OWN namespace, not in the
# chart's. A Secret sitting in nx-portfolio is invisible to it and the issuer
# stays NotReady with a message that does not obviously say so.
CERT_MANAGER_NAMESPACE='cert-manager'
SECRET_NAME='cloudflare-api-token'

while [ $# -gt 0 ]; do
  case "$1" in
    --email)     ACME_EMAIL="$2";     shift 2 ;;
    --namespace) CERT_MANAGER_NAMESPACE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set." >&2
  echo "Create a token at Cloudflare > My Profile > API Tokens > Edit zone DNS," >&2
  echo "scoped to ichirokuxvi.com, then re-run:" >&2
  echo "  CLOUDFLARE_API_TOKEN=... $0" >&2
  exit 1
fi

for tool in kubectl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is required and not on PATH." >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 1. The token, as a Secret cert-manager can read.
#
# `create --dry-run=client | apply` rather than `create`, because create fails
# when the object already exists and that makes the script single use. This form
# rotates the token in place on a re-run.
# ---------------------------------------------------------------------------
echo "==> storing the Cloudflare token in $CERT_MANAGER_NAMESPACE/$SECRET_NAME"
kubectl -n "$CERT_MANAGER_NAMESPACE" create secret generic "$SECRET_NAME" \
  --from-literal=api-token="$CLOUDFLARE_API_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

# ---------------------------------------------------------------------------
# 2. The issuer.
#
# The account key is its own Secret, distinct from letsencrypt-prod's, so both
# issuers can exist side by side. That matters during the move back to a VPS:
# the HTTP-01 issuer can be created and verified before anything switches over
# to it, rather than replacing the one currently serving live certificates.
# ---------------------------------------------------------------------------
echo "==> creating ClusterIssuer $ISSUER_NAME (ACME DNS-01 via Cloudflare)"
kubectl apply -f - <<YAML
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: ${ISSUER_NAME}
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ${ACME_EMAIL}
    privateKeySecretRef:
      name: ${ISSUER_NAME}-account-key
    solvers:
      - dns01:
          cloudflare:
            apiTokenSecretRef:
              name: ${SECRET_NAME}
              key: api-token
        # Only for this zone. Without the selector this issuer would answer for
        # any name a Certificate asks about, including one whose DNS this token
        # cannot write, and the failure would look like a Cloudflare permissions
        # problem rather than a misrouted challenge.
        selector:
          dnsZones:
            - ichirokuxvi.com
YAML

echo
echo "==> waiting for the issuer to register with Let's Encrypt"
# A ClusterIssuer that never goes Ready is the common failure here, and it is
# silent: certificates just stay Pending. Surfacing it now costs 30 seconds.
if kubectl wait --for=condition=Ready "clusterissuer/${ISSUER_NAME}" --timeout=60s; then
  echo
  echo "Ready. Deploy with values.homelab.yaml, then watch the certificates:"
  echo "  kubectl -n nx-portfolio get certificate -w"
  echo
  echo "DNS-01 is slower than HTTP-01: expect a couple of minutes per name while"
  echo "the TXT record propagates. Five names are issued, one per host."
else
  echo
  echo "The issuer did not become Ready. Check the reason with:" >&2
  echo "  kubectl describe clusterissuer ${ISSUER_NAME}" >&2
  echo "The usual cause is a token missing Zone:Zone:Read, which is easy to omit" >&2
  echo "because DNS:Edit alone is enough for ddclient but not for cert-manager." >&2
  exit 1
fi
