#!/usr/bin/env bash
#
# ng-slot.sh — run the Angular apps (the shell, its four remotes, and the back
# office, which is neither) from a git
# worktree on an isolated "slot", so several worktrees, and therefore several
# agents, can serve the front end at the same time without fighting over ports.
#
# It is the front end twin of k8s/e2e/luna-shopper-backend/luna-slot.sh, in its own
# port band, and the two numberings are INDEPENDENT: front end slot 5
# may talk to backend slot 1, or 2, or 8, and several front end slots may talk to
# one backend at the same time. That last case is the common one, when nobody is
# changing the backend and a single instance serves everybody. See
# `--backend-slot` below for how the pairing is decided.
#
#   tools/dev/ng-slot.sh <slot>          configure this worktree for that slot
#   tools/dev/ng-slot.sh --auto          configure it for the lowest free slot
#   tools/dev/ng-slot.sh --up [<slot>]   configure if needed, then serve
#   tools/dev/ng-slot.sh --restart       bounce the running apps, keeping the slot
#   tools/dev/ng-slot.sh --down          stop, and give the slot back
#   tools/dev/ng-slot.sh --list          every worktree's slot, and what is live
#   tools/dev/ng-slot.sh --e2e-env       print this slot's E2E_BASE_URL export
#
# --- a slot is borrowed, and an .env is yours --------------------------------
#
# --down gives the slot back: it stops the apps, strips this slot's derived keys
# out of the .env files it owns, and deletes the claim. So --up afterwards can
# return a DIFFERENT number, because another worktree may have taken yours in
# between. --restart bounces without releasing, and --down --keep-slot stops
# everything and holds the number.
#
# Nothing else in those files is touched, on any run. A GEMINI_API_KEY pasted in
# by hand, a switch flipped for one experiment, a base URL pointed at a local
# recording: only the keys this script DERIVES from the slot are rewritten, and
# everything else is kept exactly as it is on disk. See DERIVED_KEYS.
#
# --- you almost never need to stop anything ----------------------------------
#
# Every app is served with watch and live reload on, and each app watches its own
# sources AND the libraries it consumes, so editing `libs/velista/...` recompiles
# velista and reaches the browser by itself. Apps are independent processes here,
# so a change to one remote rebuilds only that remote and leaves the other four
# alone; the shell picks the remote up on the next page load.
#
# The exception is the environment. Nx loads `{projectRoot}/.env` when it starts a
# task, and webpack reads MFE_REMOTE_URLS and the DefinePlugin values once while
# building its config, so a running server never sees a rewritten .env. Worse, it
# does not look stuck: the write triggers a watch rebuild that silently reuses the
# startup values. That is what --restart is for.
#
# --- what a slot is ----------------------------------------------------------
#
# An integer N.
#
# Slot 0 is exactly the ports the project.json files already name, and stays that
# way: shell 4200, static remotes 4201, odontogram 4202, damoclesSword 4203,
# landingV2 4204, velista 4205, luna-shopper-admin 4206. It is the developer's own,
# so a lone worktree needs no slot at all and the plain `npx nx serve shell` workflow
# is unchanged.
#
# Every other slot gets a 100 port block up in the 42000s, keeping the shape of
# the defaults so the numbers stay readable:
#
#   slot 1  shell 42000  (static 42001)  odontogram 42002  dSword 42003
#           landingV2 42004  velista 42005  luna-shopper-admin 42006
#   slot 2  the same, plus 100: 42100..42106
#   ...
#   slot 9  42800..42806
#
# The high band is not decoration. `default + N*100` put slot 1 on 4300 and slot 4
# on 4600, right in the range everything else on a developer machine also wants,
# so slots collided with other software instead of with each other. See SLOT_BAND
# for how 42000 was chosen against what Windows actually reserves.
#
# --- why the ports are not simply overridden in project.json -----------------
#
# Because they cannot be. `nx serve shell` runs the module federation dev server,
# which starts the remotes itself and reads each one's port straight out of the
# project graph (`@nx/module-federation/src/utils/parse-static-remotes-config.js`
# and `get-remotes-for-host.js` both do `targets['serve'].options.port`). There is
# no flag and no environment variable for it, and project.json is committed, so a
# worktree cannot move those ports without a diff every branch would carry.
#
# So this script does not ask Nx to orchestrate the remotes. It serves each app as
# its own task with `--port` on the command line, which every app accepts, and
# hands the shell:
#
#   --skipRemotes  so the dev server serves only the host and leaves the remotes
#                  to the tasks started beside it, and
#   MFE_REMOTE_URLS  so the bundle it builds looks for those remotes on the
#                  slot's ports instead of the defaults baked into the graph.
#
# `--excludeTaskDependencies` goes on the remotes because three of them declare
# `dependsOn: ['shell:serve']`, which exists to stop somebody opening a remote on
# its own port and seeing a blank page. Here the shell is already being started
# beside them, on this slot's port, so letting Nx start a second one on the port
# the graph names would recreate exactly the collision this script exists to avoid.
#
# --- what it writes (all git ignored, so it is safe per worktree) ------------
#
#   tools/dev/.env.ng-slot   the slot descriptor, read back by --up/--down/--list
#   apps/shell/.env          MFE_REMOTE_URLS for this slot
#   apps/velista/.env        LUNA_GATEWAY_URL / LUNA_REALTIME_URL for the backend slot
#   apps/luna-shopper-admin/.env  LUNA_GATEWAY_URL for the same backend slot
#   tools/dev/.run/          one .pid and one .log per served app
#
# The two app level files are picked up on their own: Nx loads `{projectRoot}/.env`
# into the environment of that project's tasks, which is the same mechanism the
# luna services already rely on. Nothing has to be exported by the caller.
#
# The e2e suites are the one thing that mechanism cannot reach, because it is per
# PROJECT: apps/shell/.env reaches `nx serve shell` and never a *-e2e task. So the
# descriptor also carries E2E_BASE_URL and `--e2e-env` prints it as an export, the
# one value a caller does have to put in its own environment.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$root"

SLOT_ENV="$here/.env.ng-slot"
RUN_DIR="$here/.run"
PROBE="$here/probe-ports.mjs"

# Every app this script can serve. The order is the order --up starts them and
# --list prints them; `shell` is first because it is the host.
#
# luna-shopper-admin is the one that is not a remote and has no host: it is the back
# office, served from its own origin (its plan 0001), so `--up --apps
# luna-shopper-admin` starts it alone, without the shell or any remote. That is the
# normal way to work on it, and it is roughly a gigabyte rather than the three or
# four a full front end slot costs.
APPS=(shell odontogram damoclesSword landingV2 velista luna-shopper-admin)

# Slot 0 is exactly the ports `project.json` names, and nothing here may change
# them: they are the developer's own, the ones their browser and their tools point
# at, and the ones `npx nx serve shell` uses with no slot at all.
declare -A DEFAULT_PORT=(
  [shell]=4200
  [staticRemotes]=4201
  [odontogram]=4202
  [damoclesSword]=4203
  [landingV2]=4204
  [velista]=4205
  [luna-shopper-admin]=4206
)

