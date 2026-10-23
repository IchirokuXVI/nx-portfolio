#!/usr/bin/env bash
#
# nx-host-patch: the one program CI may run as root on a cluster host (k8s plan
# 0013).
#
# provision-host.sh installs this file as /usr/local/sbin/nx-host-patch, owned by
# root, with a sudoers rule that lets the deploy account run it and nothing else.
# A sudo rule is only as narrow as the program it names, so every argument is
# held to a fixed pattern before it reaches apt or the k3s installer.
#
#   nx-host-patch status              key=value lines, changes nothing
#   nx-host-patch apply <snapshot>    upgrade every package to the state that
#                                     snapshot.debian.org held at <snapshot>
#   nx-host-patch k3s <version>       install that k3s release
#   nx-host-patch reboot              reboot in 15 seconds, so the SSH call returns
#   nx-host-patch version             the version of this tool
#
# Why a snapshot and not the live mirror. The host-maintenance workflow patches
# staging, waits two days, and then patches production. Against the live mirror
# production would install whatever the mirror holds two days later, which is
# not what staging proved. A snapshot timestamp names one fixed state of the
# archive, so both hosts install exactly the same packages.
#
# <snapshot> is a UTC timestamp such as 20261026T030000Z. snapshot.debian.org
# resolves it to the newest import at or before that moment.

set -euo pipefail

TOOL_VERSION=2

# sudo resets the environment, so nothing here may depend on the caller's PATH.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive
# needrestart lists services and restarts none. The reboot decision belongs to
# the workflow, which can check the cluster afterwards.
export NEEDRESTART_MODE=l

STATE_DIR=/var/lib/nx-host-patch
SOURCES_DIR=/etc/nx-host-patch/sources.d
K3S_CONFIG=/etc/rancher/k3s/config.yaml
KUBECONFIG=/etc/rancher/k3s/k3s.yaml
export KUBECONFIG

die() { echo "nx-host-patch: $*" >&2; exit 1; }

