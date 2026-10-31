#!/usr/bin/env bash
#
# Is this cluster healthy? Read only, runs as the deploy account (k8s plan 0013).
#
# The host-maintenance workflow pipes this file over SSH before it patches a
# host, after it patches it, and on staging again after the soak, before it
# touches production:
#
#   ssh deploy@HOST 'bash -s' < k8s/bootstrap/host-health.sh
#
# It waits rather than samples. Right after a reboot every pod is starting, and
# a check that fails on the first look would only ever report the reboot. Each
# wait is bounded, so a cluster that does not settle is a failed step, not a
# hung one.
#
# Healthy means: the node is Ready, every Deployment is Available, every
# StatefulSet and DaemonSet has rolled out, no container is stuck in a crash or
# pull loop, every cert-manager Certificate is Ready, and the hourly log trim
# of k8s plan 0018 is scheduled.

set -uo pipefail

export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
TIMEOUT="${HEALTH_TIMEOUT:-600s}"
failed=0

step() { echo; echo "==> $*"; }
fail() { echo "UNHEALTHY: $*" >&2; failed=1; }

step "node"
# Polled first: `kubectl wait --all` with zero objects fails at once instead of
# waiting (see install.sh), and a node that just rebooted may not answer yet.
for _ in $(seq 1 60); do
  kubectl get nodes -o name >/dev/null 2>&1 && break
  sleep 5
done
kubectl wait --for=condition=Ready node --all --timeout="$TIMEOUT" || fail "node not Ready"
kubectl get nodes -o wide

step "deployments (Available)"
kubectl wait --for=condition=Available deployment --all --all-namespaces --timeout="$TIMEOUT" \
  || fail "a Deployment is not Available"

step "statefulsets and daemonsets (rolled out)"
while read -r ns kind name; do
  [ -n "$name" ] || continue
  kubectl -n "$ns" rollout status "$kind/$name" --timeout="$TIMEOUT" >/dev/null \
    || fail "$kind $ns/$name did not roll out"
done < <(kubectl get statefulsets,daemonsets --all-namespaces \
           -o jsonpath='{range .items[*]}{.metadata.namespace} {.kind} {.metadata.name}{"\n"}{end}' \
         | awk '{print $1, tolower($2), $3}')
echo "    done"

step "containers stuck waiting"
# Phase alone cannot tell: old CronJob pods sit in Failed by design
# (failedJobsHistoryLimit). A container waiting on one of these reasons is
# broken now, whatever its pod's phase says.
stuck="$(kubectl get pods --all-namespaces -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}{" "}{.status.containerStatuses[*].state.waiting.reason}{"\n"}{end}' \
  | grep -E 'CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|CreateContainerError' || true)"
if [ -n "$stuck" ]; then
  echo "$stuck"
  fail "containers stuck waiting"
else
  echo "    none"
fi

step "certificates (Ready)"
if kubectl get crd certificates.cert-manager.io >/dev/null 2>&1; then
  kubectl wait --for=condition=Ready certificate --all --all-namespaces --timeout=120s \
    || fail "a Certificate is not Ready"
  kubectl get certificate --all-namespaces
else
  echo "    cert-manager not installed, skipped"
fi

step "log retention (k8s plan 0018)"
# The rules are printed so that a person can hold them against the days the
# privacy policy states, which the chart's legal values set and this host
# cannot read.
if systemctl is-active --quiet nx-log-retention.timer; then
  echo "    nx-log-retention.timer is active"
else
  fail "nx-log-retention.timer is not active: re-run provision-host.sh"
fi
if [ -r /etc/nx-log-retention.conf ]; then
  grep -v '^[[:space:]]*\(#\|$\)' /etc/nx-log-retention.conf | sed 's/^/    rule: /'
else
  fail "no /etc/nx-log-retention.conf"
fi

if [ "$failed" -ne 0 ]; then
  step "events, most recent last"
  kubectl get events --all-namespaces --sort-by=.lastTimestamp 2>/dev/null | tail -40
  exit 1
fi
echo
echo "healthy"