# Every OTHER slot lives up here instead, one 100 port block per slot.
#
# It used to be `default + N*100`, which put slot 1 on 4300 and slot 4 on 4600, in
# the middle of the range everything else on a developer machine also wants. That
# produced exactly the collisions the slots exist to prevent, just with other
# software instead of another worktree.
#
# 42000 is chosen against what this machine actually reserves rather than by
# feel. `netsh int ipv4 show dynamicport tcp` puts the Windows ephemeral range at
# 49152 and up, and `netsh int ipv4 show excludedportrange protocol=tcp` puts every
# Hyper-V and WSL reservation at 50000 and up. So 40000..48000 is clear of both,
# while being far above the crowded region below 10000 where the defaults live.
#
# The shape of a block is the shape of the defaults, so the numbers stay readable:
# 4200 becomes 42000, 4205 becomes 42005.
SLOT_BAND=42000
declare -A SLOT_OFFSET=(
  [shell]=0
  # Nx serves static remotes from a file server of its own at the host port plus
  # one. --up skips every remote so nothing binds it, but it is still part of the
  # slot's block and must not be handed to another app.
  [staticRemotes]=1
  [odontogram]=2
  [damoclesSword]=3
  [landingV2]=4
  [velista]=5
  [luna-shopper-admin]=6
)

# How high --auto and --list will look. Ten concurrent front ends is far past what
# a laptop will build, and an open ended scan makes --list slow for no one's
# benefit.
MAX_SLOT=9

# --auto never takes slot 0, which is the same rule the backend has had since
# `parallel-worktree-testing.md` was written: slot 0 is the developer's own
# checkout, on the ports project.json names, and a worker that took it would
# collide with the browser tab they already have open. `ng-slot.sh 0` is still
# accepted, because a person asking for it explicitly means it.
MIN_AUTO_SLOT=1

# Where velista points when nothing is running and nobody has said. Slot 0 is the
# developer's own backend, the one most likely to be up. It is the last rung of
# `detect_backend_slot`, not a coupling to this slot's number.
DEFAULT_BACKEND_SLOT=0

# --- what a re-run is allowed to rewrite -------------------------------------
#
# Every .env below is rendered from a heredoc in write_config, and every one of
# them is a file somebody may have edited by hand. Writing it with `cat >` throws
# that edit away, which is how a pasted key or a flipped switch disappears the
# moment anybody moves a slot. So the rendered text goes through merge_env on its
# way to disk instead, and only the keys the SLOT decides are rewritten.
#
# DERIVED_KEYS is that set, per file. A new slot dependent key must be added
# here. The list is INCLUSIVE, never an exception list: an exception list defaults
# to rewriting, so a key nobody classified stays correct, while this defaults to
# preserving, so a key nobody classified keeps a stale value. warn_foreign_ports
# is the net under that, and it is the reason the trade is acceptable.
#
# The descriptor, tools/dev/.env.ng-slot, is the exception to all of it: it is
# this script's own bookkeeping, every value in it is derived, and the one choice
# it carries across a re-run (NG_BACKEND_SLOT) already has a function that reads
# it back. It is generated whole, with no merge.
declare -A DERIVED_KEYS=(
  [shell]='MFE_REMOTE_URLS'
  [velista]='LUNA_GATEWAY_URL LUNA_REALTIME_URL'
  [luna-shopper-admin]='LUNA_GATEWAY_URL'
)

# How this run treats the keys it does not derive.
#
#   ''      keep whatever is on disk. The default.
#   reset   put them back to the template default, except those named in
#           KEEP_ENV. --reset-env, for when a preserved value is the thing that
#           broke the stack.
#   strip   leave the derived keys out of the file altogether and keep the rest.
#           What a releasing --down writes: the file survives with its hand edits
#           in it, and nothing left in it points at a slot this worktree has
#           given back.
MERGE_MODE=''
KEEP_ENV=''

# Every port this slot may legitimately name, the backend it talks to included.
# write_config fills it; warn_foreign_ports reads it.
ALLOWED_PORTS=''

# Merge the rendered template on stdin into $1, which need not exist yet. $2 is
# the space separated list of keys this slot decides.
#
#   the key is                     the result
#   -----------------------------  ------------------------------
#   in $2                          the freshly computed value
#   present in the file on disk    the value on disk, verbatim
#   absent from the file on disk   the template default, inserted
#
# A key on disk that the template does not name is kept, appended under a marked
# comment.
#
# A BLANK VALUE IS A VALUE. `LUNA_GATEWAY_URL=` present and empty is a decision,
# so only a key that is genuinely ABSENT takes the template default. Treating
# blank as absent overwrites that decision on every run, which is the defect this
# whole mechanism exists to fix.
#
# Parsing rules, stated because each one is a way to be silently wrong:
#
#   - only an uncommented `^[A-Za-z_][A-Za-z0-9_]*=` line counts as a key, so
#     `# LUNA_GATEWAY_URL=x` is a comment and that key is absent
#   - the value is the rest of the line, verbatim, so quotes and a `#` inside a
#     value survive
#   - a key that appears twice keeps its FIRST value, which is what dotenv does
#     when it reads the same file
#   - multi line values are not supported. No file this script writes has one.
merge_env() {
  local target="$1" derived="${2:-}"

  local disk="$target"
  [[ -f "$disk" ]] || disk='/dev/null'

  # Beside the target rather than in /tmp, so the rename is on one filesystem and
  # a half written file can never be what a service reads.
  local tmp="$target.ng-slot.tmp"

  awk -v derived="$derived" -v keep="$KEEP_ENV" -v mode="$MERGE_MODE" '
    BEGIN {
      n = split(derived, a, /[ ,]+/)
      for (i = 1; i <= n; i++) if (a[i] != "") is_derived[a[i]] = 1
      n = split(keep, b, /[ ,]+/)
      for (i = 1; i <= n; i++) if (b[i] != "") is_kept[b[i]] = 1
    }

    # Pass one: the file already on disk.
    #
    # Selected on FILENAME rather than the usual `FNR == NR`, because the file
    # very often does not exist and /dev/null takes its place. With an empty first
    # input FNR == NR stays true right through the second one, so the whole
    # template is read as though it were already on disk and nothing is printed at
    # all. The template is the only input given as `-`.
    FILENAME != "-" {
      if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
        eq = index($0, "=")
        key = substr($0, 1, eq - 1)
        if (!(key in on_disk)) {
          on_disk[key] = substr($0, eq + 1)
          order[++count] = key
        }
      }
      next
    }

    # Pass two: the freshly rendered template. Its comments and blank lines are
    # what the file looks like, so they are printed unconditionally.
    {
      if ($0 !~ /^[A-Za-z_][A-Za-z0-9_]*=/) { print; next }
      eq = index($0, "=")
      key = substr($0, 1, eq - 1)
      in_template[key] = 1

      if (key in is_derived) {
        if (mode == "strip") next
        print
        next
      }
      if (mode == "reset" && !(key in is_kept)) { print; next }
      if (key in on_disk) { print key "=" on_disk[key]; next }
      print
    }

    END {
      # A key on disk the template does not name is somebody addition, or a key
      # this script used to write. Keeping it is the point; saying where it came
      # from stops the next reader taking it for generated output.
      for (i = 1; i <= count; i++) {
        key = order[i]
        if (key in in_template) continue
        if (!said) {
          print ""
          print "# --- kept from the file that was here: keys this script does not write ---"
          said = 1
        }
        print key "=" on_disk[key]
      }
    }
  ' "$disk" - > "$tmp"

  mv -f "$tmp" "$target"
  warn_foreign_ports "$target" "$derived"
}

