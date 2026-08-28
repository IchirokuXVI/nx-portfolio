#!/usr/bin/env bash
#
# A root only VPS -> a machine install.sh can run on.
#
# The missing first link in the chain the rest of the repo already had:
#
#   provision-host.sh     bare VPS  ->  accounts, keys, hardened sshd
#   install.sh            machine   ->  cluster (k3s, MetalLB, Envoy, cert-manager)
#   provision-release.sh  cluster   ->  ready for the chart (namespace + Secrets)
#
# Staging and production are the same machine setup with different keys, so what
# differs between them is arguments, not a second script.
#
# Usage, from a workstation, against a host that still allows root login:
#
#   scp k8s/bootstrap/provision-host.sh root@HOST:/tmp/
#   ssh root@HOST "bash /tmp/provision-host.sh \
#     --admin-key 'ssh-ed25519 AAAAC3... you@laptop' \
#     --deploy-key 'ssh-ed25519 AAAAC3... github-actions' \
#     --k3s"
#
# Copied rather than piped on purpose, and safe to copy from a Windows checkout:
# .gitattributes pins every .sh to LF, so the file arrives with the line endings
# bash needs. A script pasted through an editor instead may not, and CRLF makes
# bash report the error one line after the real one.
#
# Then, from a SECOND terminal, prove both accounts work before locking the door
# behind you:
#
#   ssh ichiroku@HOST id && ssh deploy@HOST id
#   ssh root@HOST "bash /tmp/provision-host.sh --admin-key ... --deploy-key ... --lock-root"
#
# Idempotent: existing users are kept, an authorized key already present is not
# added twice, and every step re-runs safely. Deliberately separate from
# install.sh, because this one needs a root login and install.sh is the half you
# want to keep re-running later as yourself.
#
# Options:
#   --admin-key <key>     public key for the sudo account            (required)
#   --deploy-key <key>    public key for the CI account              (required)
#   --admin-user <name>   default: ichiroku
#   --deploy-user <name>  default: deploy
#   --k3s                 clone the repo and run install.sh --k3s
#   --repo <url>          default: https://github.com/IchirokuXVI/nx-portfolio.git
#   --ref <branch>        default: main
#   --lock-root           disable root login and password auth (do this LAST)
#   --firewall            ufw: 22/80/443 plus the k3s pod and service CIDRs
#
# Environment:
#   ADMIN_PASSWORD  if set, becomes the admin account's password and sudo asks
#                   for it. If unset, the account keeps a locked password and
#                   gets a NOPASSWD sudoers rule instead, because an account
#                   with no password cannot answer a sudo prompt and would be
#                   left unable to use sudo at all.

set -euo pipefail

ADMIN_USER=ichiroku
DEPLOY_USER=deploy
ADMIN_KEY=""
DEPLOY_KEY=""
RUN_K3S=false
LOCK_ROOT=false
FIREWALL=false
REPO_URL="https://github.com/IchirokuXVI/nx-portfolio.git"
REPO_REF="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --admin-key)   ADMIN_KEY="$2";    shift 2 ;;
    --deploy-key)  DEPLOY_KEY="$2";   shift 2 ;;
    --admin-user)  ADMIN_USER="$2";   shift 2 ;;
    --deploy-user) DEPLOY_USER="$2";  shift 2 ;;
    --repo)        REPO_URL="$2";     shift 2 ;;
    --ref)         REPO_REF="$2";     shift 2 ;;
    --k3s)         RUN_K3S=true;      shift ;;
    --lock-root)   LOCK_ROOT=true;    shift ;;
    --firewall)    FIREWALL=true;     shift ;;
    -h|--help)     sed -n '2,54p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root. It creates users and edits sshd_config." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Key validation, which exists because of a real mistake.
#
# Documentation writes example keys as `ssh-ed25519 AAAA...`, and pasting that
# verbatim produces an authorized_keys file that looks populated, passes every
# `ls -l` check, and refuses every login. Rejecting anything with an ellipsis in
# it costs one line and turns a confusing lockout into a message.
# ---------------------------------------------------------------------------
check_key() {
  local label="$1" key="$2"
  if [ -z "$key" ]; then
    echo "$label is required. Pass the CONTENTS of the .pub file, quoted." >&2
    exit 1
  fi
  case "$key" in
    *...*)
      echo "$label still contains an ellipsis, so it is the documentation" >&2
      echo "placeholder rather than a key. Paste the real .pub file contents." >&2
      exit 1 ;;
  esac
  case "$key" in
    ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *|sk-ssh-ed25519*\ *) ;;
    *) echo "$label does not start with a key type (ssh-ed25519, ssh-rsa, ...)." >&2
       exit 1 ;;
  esac
  if [ "${#key}" -lt 80 ]; then
    echo "$label is only ${#key} characters, which is too short to be a key." >&2
    exit 1
  fi
}

