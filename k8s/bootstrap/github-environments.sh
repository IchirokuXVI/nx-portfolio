#!/usr/bin/env bash
#
# The GitHub environments one cluster needs (k8s plan 0016 D2, section 6), so
# that pointing CI at a machine is a command and not a settings page.
#
#   bash k8s/bootstrap/github-environments.sh --env staging \
#     --host staging.ichirokuxvi.com --key-file ~/.ssh/nx_staging_deploy
#   bash k8s/bootstrap/github-environments.sh --env production \
#     --host ichirokuxvi.com --key-file ~/.ssh/nx_production_deploy \
#     --soak-host staging.ichirokuxvi.com
#
# For every unit of k8s/units it creates <unit>-<env>, and it creates
# host-<env> for host maintenance. Each gets the secrets SSH_DEPLOY_HOST,
# SSH_DEPLOY_USER and SSH_DEPLOY_KEY and the variable SSH_KNOWN_HOSTS, read
# with ssh-keyscan from the host. host-production also gets SSH_SOAK_CHECK_HOST
# (the staging host it checks before patching) and its two day wait timer.
# Runs from a workstation with `gh auth login` as a repository admin.
#
# Options:
#   --env <staging|production>
#   --host <address>        the machine, as the deploy account reaches it
#   --key-file <path>       the private key of the deploy account (section 1 of the runbook)
#   --user <name>           default: deploy
#   --soak-host <address>   production only: the staging host
#   --units-only            leave host-<env> alone
#   --repo <owner/name>     default: the repository of the current checkout
#
# ALLOW_CUTOVER is not set here. It is a decision for one maintenance window:
#   gh variable set ALLOW_CUTOVER --env <unit>-production --body true

set -euo pipefail

ENVIRONMENT='' HOST='' KEY_FILE='' DEPLOY_USER=deploy SOAK_HOST='' UNITS_ONLY=false REPO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENVIRONMENT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --key-file) KEY_FILE="$2"; shift 2 ;;
    --user) DEPLOY_USER="$2"; shift 2 ;;
    --soak-host) SOAK_HOST="$2"; shift 2 ;;
    --units-only) UNITS_ONLY=true; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    -h | --help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$ENVIRONMENT" in staging | production) ;; *) echo "--env must be staging or production" >&2; exit 2 ;; esac
[ -n "$HOST" ] || { echo "--host is required" >&2; exit 2; }
[ -r "$KEY_FILE" ] || { echo "--key-file must name a readable private key" >&2; exit 2; }
if [ "$ENVIRONMENT" = production ] && [ "$UNITS_ONLY" = false ] && [ -z "$SOAK_HOST" ]; then
  echo "--soak-host is required for host-production: host maintenance checks staging first" >&2
  exit 2
fi
command -v gh > /dev/null || { echo "gh is required" >&2; exit 1; }
[ -n "$REPO" ] || REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

K8S_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../units/unit-env.sh
. "$K8S_DIR/units/unit-env.sh"

# The keys of every host CI talks to in this environment, pinned once.
known_hosts="$(ssh-keyscan -t ed25519 "$HOST" 2> /dev/null)"
[ -n "$known_hosts" ] || { echo "ssh-keyscan found no ed25519 key on $HOST" >&2; exit 1; }
if [ -n "$SOAK_HOST" ]; then
  known_hosts="$known_hosts"$'\n'"$(ssh-keyscan -t ed25519 "$SOAK_HOST" 2> /dev/null)"
fi

environments=()
for unit in $(unit_names "$K8S_DIR"); do environments+=("$unit-$ENVIRONMENT"); done
[ "$UNITS_ONLY" = true ] || environments+=("host-$ENVIRONMENT")

for env in "${environments[@]}"; do
  # An environment that exists keeps its rules (reviewers, tag rules, timer).
  if gh api "repos/$REPO/environments/$env" > /dev/null 2>&1; then
    echo "==> $env exists; setting its values"
  elif [ "$env" = host-production ]; then
    echo "==> $env created with a wait timer of two days"
    gh api -X PUT "repos/$REPO/environments/$env" -F wait_timer=2880 > /dev/null
  else
    echo "==> $env created"
    gh api -X PUT "repos/$REPO/environments/$env" > /dev/null
  fi
  gh secret set SSH_DEPLOY_HOST --repo "$REPO" --env "$env" --body "$HOST"
  gh secret set SSH_DEPLOY_USER --repo "$REPO" --env "$env" --body "$DEPLOY_USER"
  gh secret set SSH_DEPLOY_KEY --repo "$REPO" --env "$env" < "$KEY_FILE"
  gh variable set SSH_KNOWN_HOSTS --repo "$REPO" --env "$env" --body "$known_hosts"
  if [ "$env" = host-production ]; then
    gh secret set SSH_SOAK_CHECK_HOST --repo "$REPO" --env "$env" --body "$SOAK_HOST"
  fi
done

echo
echo "Done. A production environment gets ALLOW_CUTOVER only inside a maintenance window."