# The net under the inclusive DERIVED_KEYS list.
#
# A slot dependent key nobody added to that list keeps a stale port, and a stale
# port is the worst failure this area has: an app pointed at another worktree's
# backend, which looks like working software until the data is wrong. This turns
# it into one line of output.
#
# It changes nothing. `LUNA_GATEWAY_URL=http://localhost:43100` is a legitimate
# hand edit when somebody is aiming at a particular backend on purpose, and no
# script can tell that apart from a forgotten key.
warn_foreign_ports() {
  local file="$1" derived="${2:-}"
  [[ -f "$file" ]] || return 0

  local line key value port
  while IFS= read -r line; do
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    key="${line%%=*}"
    [[ " $derived " == *" $key "* ]] && continue
    value="${line#*=}"
    while IFS= read -r port; do
      [[ -n "$port" ]] || continue
      [[ " $ALLOWED_PORTS " == *" $port "* ]] && continue
      echo "  WARNING: ${file#"$root/"} keeps ${key}, which names port ${port}." >&2
      echo "           That is not this slot's. Either somebody meant it, or the" >&2
      echo "           key belongs in DERIVED_KEYS. Nothing was changed." >&2
    done < <(printf '%s\n' "$value" | grep -oE '\b4[23][0-9]{3}\b' | sort -u || true)
  done < "$file"
}

usage() {
  cat >&2 <<'EOF'
usage:
  ng-slot.sh <slot> [--backend-slot <n>]   configure this worktree for that slot
  ng-slot.sh --auto [--backend-slot <n>]   configure it for the lowest free slot
  ng-slot.sh --up [<slot>] [--apps a,b]    configure if needed, then serve
  ng-slot.sh --restart [--apps a,b]        bounce apps, keeping the rest serving
  ng-slot.sh --down [--keep-slot]          stop, and give the slot back
  ng-slot.sh --list                        every worktree's slot, and what is live
  ng-slot.sh --e2e-env                     print this slot's E2E_BASE_URL export

Point an e2e suite at this slot rather than at slot 0's ports:

  eval "$(tools/dev/ng-slot.sh --e2e-env)"
  npx nx e2e velista-e2e

Source changes need none of this: every app watches its own files and the
libraries it consumes, and live reloads. --restart is for a changed .env (a slot
move, or --backend-slot), which a running server cannot pick up.

options:
  --apps a,b,c        limit --up or --restart to these apps
                      (--up default: all five; --restart default: whatever of
                      this slot is currently running)
  --keep-slot         with --down: stop the apps but keep the claim and every
                      value, so a plain `npx nx serve velista` still works and
                      --up gets this same number back. Without it, --down gives
                      the slot back and --up may hand you a different one.
                      Slot 0 always behaves this way; nothing takes it.
  --reset-env         put every key this script does not derive back to its
                      shipped default. Preservation is what makes a hand edit
                      survive a re-run, and this is the repair for the first time
                      a preserved value is the thing that broke the stack.
  --keep-env A,B      with --reset-env, leave these keys alone. An error on its
                      own: with nothing being reset there is nothing to keep.
  --backend-slot <n>  which luna-shopper slot velista should talk to. It is NOT
                      this slot's number: the two numberings are independent, and
                      one backend can serve every front end slot at once. Left
                      out, the backend is worked out in this order:
                        1. the choice already recorded for this worktree
                        2. the luna slot this worktree runs itself, if any
                        3. the only backend gateway that is listening
                        4. backend slot 0 if it is listening
                        5. backend slot 0 anyway, with a note
  --timeout <secs>    how long --up waits for each app to answer (default 300)

There is no --keep-data here, because the front end has no data. --keep-slot is
what holds a front end slot, and a claim is already enough to make --auto skip
it. The lock --keep-data writes on the backend has no counterpart on this side.
EOF
}

# --- slot arithmetic ---------------------------------------------------------

# The port one app gets on one slot. Slot 0 is the defaults, untouched; every other
# slot is its block in the high band. One function, so nothing can hold a second
# copy of that rule.
port_for() {
  local app="$1" slot="$2"
  if (( slot == 0 )); then
    echo "${DEFAULT_PORT[$app]}"
  else
    echo $(( SLOT_BAND + (slot - 1) * 100 + SLOT_OFFSET[$app] ))
  fi
}

# Every port a slot occupies, including the static remote file server that --up
# never starts. Used by --down, --list and the free slot search, so all three agree
# on what "this slot is busy" means.
slot_ports() {
  local slot="$1" app
  for app in "${APPS[@]}"; do
    port_for "$app" "$slot"
  done
  port_for staticRemotes "$slot"
}

# --- reading the other worktrees ---------------------------------------------

# Every checkout of this repository, this one included. `git worktree list` is the
# only source of truth for that; scanning .claude/worktrees would miss a worktree
# created anywhere else and would list one that has already been removed.
worktree_paths() {
  git worktree list --porcelain 2>/dev/null | awk '/^worktree /{ $1=""; sub(/^ /,""); print }'
}

# The slot a checkout is configured for, or nothing. Read from the file the
# configure step writes, so a worktree states its own slot and no shared registry
# has to be kept in step with reality.
slot_of_worktree() {
  local wt="$1" file="$wt/tools/dev/.env.ng-slot"
  [[ -f "$file" ]] || return 0
  sed -n 's/^NG_SLOT=\([0-9]\+\)[[:space:]]*$/\1/p' "$file" | head -n 1
}