# A key pasted from Windows arrives with a trailing carriage return often enough
# to be worth handling rather than debugging.
ADMIN_KEY="${ADMIN_KEY%$'\r'}"
DEPLOY_KEY="${DEPLOY_KEY%$'\r'}"
check_key --admin-key "$ADMIN_KEY"
check_key --deploy-key "$DEPLOY_KEY"

if [ "$ADMIN_KEY" = "$DEPLOY_KEY" ]; then
  echo "The admin and deploy keys are identical. Use two keypairs, so that" >&2
  echo "revoking CI's access never touches your own." >&2
  exit 1
fi

echo "==> host: $(hostname), admin: $ADMIN_USER, deploy: $DEPLOY_USER"

# ---------------------------------------------------------------------------
# 1. Packages.
#
# A fresh image is not guaranteed to have git or curl, and both are needed
# further down. rsync is here because CI's first deploy step is an rsync into
# the deploy user's home, and a missing binary there fails the workflow rather
# than this script.
# ---------------------------------------------------------------------------
echo "==> ensuring git, curl and rsync are installed"
MISSING=""
for pkg in git curl rsync; do
  command -v "$pkg" >/dev/null 2>&1 || MISSING="$MISSING $pkg"
done
if [ -n "$MISSING" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    # shellcheck disable=SC2086
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $MISSING
  else
    echo "Missing:$MISSING, and this is not an apt system. Install them and re-run." >&2
    exit 1
  fi
else
  echo "    already present"
fi

# ---------------------------------------------------------------------------
# 2. The two accounts.
#
# One sudo account for a human, one unprivileged account for CI. No per app
# users: every app runs in a container inside k3s, so the host needs no service
# accounts of its own.
# ---------------------------------------------------------------------------
create_user() {
  local user="$1"
  if id -u "$user" >/dev/null 2>&1; then
    echo "    $user exists, keeping it"
    return
  fi
  echo "    creating $user"
  if command -v adduser >/dev/null 2>&1; then
    adduser --disabled-password --gecos "" "$user" >/dev/null
  else
    useradd --create-home --shell /bin/bash "$user"
    passwd --lock "$user" >/dev/null
  fi
}

echo "==> accounts"
create_user "$ADMIN_USER"
create_user "$DEPLOY_USER"

# sudo on Debian and Ubuntu, wheel on the RHEL family. Whichever exists wins.
SUDO_GROUP=""
for g in sudo wheel; do
  if getent group "$g" >/dev/null 2>&1; then SUDO_GROUP="$g"; break; fi
done
if [ -n "$SUDO_GROUP" ]; then
  usermod -aG "$SUDO_GROUP" "$ADMIN_USER"
  echo "    $ADMIN_USER added to $SUDO_GROUP"
else
  echo "    no sudo or wheel group found, skipping group membership" >&2
fi

# The deploy account must never gain privilege by accident, so its membership is
# asserted rather than assumed: a host that has been through an earlier manual
# setup may already have it in the wrong place.
if [ -n "$SUDO_GROUP" ] && id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx "$SUDO_GROUP"; then
  gpasswd -d "$DEPLOY_USER" "$SUDO_GROUP" >/dev/null
  echo "    removed $DEPLOY_USER from $SUDO_GROUP (CI does not need it)"
fi

# ---------------------------------------------------------------------------
# 3. How the admin account authenticates to sudo.
#
# `adduser --disabled-password` leaves an account that cannot answer a sudo
# prompt, so sudo has to be reachable some other way or the account is a sudo
# group member that can never use it. Either set a password through the
# environment, or accept a NOPASSWD rule where the SSH key is the only
# credential. Both are stated out loud rather than silently chosen.
# ---------------------------------------------------------------------------
SUDOERS_FILE="/etc/sudoers.d/90-$ADMIN_USER"
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "==> setting a password for $ADMIN_USER (sudo will ask for it)"
  printf '%s:%s\n' "$ADMIN_USER" "$ADMIN_PASSWORD" | chpasswd
  rm -f "$SUDOERS_FILE"
else
  echo "==> no ADMIN_PASSWORD given, granting passwordless sudo to $ADMIN_USER"
  TMP_SUDOERS="$(mktemp)"
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$ADMIN_USER" > "$TMP_SUDOERS"
  # A malformed sudoers file locks every user out of sudo, so it is validated
  # before it is put in place, never after.
  if visudo -c -f "$TMP_SUDOERS" >/dev/null; then
    install -m 440 -o root -g root "$TMP_SUDOERS" "$SUDOERS_FILE"
  else
    echo "Generated sudoers file failed validation, refusing to install it." >&2
    rm -f "$TMP_SUDOERS"
    exit 1
  fi
  rm -f "$TMP_SUDOERS"
fi

# ---------------------------------------------------------------------------
# 4. Authorized keys.
# ---------------------------------------------------------------------------
install_key() {
  local user="$1" key="$2" home ak
  home="$(getent passwd "$user" | cut -d: -f6)"
  ak="$home/.ssh/authorized_keys"
  install -d -m 700 -o "$user" -g "$user" "$home/.ssh"
  [ -f "$ak" ] || : > "$ak"
  # Drop any line that is a documentation placeholder rather than a key. Such a
  # line is inert, but it makes a file that cannot authenticate look like one
  # that should.
  sed -i '/AAAA\.\.\./d' "$ak"
  if grep -qxF "$key" "$ak"; then
    echo "    $user: key already present"
  else
    printf '%s\n' "$key" >> "$ak"
    echo "    $user: key added"
  fi
  chown "$user:$user" "$ak"
  chmod 600 "$ak"
}

echo "==> authorized keys"
install_key "$ADMIN_USER" "$ADMIN_KEY"
install_key "$DEPLOY_USER" "$DEPLOY_KEY"

# ---------------------------------------------------------------------------
# 5. The firewall, off by default.
#
# The two CIDRs are not optional extras: ufw's default forward policy drops
# traffic between pods and to ClusterIP services, so enabling ufw on a k3s node
# without them produces a cluster that comes up and then fails in ways that look
# like application bugs.
# ---------------------------------------------------------------------------
if [ "$FIREWALL" = true ]; then
  if command -v ufw >/dev/null 2>&1; then
    echo "==> configuring ufw (22, 80, 443, and the k3s pod/service CIDRs)"
    ufw allow 22/tcp >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw allow from 10.42.0.0/16 >/dev/null   # pods
    ufw allow from 10.43.0.0/16 >/dev/null   # services
    ufw --force enable >/dev/null
    ufw status verbose | head -20
  else
    echo "==> ufw is not installed, skipping --firewall" >&2
  fi
fi

# ---------------------------------------------------------------------------
# 6. The cluster.
#
# The clone lives in the admin user's home rather than the deploy user's,
# because CI owns ~$DEPLOY_USER/k8s and rsyncs it with --delete on every run. A
# clone there would be destroyed by the first deploy.
# ---------------------------------------------------------------------------
if [ "$RUN_K3S" = true ]; then
  ADMIN_HOME="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
  CLONE="$ADMIN_HOME/nx-portfolio"

  # The git work runs AS the admin user, not as root.
  #
  # git refuses to operate on a repository owned by somebody else ("detected
  # dubious ownership"), and this script is root while the clone belongs to the
  # admin account, so a second run would fail where the first succeeded. Adding
  # a safe.directory exception for root would silence that, but it treats the
  # symptom: root would keep writing root owned objects into a user's tree and
  # relying on a chown afterwards to tidy up. Cloning and fetching as the owner
  # keeps the tree consistently owned and needs no exception at all.
  if [ -d "$CLONE" ]; then
    # Reconcile anything an earlier run left root owned, before git runs as the
    # user and cannot write it.
    chown -R "$ADMIN_USER:$ADMIN_USER" "$CLONE"
  fi

  if [ -d "$CLONE/.git" ]; then
    echo "==> updating the existing clone at $CLONE"
    su - "$ADMIN_USER" -c "git -C '$CLONE' fetch --quiet origin '$REPO_REF' \
      && git -C '$CLONE' checkout --quiet '$REPO_REF' \
      && git -C '$CLONE' reset --hard --quiet 'origin/$REPO_REF'"
  else
    echo "==> cloning $REPO_URL ($REPO_REF) into $CLONE"
    su - "$ADMIN_USER" -c "git clone --quiet --branch '$REPO_REF' '$REPO_URL' '$CLONE'"
  fi

  echo "==> running install.sh --k3s"
  bash "$CLONE/k8s/bootstrap/install.sh" --k3s

  # k3s writes its kubeconfig world readable, so the admin account needs the
  # variable and not a copy of the file.
  BASHRC="$ADMIN_HOME/.bashrc"
  if [ -f "$BASHRC" ] && ! grep -q 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml' "$BASHRC"; then
    printf '\nexport KUBECONFIG=/etc/rancher/k3s/k3s.yaml\n' >> "$BASHRC"
    echo "==> added KUBECONFIG to $BASHRC"
  fi
fi

# ---------------------------------------------------------------------------
# 7. Closing the door, last and only on request.
#
# Guarded rather than trusted: locking root out of a machine whose replacement
# accounts cannot authenticate is the one mistake here with no way back except
# the provider's rescue console.
# ---------------------------------------------------------------------------
if [ "$LOCK_ROOT" = true ]; then
  for user in "$ADMIN_USER" "$DEPLOY_USER"; do
    home="$(getent passwd "$user" | cut -d: -f6)"
    if [ ! -s "$home/.ssh/authorized_keys" ]; then
      echo "$user has no authorized keys. Refusing to disable root login." >&2
      exit 1
    fi
  done

  echo "==> hardening sshd"
  HARDENING="PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes"

  if grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config; then
    printf '%s\n' "$HARDENING" > /etc/ssh/sshd_config.d/99-portfolio-hardening.conf
    chmod 644 /etc/ssh/sshd_config.d/99-portfolio-hardening.conf
    echo "    wrote /etc/ssh/sshd_config.d/99-portfolio-hardening.conf"
  else
    # No drop in directory, so the directives are edited in place. Existing
    # settings are commented rather than deleted, so the original file is still
    # readable afterwards.
    cp /etc/ssh/sshd_config "/etc/ssh/sshd_config.bak.$(date +%Y%m%d%H%M%S)"
    sed -i -E 's/^[[:space:]]*(PermitRootLogin|PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PubkeyAuthentication)\b/#&/' \
      /etc/ssh/sshd_config
    printf '\n# nx-portfolio provision-host.sh\n%s\n' "$HARDENING" >> /etc/ssh/sshd_config
    echo "    appended to /etc/ssh/sshd_config (backup kept alongside it)"
  fi

  # Validate before reloading. A config sshd rejects would otherwise take the
  # daemon down on restart, and remote access with it.
  if ! sshd -t; then
    echo "sshd rejected the new configuration. Nothing was reloaded." >&2
    exit 1
  fi
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  echo "    reloaded. Keep your current root session open until you have"
  echo "    confirmed a NEW login as $ADMIN_USER works."
fi

# ---------------------------------------------------------------------------
# Verification. Printed rather than assumed, in the same spirit as install.sh.
# ---------------------------------------------------------------------------
echo
echo "==> accounts"
for user in "$ADMIN_USER" "$DEPLOY_USER"; do
  home="$(getent passwd "$user" | cut -d: -f6)"
  printf '    %-12s groups: %-24s keys: %s\n' \
    "$user" "$(id -nG "$user" | tr ' ' ',')" \
    "$(grep -c '^ssh-\|^ecdsa-\|^sk-' "$home/.ssh/authorized_keys" 2>/dev/null || echo 0)"
done

if [ "$RUN_K3S" = true ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  echo
  echo "==> node"
  kubectl get nodes
  echo
  echo "==> the deploy user's view of the cluster (this is what CI gets)"
  if su - "$DEPLOY_USER" -c "KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get nodes --no-headers" >/dev/null 2>&1; then
    echo "    OK"
  else
    echo "    FAILED: CI will not be able to deploy" >&2
  fi
fi

echo
echo "Done. Next, in order:"
echo "  1. From a second terminal: ssh $ADMIN_USER@<host> id, and ssh $DEPLOY_USER@<host> id"
if [ "$LOCK_ROOT" = false ]; then
  echo "  2. Re-run this script with --lock-root to disable root login"
fi
echo "  3. Set ipAddress in k8s/helm/values.<env>.yaml and move the five DNS records"
echo "  4. As $ADMIN_USER, in an interactive shell (it prompts for two secrets):"
echo "       bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --env <env> --out ~/luna-<env>-secrets.txt"
echo "  5. Set SSH_DEPLOY_USER=$DEPLOY_USER and the host secret in the GitHub repository"
