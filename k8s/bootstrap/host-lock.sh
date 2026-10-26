#!/usr/bin/env bash
#
# The host lock (k8s plan 0016 D2). A deploy and a host patch never overlap on
# one machine: every deploy step that runs helm or kubectl holds
# /run/lock/nx-deploy.lock, and nx-host-patch holds the same lock from its first
# package operation until it reboots or exits.
#
#   bash host-lock.sh <command> [args...]   run the command with the lock held
#   . host-lock.sh && host_lock             hold it for the rest of a script
#
# The wait is NX_DEPLOY_LOCK_WAIT seconds (default 900). A script that already
# holds the lock exports NX_DEPLOY_LOCK_HELD=1, and a nested call then passes
# through: a second flock on a new descriptor would wait on its own parent.
#
# provision-host.sh creates the file owned by root at every boot. Every reader
# opens it read only and never with O_CREAT, because fs.protected_regular
# refuses an O_CREAT open of another user's file in the sticky /run/lock, root
# included. flock needs no write access.

NX_DEPLOY_LOCK="${NX_DEPLOY_LOCK:-/run/lock/nx-deploy.lock}"
NX_DEPLOY_LOCK_WAIT="${NX_DEPLOY_LOCK_WAIT:-900}"

host_lock() {
  local started waited
  if [ "${NX_DEPLOY_LOCK_HELD:-}" = 1 ]; then
    return 0
  fi
  # A workstation running a rehearsal has neither. A cluster host has both.
  if ! command -v flock > /dev/null 2>&1 || [ ! -d "$(dirname "$NX_DEPLOY_LOCK")" ]; then
    echo "host lock: no flock or no $(dirname "$NX_DEPLOY_LOCK") here, so nothing is locked"
    return 0
  fi
  if [ ! -e "$NX_DEPLOY_LOCK" ]; then
    # A host that has not run provision-host.sh since plan 0016. Created here,
    # it belongs to this account until the next boot or provisioning.
    (set -C && : > "$NX_DEPLOY_LOCK") 2> /dev/null || true
  fi
  exec {NX_DEPLOY_LOCK_FD}< "$NX_DEPLOY_LOCK" || {
    echo "host lock: cannot open $NX_DEPLOY_LOCK. Run provision-host.sh on this host." >&2
    return 1
  }
  if ! flock -n "$NX_DEPLOY_LOCK_FD"; then
    started="$(date +%s)"
    echo "host lock: $NX_DEPLOY_LOCK is held by another deploy or by host patching;"
    echo "           waiting up to ${NX_DEPLOY_LOCK_WAIT}s for it"
    if ! flock -w "$NX_DEPLOY_LOCK_WAIT" "$NX_DEPLOY_LOCK_FD"; then
      echo "host lock: still held after ${NX_DEPLOY_LOCK_WAIT}s, so this step stops." >&2
      echo "           See what holds it: sudo nx-host-patch status, or the other deploy's run." >&2
      return 1
    fi
    waited=$(($(date +%s) - started))
    echo "host lock: taken after ${waited}s"
  fi
  export NX_DEPLOY_LOCK_HELD=1
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  if [ $# -eq 0 ]; then
    sed -n '2,19p' "$0"
    exit 2
  fi
  host_lock
  "$@"
fi