# port -> open|closed|unknown, for a batch of ports in one node process.
probe_ports() {
  (( $# )) || return 0
  node "$PROBE" "$@"
}

# --- which backend velista should talk to ------------------------------------
#
# Deliberately not "the same number as this slot". The two numberings are
# independent: a front end slot exists to stop two dev servers fighting over 4200,
# and a backend slot exists to stop two compose stacks fighting over 5432. Neither
# implies the other, and the usual arrangement is several front end worktrees all
# pointed at one backend, because most front end work needs a backend running, not
# a backend of its own.
#
# So it is worked out rather than assumed, in an order that puts a human's stated
# choice first and a running instance ahead of a guess.

# The port a Luna service gets on a backend slot.
#
# It restates k8s/e2e/luna-shopper-backend/luna-slot.sh's arithmetic, which is a
# duplication worth being explicit about: this script has to know where the backend
# listens (to point velista at it, and to find which backends are running), the two
# scripts are independent entry points with no shared library between them, and a
# shell function cannot be imported from a different tool without turning one into
# a dependency of the other. Both files name the same constants and both say so; if
# either band moves, this moves with it. The symptom of getting it wrong is this
# script naming a gateway port that the backend script never serves on, which is
# exactly what happened when the backend moved to its high band and this did not.
BACKEND_SLOT_BAND=43000
declare -A BACKEND_DEFAULT_PORT=([gateway]=3000 [realtime]=3001)
declare -A BACKEND_SLOT_OFFSET=([gateway]=0 [realtime]=1)

backend_port() {
  local service="$1" slot="$2"
  if (( slot == 0 )); then
    echo "${BACKEND_DEFAULT_PORT[$service]}"
  else
    echo $(( BACKEND_SLOT_BAND + (slot - 1) * 100 + BACKEND_SLOT_OFFSET[$service] ))
  fi
}

# The luna slot this same worktree is configured for, if it runs its own backend.
# This is the real pairing when there is one: same worktree, not same number.
own_backend_slot() {
  local file="$root/k8s/e2e/luna-shopper-backend/.env.slot"
  [[ -f "$file" ]] || return 0
  sed -n 's/^LUNA_SLOT=\([0-9]\+\)[[:space:]]*$/\1/p' "$file" | head -n 1
}

# The backend slots whose gateway is answering right now.
#
# The slot each port belongs to is carried alongside rather than recovered by
# arithmetic from the port number: slot 0's gateway is 3000 and the rest are up in
# the 43000s, so there is no single sum that inverts both.
running_backend_slots() {
  local slot state port
  local -a ports=() slots=()
  for (( slot = 0; slot <= MAX_SLOT; slot++ )); do
    ports+=("$(backend_port gateway "$slot")")
    slots+=("$slot")
  done

  local i=0
  while IFS=$'\t' read -r port state; do
    [[ "$state" == "open" ]] && echo "${slots[$i]}"
    i=$(( i + 1 ))
  done < <(probe_ports "${ports[@]}")
}

# Writes the slot on stdout and its justification on stderr, so a caller can
# report why without the value being polluted by the explanation.
detect_backend_slot() {
  local recorded
  if [[ -f "$SLOT_ENV" ]]; then
    recorded="$(sed -n 's/^NG_BACKEND_SLOT=\([0-9]\+\)[[:space:]]*$/\1/p' "$SLOT_ENV" | head -n 1)"
    if [[ -n "$recorded" ]]; then
      echo "keeping the backend slot this worktree already records" >&2
      echo "$recorded"
      return 0
    fi
  fi

  local own
  own="$(own_backend_slot)"
  if [[ -n "$own" ]]; then
    echo "this worktree runs its own backend on luna slot ${own}" >&2
    echo "$own"
    return 0
  fi

  local -a running=()
  mapfile -t running < <(running_backend_slots)
  if (( ${#running[@]} == 1 )); then
    echo "the only backend gateway listening is luna slot ${running[0]}" >&2
    echo "${running[0]}"
    return 0
  fi
  if (( ${#running[@]} > 1 )); then
    local slot
    for slot in "${running[@]}"; do
      if [[ "$slot" == "0" ]]; then
        echo "several backends are up; taking slot 0, the shared one (--backend-slot to pick another: ${running[*]})" >&2
        echo 0
        return 0
      fi
    done
    echo "several backends are up (${running[*]}); taking the lowest, ${running[0]} (--backend-slot to pick another)" >&2
    echo "${running[0]}"
    return 0
  fi

  echo "no backend gateway is listening; pointing at luna slot 0, the default" >&2
  echo "$DEFAULT_BACKEND_SLOT"
}

# --- configure ---------------------------------------------------------------

write_config() {
  local slot="$1" backend_slot="$2"

  local shell_port odontogram_port damocles_port landing_port velista_port admin_port
  shell_port=$(port_for shell "$slot")
  odontogram_port=$(port_for odontogram "$slot")
  damocles_port=$(port_for damoclesSword "$slot")
  landing_port=$(port_for landingV2 "$slot")
  velista_port=$(port_for velista "$slot")
  admin_port=$(port_for luna-shopper-admin "$slot")

  local gateway_port realtime_port
  gateway_port=$(backend_port gateway "$backend_slot")
  realtime_port=$(backend_port realtime "$backend_slot")

  # What warn_foreign_ports will accept in a preserved value: every port of this
  # slot, plus the two the backend this slot points at listens on. Those two are
  # a different numbering (see detect_backend_slot), so they have to be added
  # rather than derived from this slot's number.
  ALLOWED_PORTS="$(slot_ports "$slot" | tr '\n' ' ')${gateway_port} ${realtime_port}"

  mkdir -p "$RUN_DIR"

  # The descriptor is generated whole, with no merge: it is this script's own
  # bookkeeping and every value in it is derived. A releasing --down is about to
  # delete it, so strip mode does not write it at all.
  if [[ "$MERGE_MODE" != 'strip' ]]; then
  cat > "$SLOT_ENV" <<EOF
# Generated by ng-slot.sh for slot ${slot}. Git ignored.
# This file is what makes the slot durable: --up, --down and every other
# worktree's --list read this worktree's slot back out of it.
NG_SLOT=${slot}
NG_BACKEND_SLOT=${backend_slot}
NG_SHELL_PORT=${shell_port}
NG_STATIC_REMOTES_PORT=$(port_for staticRemotes "$slot")
NG_ODONTOGRAM_PORT=${odontogram_port}
NG_DAMOCLESSWORD_PORT=${damocles_port}
NG_LANDINGV2_PORT=${landing_port}
NG_VELISTA_PORT=${velista_port}
NG_LUNA_SHOPPER_ADMIN_PORT=${admin_port}
NG_SHELL_URL=http://localhost:${shell_port}
NG_VELISTA_URL=http://localhost:${velista_port}
NG_LUNA_SHOPPER_ADMIN_URL=http://localhost:${admin_port}
# What the e2e suites read. Every front end suite drives its app through the
# shell, so this slot's shell origin is the answer for all four of them; see
# --e2e-env, which prints it as an export for \`eval\`.
E2E_BASE_URL=http://localhost:${shell_port}
EOF
  fi

  # The shell resolves its remotes at build time (apps/shell/remote-urls.ts), and
  # already reads this variable in the dev config, so moving the remotes needs no
  # change to the shell at all. Every remote is named explicitly rather than left
  # to fall back, because a name absent from the map keeps the port the project
  # graph gave it, which on any slot but 0 is another worktree's.
  merge_env "$root/apps/shell/.env" "${DERIVED_KEYS[shell]}" <<EOF
# Generated by ng-slot.sh (slot ${slot}). Git ignored.
# Nx loads {projectRoot}/.env into this project's tasks, so \`nx serve shell\`
# picks this up with nothing exported by the caller.
MFE_REMOTE_URLS=odontogram=http://localhost:${odontogram_port},damoclesSword=http://localhost:${damocles_port},landingV2=http://localhost:${landing_port},velista=http://localhost:${velista_port}
EOF

  # velista and luna-shopper-admin are the two front ends that talk to a backend,
  # so they are the two this half of the slot reaches. The backend they name is a
  # separate number (see detect_backend_slot): one backend commonly serves several
  # front end slots, and its CORS list allows every one of them.
  merge_env "$root/apps/velista/.env" "${DERIVED_KEYS[velista]}" <<EOF
# Generated by ng-slot.sh (slot ${slot}, luna-shopper slot ${backend_slot}). Git ignored.
# Read by apps/velista/webpack.config.ts and substituted into environment.ts at
# compile time, the same way webpack.prod.config.ts supplies the deployed hosts.
LUNA_GATEWAY_URL=http://localhost:${gateway_port}
LUNA_REALTIME_URL=http://localhost:${realtime_port}
EOF

  # The back office reaches the same gateway on different routes, and no realtime
  # service at all: it polls and never subscribes (its plan 0001, section 4).
  merge_env "$root/apps/luna-shopper-admin/.env" "${DERIVED_KEYS[luna-shopper-admin]}" <<EOF
# Generated by ng-slot.sh (slot ${slot}, luna-shopper slot ${backend_slot}). Git ignored.
# Read by apps/luna-shopper-admin/webpack.config.ts and substituted into
# environment.ts at compile time.
LUNA_GATEWAY_URL=http://localhost:${gateway_port}
EOF

  # A releasing --down renders these same templates to strip the derived keys out
  # of them, and has nothing to announce: the slot is being given back, not taken.
  [[ "$MERGE_MODE" == 'strip' ]] && return 0

  cat <<EOF

Configured this worktree for Angular slot ${slot}.
  shell         http://localhost:${shell_port}
  odontogram    http://localhost:${odontogram_port}
  damoclesSword http://localhost:${damocles_port}
  landingV2     http://localhost:${landing_port}
  velista       http://localhost:${velista_port}   (own origin, plan 0013)
  admin         http://localhost:${admin_port}   (own origin, not a remote)
  reserved      $(port_for staticRemotes "$slot"), held for Nx's static remote server
  backend       luna-shopper slot ${backend_slot}: gateway ${gateway_port}, realtime ${realtime_port}
                (an independent number, not this slot's; --backend-slot <n> moves it)

Serve it:
  tools/dev/ng-slot.sh --up
EOF
}

# The lowest slot no other worktree claims and nothing is listening on. Both
# conditions matter: a claim with nothing running is a worktree that is configured
# but idle and would collide the moment it starts, and an open port with no claim
# is something outside this repository that would collide right now.
find_free_slot() {
  local -A claimed=()
  local wt s
  local self
  self="$(cd "$root" && pwd)"
  while IFS= read -r wt; do
    [[ -n "$wt" ]] || continue
    [[ "$(cd "$wt" 2>/dev/null && pwd)" == "$self" ]] && continue
    s="$(slot_of_worktree "$wt")"
    [[ -n "$s" ]] && claimed[$s]="$wt"
  done < <(worktree_paths)

  # Why each slot was passed over, kept so that running out can say so. The two
  # causes have different fixes, and one message for both is not enough.
  local -A why=()
  local slot ports port state busy
  for (( slot = MIN_AUTO_SLOT; slot <= MAX_SLOT; slot++ )); do
    if [[ -n "${claimed[$slot]:-}" ]]; then
      why[$slot]="claimed by ${claimed[$slot]}"
      continue
    fi
    mapfile -t ports < <(slot_ports "$slot")
    busy=0
    while IFS=$'\t' read -r port state; do
      if [[ "$state" != "closed" ]]; then
        (( busy )) || why[$slot]="port ${port} is ${state}, and no checkout of this repository claims it"
        busy=1
      fi
    done < <(probe_ports "${ports[@]}")
    if (( ! busy )); then
      echo "$slot"
      return 0
    fi
  done

  echo "no free Angular slot in ${MIN_AUTO_SLOT}..${MAX_SLOT}. Every one, and why:" >&2
  for (( slot = MIN_AUTO_SLOT; slot <= MAX_SLOT; slot++ )); do
    printf '  %-2s %s\n' "$slot" "${why[$slot]:-unavailable}" >&2
  done
  echo "(slot 0 is the developer's own, and --auto never takes it)" >&2
  echo >&2
  echo "The two causes have different fixes:" >&2
  echo "  claimed    that worktree still holds the number. --down in it gives the slot" >&2
  echo "             back now; --down --keep-slot is what holds one on purpose." >&2
  echo "  listening  something outside this repository has the port, so no --down" >&2
  echo "             anywhere will free it." >&2
  echo >&2
  echo "STOP HERE AND ASK THE USER which slot to take. Do not improvise a port: a port" >&2
  echo "outside the band is a collision with the software this scheme was moved away" >&2
  echo "from, and it will not be found by --list." >&2
  return 1
}

# --- serving -----------------------------------------------------------------

require_config() {
  [[ -f "$SLOT_ENV" ]] || return 1
  # shellcheck disable=SC1090
  . "$SLOT_ENV"
  [[ -n "${NG_SLOT:-}" ]]
}

# Print this slot's e2e URLs as exports, for `eval`. The backend half has done it
# this way since run-services.sh grew a `ports` verb, and stack.sh consumes it the
# same way, so the front end reads the same on both sides of the stack.
#
# It exists because Nx loads {projectRoot}/.env per PROJECT: apps/shell/.env
# reaches `nx serve shell` and nothing else, so no file this script writes can
# reach a *-e2e project's task. Something has to cross that gap in the caller's
# environment, and a value derived from the slot beats a port read off the table
# by eye.
e2e_env() {
  if ! require_config; then
    echo "this worktree has no Angular slot; run --up or --auto first." >&2
    return 1
  fi
  echo "export E2E_BASE_URL=http://localhost:${NG_SHELL_PORT}"
}

serve_app() {
  local app="$1" port="$2"
  local log="$RUN_DIR/$app.log" pidfile="$RUN_DIR/$app.pid"
  local -a cmd=(npx nx run "$app:serve" --port "$port" --publicHost "http://localhost:$port")

  if [[ "$app" == "shell" ]]; then
    # Serve the host alone. The remotes are still in module-federation.config.ts,
    # so the bundle still fetches them; MFE_REMOTE_URLS is what redirects it to
    # this slot's ports, and the tasks started below are what answer there.
    cmd+=(--skipRemotes "odontogram,damoclesSword,landingV2,velista")
  else
    # See the note at the top: three remotes declare dependsOn shell:serve, and
    # honouring it here would start a second shell on the default port.
    cmd+=(--excludeTaskDependencies)
  fi

  echo "==> $app on http://localhost:$port  (log: tools/dev/.run/$app.log)"
  "${cmd[@]}" > "$log" 2>&1 &
  echo $! > "$pidfile"
  disown $! 2>/dev/null || true
}

# Wait until every port answers, or until the timeout. An `--up` that returned as
# soon as the processes were spawned would report success while webpack was still
# on its first build, which is the same lie `helm upgrade` without --wait tells.
wait_for_ports() {
  local timeout="$1"; shift
  local -a ports=("$@")
  local deadline=$(( SECONDS + timeout ))
  local pending state port

  while (( SECONDS < deadline )); do
    pending=0
    while IFS=$'\t' read -r port state; do
      [[ "$state" == "open" ]] || pending=$(( pending + 1 ))
    done < <(probe_ports "${ports[@]}")
    (( pending == 0 )) && return 0
    sleep 2
  done

  return 1
}

up() {
  local requested_slot="$1" backend_slot="$2" apps_csv="$3" timeout="$4"

  # --auto in a worktree that already holds a claim keeps that number rather than
  # taking a fresh one. Taking a fresh one abandons whatever is still running on
  # the old number, which is what stopped `--up --auto` being the one command an
  # agent can always run.
  if [[ "$requested_slot" == 'auto' ]]; then
    if require_config; then
      echo "==> this worktree already holds Angular slot ${NG_SLOT}; --auto keeps it."
      requested_slot=''
    else
      requested_slot="$(find_free_slot)"
    fi
  fi

  if [[ -n "$requested_slot" ]]; then
    write_config "$requested_slot" "${backend_slot:-$(detect_backend_slot)}"
  elif ! require_config; then
    local slot
    slot="$(find_free_slot)"
    echo "==> this worktree has no slot yet; taking the lowest free one: ${slot}"
    write_config "$slot" "${backend_slot:-$(detect_backend_slot)}"
  elif [[ -n "$backend_slot" && "$backend_slot" != "${NG_BACKEND_SLOT:-}" ]]; then
    write_config "$NG_SLOT" "$backend_slot"
  fi

  require_config || { echo "could not read $SLOT_ENV after writing it" >&2; return 1; }

  local -a wanted=()
  if [[ -n "$apps_csv" ]]; then
    IFS=',' read -r -a wanted <<< "$apps_csv"
    local app
    for app in "${wanted[@]}"; do
      [[ -n "${SLOT_OFFSET[$app]:-}" ]] || { echo "unknown app '$app'; known: ${APPS[*]}" >&2; return 2; }
    done
  else
    wanted=("${APPS[@]}")
  fi

  # Refuse rather than pile a second server onto a port somebody is already using.
  # A half started slot is harder to diagnose than one that never started.
  local app port state busy=0
  for app in "${wanted[@]}"; do
    port=$(port_for "$app" "$NG_SLOT")
    state="$(probe_ports "$port" | cut -f2)"
    if [[ "$state" != "closed" ]]; then
      echo "port $port ($app, slot $NG_SLOT) is already $state" >&2
      busy=1
    fi
  done
  if (( busy )); then
    echo "nothing was started. Run --down first, or --list to see who has this slot." >&2
    return 1
  fi

  mkdir -p "$RUN_DIR"
  local -a ports=()
  for app in "${wanted[@]}"; do
    port=$(port_for "$app" "$NG_SLOT")
    serve_app "$app" "$port"
    ports+=("$port")
  done

  echo "==> waiting up to ${timeout}s for the first build of each app"
  if wait_for_ports "$timeout" "${ports[@]}"; then
    echo
    echo "Angular slot $NG_SLOT is up."
    for app in "${wanted[@]}"; do
      printf '  %-14s http://localhost:%s\n' "$app" "$(port_for "$app" "$NG_SLOT")"
    done
    echo
    echo "Remember the shell owns the outlet: open a remote at the shell's URL"
    echo "(http://localhost:$NG_SHELL_PORT/<app>/<locale>), not at its own port."
    echo "velista is the exception and renders standalone on $NG_VELISTA_PORT."
    echo
    echo "To run an e2e suite against this slot instead of slot 0:"
    echo "  eval \"\$(tools/dev/ng-slot.sh --e2e-env)\""
    echo "  npx nx e2e velista-e2e"
    return 0
  fi

  echo >&2
  echo "timed out after ${timeout}s. These are not answering yet:" >&2
  while IFS=$'\t' read -r port state; do
    [[ "$state" == "open" ]] && continue
    for app in "${wanted[@]}"; do
      [[ "$(port_for "$app" "$NG_SLOT")" == "$port" ]] && echo "  $app ($port): $state, see tools/dev/.run/$app.log" >&2
    done
  done < <(probe_ports "${ports[@]}")
  echo "The processes are still running; --down stops them." >&2
  return 1
}

# --- stopping ----------------------------------------------------------------

# Kill whatever holds a port, rather than the pid this script recorded.
#
# `nx serve` is a wrapper: the process that binds the port is a grandchild, and on
# Windows the pid bash hands back is an MSYS pid that taskkill does not recognise.
# Killing the recorded pid therefore leaves the server running and the port taken,
# which is the one outcome --down must not produce. The port is the thing being
# freed, so the port is what to resolve.
kill_port() {
  local port="$1" pid killed=0
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      # Windows netstat: Proto, Local Address, Foreign Address, State, PID.
      while read -r pid; do
        [[ -n "$pid" && "$pid" != "0" ]] || continue
        # //F //T: the whole tree, because the node process that binds the port is
        # a child of the one npx started. The doubled slash is MSYS path escaping.
        taskkill //F //T //PID "$pid" >/dev/null 2>&1 && killed=1
      done < <(netstat -ano | tr -d '\r' | awk -v p=":$port\$" '$1=="TCP" && $2 ~ p && $4=="LISTENING" { print $5 }' | sort -u)
      ;;
    *)
      if command -v lsof >/dev/null 2>&1; then
        while read -r pid; do
          [[ -n "$pid" ]] || continue
          kill -TERM "$pid" 2>/dev/null && killed=1
        done < <(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | sort -u)
      elif command -v fuser >/dev/null 2>&1; then
        fuser -k "$port/tcp" >/dev/null 2>&1 && killed=1
      fi
      ;;
  esac
  return $(( killed ? 0 : 1 ))
}

# Bounce some of this slot's apps, leaving the rest of it serving.
#
# Almost nothing needs this. Every app is served with watch and live reload on, so
# a source change anywhere, this app's own files or a library it consumes,
# recompiles and reaches the browser with no help. What does NOT reach a running
# server is the environment: Nx loads `{projectRoot}/.env` into a task when it
# starts it, and webpack evaluates `MFE_REMOTE_URLS` and the DefinePlugin's values
# once, while building the config. So after `--backend-slot` or a slot move, the
# server keeps serving the old URLs.
#
# That case is worth a verb of its own because it is invisible otherwise: rewriting
# a .env does trigger a watch rebuild, and the rebuild silently reuses the values
# read at startup. Nothing looks wrong; the app just talks to the wrong backend.
#
# `--down` would also fix it, at the cost of every app's first build. This bounces
# only what is named and leaves the others up.
restart() {
  local apps_csv="$1" timeout="$2"

  if ! require_config; then
    echo "this worktree has no slot configured, so there is nothing to restart." >&2
    return 1
  fi

  local -a wanted=()
  local app port state
  if [[ -n "$apps_csv" ]]; then
    IFS=',' read -r -a wanted <<< "$apps_csv"
    for app in "${wanted[@]}"; do
      [[ -n "${SLOT_OFFSET[$app]:-}" ]] || { echo "unknown app '$app'; known: ${APPS[*]}" >&2; return 2; }
    done
  else
    # Default to whatever this slot currently has up, so a restart never quietly
    # starts an app the worker had deliberately left out of --up.
    for app in "${APPS[@]}"; do
      port=$(port_for "$app" "$NG_SLOT")
      state="$(probe_ports "$port" | cut -f2)"
      [[ "$state" == "open" ]] && wanted+=("$app")
    done
    if (( ${#wanted[@]} == 0 )); then
      echo "nothing of Angular slot $NG_SLOT is running; use --up to start it." >&2
      return 1
    fi
  fi

  mkdir -p "$RUN_DIR"
  local -a ports=()
  for app in "${wanted[@]}"; do
    ports+=("$(port_for "$app" "$NG_SLOT")")
  done

  echo "==> stopping ${wanted[*]}"
  stop_apps wanted ports || true

  local -a started=()
  for app in "${wanted[@]}"; do
    port=$(port_for "$app" "$NG_SLOT")
    serve_app "$app" "$port"
    started+=("$port")
  done
  ports=("${started[@]}")

  echo "==> waiting up to ${timeout}s for the restarted apps"
  if wait_for_ports "$timeout" "${ports[@]}"; then
    echo "restarted on Angular slot $NG_SLOT: ${wanted[*]}"
    return 0
  fi
  echo "timed out; the processes are still running, see tools/dev/.run/*.log" >&2
  return 1
}

# Stop the recorded wrapper processes, then free the ports, then free them again.
#
# Killing by port alone is not enough, and the gap is not theoretical: an app that
# has been spawned but has not bound yet is invisible to a port sweep, so it
# survives the stop and binds a moment later. That is how a `--down` followed by an
# `--up` ends in "port 4300 is already open" with nothing visibly running.
#
# So: kill the recorded pid first, which stops the `npx` wrapper before it can hand
# the port to a child, then sweep the ports for anything already listening, then
# pause and sweep once more for whatever bound during the first pass.
# Kill a recorded pid ONLY if it still looks like the process that was recorded.
#
# A .pid file outlives the process it names, and the operating system reuses pids.
# Killing one unverified means killing whatever inherited the number, which on a
# developer machine could be another worktree's dev server, the editor, or the
# thing the developer is actually working in.
#
# The port sweep below is what actually guarantees the port is free. This is only
# here to stop a wrapper spawning a replacement first, so declining to kill an
# unrecognised pid costs nothing and removes the chance of killing a stranger.
kill_recorded_pid() {
  local pid="$1" cmdline=''
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0

  # Where /proc exists the command line settles it outright.
  if [[ -r "/proc/$pid/cmdline" ]]; then
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmdline" in
      *node*|*npx*|*npm*|*nx*) ;;
      *) return 0 ;;
    esac
  fi

  kill -TERM "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
}

# Both arguments name arrays in the caller: the apps to stop, and their ports. It
# is scoped to those names rather than sweeping the whole .run directory, because
# `--restart --apps velista` must leave the shell's process, and its pid file,
# alone.
stop_apps() {
  local -n _apps="$1"
  local -n _ports="$2"
  local app pidfile pid port freed=0 pass

  for app in "${_apps[@]}"; do
    pidfile="$RUN_DIR/$app.pid"
    [[ -e "$pidfile" ]] || continue
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    [[ -n "$pid" ]] && kill_recorded_pid "$pid"
    rm -f "$pidfile"
  done

  for pass in 1 2; do
    for port in "${_ports[@]}"; do
      if kill_port "$port"; then
        echo "  freed $port"
        freed=$(( freed + 1 ))
      fi
    done
    (( pass == 1 )) && sleep 3
  done

  return $(( freed ? 0 : 1 ))
}

# Give the slot back: strip this slot's derived keys out of the files this script
# owns, keeping everything else, then delete the claim.
#
# It rewrites rather than deleting single lines, so the comment blocks never end
# up describing keys that are no longer in the file. It is merge_env again, in the
# mode that omits the derived keys instead of computing them.
#
# The files themselves are NOT deleted. Deleting them throws away exactly the hand
# edits the merge exists to protect. What is removed is only what points at a slot
# this worktree no longer holds, and the next --up puts it back through the insert
# path: a key absent from the file takes the template default, and for a derived
# key the template default is the freshly computed value.
release_slot() {
  echo "==> giving Angular slot $NG_SLOT back"

  MERGE_MODE='strip'
  write_config "$NG_SLOT" "${NG_BACKEND_SLOT:-$DEFAULT_BACKEND_SLOT}"
  MERGE_MODE=''

  rm -f "$SLOT_ENV"

  echo "  the .env files kept every value that was not this slot's; the claim is gone."
  echo "  --up now takes the lowest free slot, which may not be $NG_SLOT again."
  echo "  --restart bounces without releasing, and --down --keep-slot holds the number."
}

down() {
  local keep_slot="$1"

  if ! require_config; then
    echo "this worktree has no slot configured, so there is nothing of its own to stop." >&2
    echo "Run --list to see which worktrees do." >&2
    return 0
  fi

  echo "==> stopping Angular slot $NG_SLOT"
  local -a ports=()
  mapfile -t ports < <(slot_ports "$NG_SLOT")
  stop_apps APPS ports || echo "  nothing was running on this slot's ports"

  # Say plainly if a port survived. A --down that reports success over a port it
  # could not free sends the next --up into a collision it was meant to prevent.
  local -a ports=()
  local state
  mapfile -t ports < <(slot_ports "$NG_SLOT")
  while IFS=$'\t' read -r port state; do
    [[ "$state" == "closed" ]] || echo "  WARNING: $port is still $state" >&2
  done < <(probe_ports "${ports[@]}")

  # Slot 0 is the developer's own. Nothing takes it, so there is nothing to give
  # back, and it behaves as though --keep-slot were given whether or not it was.
  if (( NG_SLOT == 0 )); then
    echo "  slot 0 is the developer's own: the claim and every .env are left alone."
    return 0
  fi
  if [[ -n "$keep_slot" ]]; then
    echo "  --keep-slot: this worktree still holds Angular slot $NG_SLOT, values and all."
    return 0
  fi

  release_slot
}

# --- listing -----------------------------------------------------------------

list() {
  local -A claimed_by=()
  local wt s self
  self="$(cd "$root" && pwd)"

  while IFS= read -r wt; do
    [[ -n "$wt" ]] || continue
    s="$(slot_of_worktree "$wt")"
    [[ -n "$s" ]] || continue
    local label="$wt"
    [[ "$(cd "$wt" 2>/dev/null && pwd)" == "$self" ]] && label="$wt  (this one)"
    if [[ -n "${claimed_by[$s]:-}" ]]; then
      claimed_by[$s]="${claimed_by[$s]}"$'\n'"$label"
    else
      claimed_by[$s]="$label"
    fi
  done < <(worktree_paths)

  # One node process for every port of every slot, so --list costs one round trip
  # rather than one per port.
  local -a all_ports=()
  local slot
  for (( slot = 0; slot <= MAX_SLOT; slot++ )); do
    while IFS= read -r p; do all_ports+=("$p"); done < <(slot_ports "$slot")
  done
  local -A state_of=()
  local port state
  while IFS=$'\t' read -r port state; do
    state_of[$port]="$state"
  done < <(probe_ports "${all_ports[@]}")

  echo
  echo "Angular dev slots (slot 0 is the project.json ports; 1 and up are 42000 + (slot-1)*100)"
  echo
  printf '  %-4s %-7s %-46s %s\n' 'SLOT' 'STATE' 'PORTS  shell/odtg/dsword/landing/velista/admin' 'CLAIMED BY'
  for (( slot = 0; slot <= MAX_SLOT; slot++ )); do
    local -a ports=()
    mapfile -t ports < <(slot_ports "$slot")

    local open=0 unknown=0
    for port in "${ports[@]}"; do
      case "${state_of[$port]:-closed}" in
        open) open=$(( open + 1 )) ;;
        unknown) unknown=$(( unknown + 1 )) ;;
      esac
    done

    local claim="${claimed_by[$slot]:-}"
    local state_label
    if (( open == 0 && unknown == 0 )); then
      [[ -n "$claim" ]] && state_label='idle' || state_label='free'
    elif (( open == ${#ports[@]} - 1 )); then
      # The static remote port is reserved and never served, so a fully up slot
      # shows one closed port. Calling that "partial" would flag every healthy slot.
      state_label='up'
    else
      state_label='partial'
    fi

    # A free slot nobody claims is the common case and says nothing worth a line.
    if [[ "$state_label" == 'free' && -z "$claim" ]]; then
      continue
    fi

    local ports_col
    ports_col="$(printf '%s %s %s %s %s %s' \
      "$(port_for shell "$slot")" "$(port_for odontogram "$slot")" \
      "$(port_for damoclesSword "$slot")" "$(port_for landingV2 "$slot")" \
      "$(port_for velista "$slot")" "$(port_for luna-shopper-admin "$slot")")"

    if [[ -z "$claim" ]]; then
      # Something is listening that no checkout of this repository configured.
      printf '  %-4s %-7s %-46s %s\n' "$slot" "$state_label" "$ports_col" '(no worktree claims it)'
      continue
    fi

    # Two worktrees on one slot is a real state and worth showing as two lines
    # rather than hiding one of them.
    local first=1 line
    while IFS= read -r line; do
      if (( first )); then
        printf '  %-4s %-7s %-46s %s\n' "$slot" "$state_label" "$ports_col" "$line"
        first=0
      else
        printf '  %-4s %-7s %-46s %s\n' '' '' '' "$line"
      fi
    done <<< "$claim"
  done

  echo
  echo "  free     nothing claims it and nothing is listening: --up can take it"
  echo "  idle     a worktree is configured for it but is not serving"
  echo "  up       every app of the slot is answering"
  echo "  partial  some ports answer and some do not, or something else holds one"
  echo
  echo "Slots 0..${MAX_SLOT} with neither a claim nor a listener are omitted."
}

# --- argument parsing --------------------------------------------------------

action=''
slot_arg=''
backend_slot=''
apps_csv=''
keep_slot=''
reset_env=''
timeout=300

while (( $# )); do
  case "$1" in
    --list) action='list'; shift ;;
    --e2e-env) action='e2e-env'; shift ;;
    --up) action='up'; shift ;;
    --restart) action='restart'; shift ;;
    --down) action='down'; shift ;;
    # --auto names the slot, not the verb, so `--up --auto` stays an --up.
    --auto) slot_arg='auto'; [[ -n "$action" ]] || action='configure'; shift ;;
    --apps) apps_csv="${2:-}"; shift 2 ;;
    --apps=*) apps_csv="${1#*=}"; shift ;;
    --backend-slot) backend_slot="${2:-}"; shift 2 ;;
    --backend-slot=*) backend_slot="${1#*=}"; shift ;;
    --keep-slot) keep_slot=1; shift ;;
    --reset-env) reset_env=1; shift ;;
    --keep-env) KEEP_ENV="${2:-}"; shift 2 ;;
    --keep-env=*) KEEP_ENV="${1#*=}"; shift ;;
    --timeout) timeout="${2:-}"; shift 2 ;;
    --timeout=*) timeout="${1#*=}"; shift ;;
    -h | --help) usage; exit 0 ;;
    [0-9]*)
      slot_arg="$1"
      [[ -n "$action" ]] || action='configure'
      shift
      ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -n "$backend_slot" && ! "$backend_slot" =~ ^[0-9]+$ ]]; then
  echo "--backend-slot takes a non-negative integer" >&2
  exit 2
