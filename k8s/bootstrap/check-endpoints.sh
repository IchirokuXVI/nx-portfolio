#!/usr/bin/env bash
#
# Do these public URLs answer? Run from a CI runner, not on the host (k8s plan
# 0013). The cluster can be healthy from the inside while the outside sees
# nothing: an Envoy data plane Service without its address, an expired
# certificate, a firewall rule. This is the outside view.
#
#   bash k8s/bootstrap/check-endpoints.sh https://staging.ichirokuxvi.com https://api.staging.velista.app
#
# A URL passes when it answers over valid TLS with a status below 500. A 404 on a
# bare API host is an answer: the route and the certificate both work. Each URL
# gets about two minutes of retries, because the first seconds after a reboot
# belong to the data plane coming back.

set -uo pipefail

[ $# -gt 0 ] || { echo "usage: $0 <url>..." >&2; exit 2; }

failed=0
for url in "$@"; do
  code=000
  for _ in $(seq 1 12); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || true)"
    [ "${code:-000}" != 000 ] && [ "$code" -lt 500 ] && break
    sleep 10
  done
  if [ "${code:-000}" != 000 ] && [ "$code" -lt 500 ]; then
    printf '    ok    %s %s\n' "$code" "$url"
  else
    printf '    FAIL  %s %s\n' "${code:-000}" "$url" >&2
    failed=1
  fi
done
exit "$failed"