usage() {
  sed -n '11,16p' "$0" >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || die "run this through sudo"

# One run at a time. A second CI run that reaches the host while the first is
# inside dpkg would fail on the dpkg lock anyway, but with a worse message.
exec 9>/run/nx-host-patch.lock
flock -n 9 || die "another nx-host-patch run holds the lock"

# The deploy lock (k8s plan 0016 D2), shared with every deploy of every unit.
# Opened read only and without O_CREAT, as k8s/bootstrap/host-lock.sh explains.
DEPLOY_LOCK=/run/lock/nx-deploy.lock
DEPLOY_LOCK_WAIT=900

hold_deploy_lock() {
  [ -e "$DEPLOY_LOCK" ] || install -m 0644 -o root -g root /dev/null "$DEPLOY_LOCK"
  exec 8< "$DEPLOY_LOCK"
  if ! flock -n 8; then
    echo "==> a deploy holds $DEPLOY_LOCK; waiting up to ${DEPLOY_LOCK_WAIT}s"
    flock -w "$DEPLOY_LOCK_WAIT" 8 || die "a deploy held $DEPLOY_LOCK for ${DEPLOY_LOCK_WAIT}s"
  fi
}

# ---------------------------------------------------------------------------
# Reboot detection.
#
# Debian does not write /run/reboot-required the way Ubuntu does, so the kernel
# is compared directly: the newest installed image against the running one.
# needrestart adds the services that still run old libraries (libc, OpenSSL,
# systemd). A reboot restarts both at once, and on a single node that is two
# minutes of downtime, so the workflow does it in a fixed window.
# ---------------------------------------------------------------------------
newest_kernel() {
  find /boot -maxdepth 1 -name 'vmlinuz-*' -printf '%f\n' 2>/dev/null \
    | sed 's/^vmlinuz-//' | sort -V | tail -1
}

reboot_reasons() {
  local running newest
  running="$(uname -r)"
  newest="$(newest_kernel)"
  if [ -n "$newest" ] && [ "$newest" != "$running" ]; then
    echo "kernel:$newest"
  fi
  [ -e /run/reboot-required ] && echo "reboot-required-file"
  if command -v needrestart >/dev/null 2>&1; then
    # -b is the batch format, -r l lists and restarts nothing. Only the services
    # count here: needrestart's own kernel check reads the same /boot.
    needrestart -b -r l 2>/dev/null | sed -n 's/^NEEDRESTART-SVC: /service:/p'
  fi
  return 0
}

k3s_version() {
  if command -v k3s >/dev/null 2>&1; then
    k3s --version | head -1 | awk '{print $3}'
  fi
}

cmd_status() {
  local reasons
  . /etc/os-release
  reasons="$(reboot_reasons | paste -sd, -)"
  echo "tool_version=$TOOL_VERSION"
  echo "os=${ID}-${VERSION_ID:-unknown} (${VERSION_CODENAME:-unknown})"
  echo "boot_id=$(cat /proc/sys/kernel/random/boot_id)"
  echo "kernel_running=$(uname -r)"
  echo "kernel_newest=$(newest_kernel)"
  echo "k3s_version=$(k3s_version)"
  echo "last_snapshot=$(cat "$STATE_DIR/last-snapshot" 2>/dev/null || true)"
  echo "last_applied_at=$(cat "$STATE_DIR/last-applied-at" 2>/dev/null || true)"
  if [ -n "$reasons" ]; then
    echo "reboot_required=yes"
    echo "reboot_reasons=$reasons"
  else
    echo "reboot_required=no"
  fi
}

# ---------------------------------------------------------------------------
# apply <snapshot>
# ---------------------------------------------------------------------------
cmd_apply() {
  local snap="${1:-}" codename keyring now_epoch snap_epoch last apt_opts
  [[ "$snap" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "snapshot must look like 20261026T030000Z"

  . /etc/os-release
  [ "${ID:-}" = debian ] || die "only Debian is supported, this is ${ID:-unknown}"
  codename="${VERSION_CODENAME:?no VERSION_CODENAME in /etc/os-release}"

  # A timestamp in the future resolves to the newest import, which turns the
  # snapshot back into the live mirror. That is the one thing this command
  # exists to prevent, so it is refused.
  snap_epoch="$(date -u -d "${snap:0:4}-${snap:4:2}-${snap:6:2}T${snap:9:2}:${snap:11:2}:${snap:13:2}Z" +%s)" \
    || die "snapshot is not a valid date: $snap"
  now_epoch="$(date -u +%s)"
  [ "$snap_epoch" -le $((now_epoch + 300)) ] || die "snapshot $snap is in the future"

  # Never back. apt would not downgrade on `upgrade` anyway, but a run that
  # names an older snapshot than the last one is a mistake worth a message.
  last="$(cat "$STATE_DIR/last-snapshot" 2>/dev/null || true)"
  if [ -n "$last" ] && [[ "$snap" < "$last" ]]; then
    die "snapshot $snap is older than the last one applied ($last)"
  fi

  for keyring in /usr/share/keyrings/debian-archive-keyring.pgp \
                 /usr/share/keyrings/debian-archive-keyring.gpg; do
    [ -r "$keyring" ] && break
  done
  [ -r "$keyring" ] || die "no Debian archive keyring found"

  # The components match what the provider image ships (main and
  # non-free-firmware). A host that needs contrib or non-free needs it here too.
  install -d -m 755 "$SOURCES_DIR" "$STATE_DIR"
  cat > "$SOURCES_DIR/snapshot.sources" <<EOF
# Written by nx-host-patch for snapshot $snap. Not read by plain apt.
Types: deb
URIs: http://snapshot.debian.org/archive/debian/$snap/
Suites: $codename $codename-updates
Components: main non-free-firmware
Signed-By: $keyring

Types: deb
URIs: http://snapshot.debian.org/archive/debian-security/$snap/
Suites: $codename-security
Components: main non-free-firmware
Signed-By: $keyring
EOF

  # Only the snapshot sources are read, never /etc/apt/sources.list*, so the
  # live mirror cannot leak newer packages into the run. Release files on the
  # security archive carry a Valid-Until a week out, and a snapshot is by design
  # older than that, so the check is off. The signatures are still verified,
  # which is also why plain http is enough: apt trusts the signed Release file,
  # not the transport, the same as the provider's own sources.
  apt_opts=(
    -o Dir::Etc::SourceList=/dev/null
    -o Dir::Etc::SourceParts="$SOURCES_DIR"
    -o Acquire::Check-Valid-Until=false
    -o Acquire::Retries=5
    -o Acquire::http::Timeout=60
  )

  hold_deploy_lock
  echo "==> snapshot $snap ($codename)"
  # A run that died inside dpkg leaves it half configured, and every apt call
  # after that refuses to start until this runs.
  dpkg --configure -a
  # --error-on=any: by default a source that cannot be fetched is a warning and
  # apt carries on with no lists, which would record a snapshot as applied when
  # nothing was read from it.
  apt-get "${apt_opts[@]}" -q --error-on=any update
  # --with-new-pkgs, because a kernel update arrives as a new package
  # (linux-image-6.12.N) pulled in by the linux-image-amd64 metapackage. Plain
  # `upgrade` would hold the metapackage back and the kernel would never move.
  # confold keeps any config file somebody edited on the host.
  apt-get "${apt_opts[@]}" -y -q \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold \
    --with-new-pkgs upgrade
  # Old kernels fill /boot. autoremove keeps the running one and the newest.
  apt-get "${apt_opts[@]}" -y -q autoremove --purge

  echo "$snap" > "$STATE_DIR/last-snapshot"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE_DIR/last-applied-at"
  echo
  cmd_status
}

# ---------------------------------------------------------------------------
# k3s <version>
#
# The k3s installer rewrites the systemd unit from its own arguments, so a run
# that forgot `--disable traefik` would bring traefik back onto ports 80 and
# 443. The flags therefore live in /etc/rancher/k3s/config.yaml, which install.sh
# writes and which k3s reads on every start, and this command refuses to run
# without that file.
#
# One minor version at a time, which is what Kubernetes supports. No drain: on a
# single node there is nowhere to drain to, and the containers keep running
# while k3s itself restarts.
# ---------------------------------------------------------------------------
cmd_k3s() {
  local want="${1:-}" have want_minor have_minor installer
  [[ "$want" =~ ^v1\.([0-9]+)\.([0-9]+)\+k3s([0-9]+)$ ]] \
    || die "version must look like v1.36.3+k3s1"
  want_minor="${BASH_REMATCH[1]}"

  have="$(k3s_version)"
  [ -n "$have" ] || die "k3s is not installed here. Use install.sh --k3s for a new host."
  if [ "$have" = "$want" ]; then
    echo "k3s is already $want"
    return
  fi
  [[ "$have" =~ ^v1\.([0-9]+)\. ]] || die "cannot read the installed version: $have"
  have_minor="${BASH_REMATCH[1]}"

  # sort -V orders +k3s1 and +k3s2 correctly, and that is the comparison needed.
  if [ "$(printf '%s\n%s\n' "$have" "$want" | sort -V | tail -1)" != "$want" ]; then
    die "refusing to downgrade k3s from $have to $want"
  fi
  if [ $((want_minor - have_minor)) -gt 1 ]; then
    die "k3s moves one minor version at a time: $have to $want skips one"
  fi

  grep -q 'traefik' "$K3S_CONFIG" 2>/dev/null && grep -q 'servicelb' "$K3S_CONFIG" \
    || die "$K3S_CONFIG does not disable traefik and servicelb. Re-run provision-host.sh --k3s first."

  # The installer comes from the same tag as the binary it installs, so a
  # change to get.k3s.io between two runs cannot change what a run does.
  installer="$(mktemp)"
  trap 'rm -f "$installer"' RETURN
  curl -sfL --retry 3 -o "$installer" \
    "https://raw.githubusercontent.com/k3s-io/k3s/${want}/install.sh" \
    || die "could not download the k3s installer for $want"

  hold_deploy_lock
  echo "==> k3s $have -> $want"
  # No INSTALL_K3S_EXEC: the flags come from config.yaml (see above).
  INSTALL_K3S_VERSION="$want" sh "$installer"

  echo "==> waiting for the node to report $want"
  for _ in $(seq 1 60); do
    if [ "$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.kubeletVersion}' 2>/dev/null)" = "$want" ] \
       && kubectl wait --for=condition=Ready node --all --timeout=5s >/dev/null 2>&1; then
      echo "    node Ready on $want"
      return
    fi
    sleep 5
  done
  die "the node did not come back Ready on $want within five minutes"
}

cmd_reboot() {
  # Waits for a running deploy to finish first. The reboot itself runs from a
  # transient unit that takes the deploy lock again and keeps it, so no deploy
  # can start in the 15 seconds before the machine goes down.
  hold_deploy_lock
  exec 8<&-
  # Through systemd-run, so the SSH session that asked gets its answer before
  # the network goes away.
  systemd-run --quiet --unit=nx-host-patch-reboot /bin/sh -c \
    "exec 8< $DEPLOY_LOCK; flock -w $DEPLOY_LOCK_WAIT 8; sleep 15; exec /bin/systemctl reboot"
  echo "rebooting in 15 seconds (boot_id $(cat /proc/sys/kernel/random/boot_id))"
}

case "${1:-}" in
  status)  cmd_status ;;
  apply)   cmd_apply "${2:-}" ;;
  k3s)     cmd_k3s "${2:-}" ;;
  reboot)  cmd_reboot ;;
  version) echo "$TOOL_VERSION" ;;
  *)       usage ;;
esac