fi
if [[ ! "$timeout" =~ ^[0-9]+$ ]]; then
  echo "--timeout takes a number of seconds" >&2
  exit 2
fi

# --keep-env on its own reads like a promise this script does not keep: with
# nothing being reset there is nothing for it to protect. An error rather than a
# silent no-op, because the way people find out otherwise is by losing the value.
if [[ -n "$KEEP_ENV" && -z "$reset_env" ]]; then
  echo "--keep-env only means something with --reset-env: it names the keys a reset leaves alone." >&2
  echo "Without a reset, every non-derived key is already kept." >&2
  exit 2
fi
[[ -n "$reset_env" ]] && MERGE_MODE='reset'

# --auto is resolved inside up(), which keeps a claim this worktree already holds
# rather than abandoning it. Every other verb takes the lowest free slot outright.
if [[ "$slot_arg" == 'auto' && "$action" != 'up' ]]; then
  slot_arg="$(find_free_slot)"
fi

case "${action:-}" in
  list) list ;;
  e2e-env) e2e_env ;;
  down) down "$keep_slot" ;;
  restart) restart "$apps_csv" "$timeout" ;;
  up) up "$slot_arg" "$backend_slot" "$apps_csv" "$timeout" ;;
  # No --backend-slot means "work it out", never "the same number as this slot".
  configure) write_config "$slot_arg" "${backend_slot:-$(detect_backend_slot)}" ;;
  *) usage; exit 2 ;;
esac
