# 0018 Logs are kept for a stated time

> The privacy policy (velista plans `0172` to `0174`, backend plan `0231`) tells a person how
> long their data lives. For logs the owner chose 30 days, and 7 days for the assistant's
> logs, which hold what a person said and the reply. Today nothing enforces either number.
> This plan makes both true on the two clusters and on any host that `provision-host.sh`
> sets up, and it names what a self-hoster on another cluster must do instead.
>
> Every statement below was read on branch `docs/velista-privacy-terms-plans` (based on
> `origin/dev`, 2026-10-27). Statements marked **unverified** could not be checked from the
> repository and carry the command that checks them on a host.
>
> Prerequisite reading: `0006` (scripted provisioning), `0013` (host maintenance and
> `nx-host-patch`), `0016` (the deploy path and the diagnosis step).

## Brief for the agent

### Objective

Make every container log line on a host that `provision-host.sh` provisioned disappear
before it is 30 days old, and every line of the assistant's container before it is 7 days
old, with no aggregator, no new cluster component and no change to how a person reads logs
(`kubectl logs`). Stop the deploy diagnosis from copying application log lines into the
public GitHub Actions logs.

Use `antislop` with `antislop-code` for every comment you write.

### Context

- **Logs live in one place: the kubelet's files.** The services log JSON lines to stdout
  through `nestjs-pino` (`libs/luna-shopper/platform/src/lib/platform.module.ts:50-56`,
  `libs/luna-shopper/platform/src/lib/logging/logger.options.ts`). Every line inside a
  request carries `ip`, `userId` and `username` when known (`logger.options.ts:64-78`).
  containerd writes each container's stdout to `/var/log/pods/<namespace>_<pod>_<uid>/<container>/<n>.log`.
- **No aggregator, no shipping.** Neither chart nor any bootstrap script installs Loki,
  Fluent Bit, Promtail, Vector or a collector. Tracing is off with no endpoint
  (`k8s/helm/velista/values.yaml:259-264`). A search of `k8s/` for those names finds plan
  prose only.
- **k3s runs with the kubelet's defaults.** `install.sh` writes `/etc/rancher/k3s/config.yaml`
  with `disable` and `write-kubeconfig-mode` only (`k8s/bootstrap/install.sh:144-150`). No
  `kubelet-arg` is set, so `containerLogMaxSize` is 10 MiB and `containerLogMaxFiles` is 5
  (Kubernetes defaults; **unverified on the hosts**:
  `kubectl get --raw /api/v1/nodes/$(hostname)/proxy/configz`).
- **The real retention is size and pod life, never age.** The kubelet rotates a file when it
  passes 10 MiB and keeps five. It removes a pod's directory when the pod is deleted. A
  container that writes less than 50 MiB keeps every line for as long as its pod lives.
  Stateless pods are replaced at each deploy. The four Postgres pods, NATS and Redis keep
  the same pod across releases unless their spec changes, so their lines can be months old.
  Postgres prints the `DETAIL` of a failed statement, which for a unique violation names the
  value (an email, for example).
- **The assistant writes a person's words into those files.** `record()` logs `said` and
  `replied` on every turn (`apps/luna-shopper-backend/assistant/src/app/assistant/assistant.service.ts:768-808`,
  fields at `:792-793`). Its own comment says "the retention on these logs is short and
  stated" (`:755-767`); nothing states or enforces it. The container is named
  `luna-shopper-backend-assistant` (`k8s/helm/velista/values.yaml:625`, the Deployment's
  container takes `.name` at `k8s/helm/velista/templates/luna-shopper-backend/deployment.yaml.tpl:92`).
- **Two other writers of request lines.** The static apps run nginx with no `access_log`
  directive (`apps/docker/local-http-server/src/nginx-static-app.conf`), so the image's
  default access log goes to stdout with the full request line, query string included (a
  reset link's `?token=`, a share path `/s/<secret>`). Envoy Gateway runs with an
  `EnvoyProxy` that sets `mergeGateways` only (`k8s/bootstrap/install.sh:244-264`); its
  default access log to stdout is **unverified**
  (`kubectl -n envoy-gateway-system logs deploy/<merged envoy> -c envoy --tail=5`).
- **journald** holds the k3s unit's own output (kubelet and containerd messages, not
  container stdout). Its retention is size based by default. Whether Debian 13 keeps it on
  disk is **unverified** (`ls /var/log/journal`).
- **The CI diagnosis copies log lines into public logs.** On a failed deploy
  `.github/actions/deploy-unit/action.yml:288-294` prints `kubectl logs --tail=50
  --all-containers` of every pod that is not Running. The repository is public, so those
  lines are readable by anyone for the Actions log retention (90 days by default).
- Staging logs at `debug` (`k8s/helm/velista/values.staging.yaml:36`), production at `info`
  (`k8s/helm/velista/values.production.yaml:43`).
- Host programs follow one pattern: a script beside `provision-host.sh` is installed as root
  under `/usr/local/sbin`, the way `host-patch.sh` becomes `nx-host-patch`
  (`k8s/bootstrap/provision-host.sh:408-440`), and `/run` files come from tmpfiles.d
  (`:452-458`).

### Target state

- `k8s/bootstrap/log-retention.sh`, installed by `provision-host.sh` as
  `/usr/local/sbin/nx-log-retention`, runs hourly from a systemd timer. It deletes or trims
  every container log file under `/var/log/pods` so that no line is older than its rule:
  30 days by default, 7 days for any container named `luna-shopper-backend-assistant`.
- journald keeps at most 30 days.
- The deploy diagnosis prints events and `describe`, never log lines.
- `host-health.sh` fails on a host whose timer is not active, and prints the rules it read.
- If the live file cannot be trimmed safely (V1 fails), the assistant stops logging text in
  production instead (D3), and the 30 day bound for long lived pods is the owner's decision.

### Scope

`k8s/bootstrap/log-retention.sh` (new), `k8s/bootstrap/log-retention.test.mjs` (new),
`k8s/bootstrap/provision-host.sh`, `k8s/bootstrap/host-health.sh`,
`.github/actions/deploy-unit/action.yml`, `.github/workflows/pr.yml` (one test line),
`k8s/README-new-cluster.md`, `k8s/README.md` (a section for self-hosters). D3 adds
`apps/luna-shopper-backend/assistant/src/app/config/app-config.ts`,
`assistant.service.ts` and its spec, `k8s/helm/velista/values.yaml`,
`k8s/helm/velista/templates/luna-shopper-backend/configmap.yaml.tpl`. D6 adds
`apps/docker/local-http-server/src/nginx-static-app.conf`.

### Constraints

- `kubectl logs` and `kubectl logs --previous` keep working on every pod, before and after a
  trim.
- No new cluster component, no aggregator, no extra memory on the node.
- A line younger than its rule is never deleted, except in the trim window of D1 step 3,
  which the program logs.
- The rules are host configuration, not chart values: the chart cannot reach
  `/var/log/pods`.
- Bash only, `set -euo pipefail`, LF line endings, idempotent, as every script in
  `k8s/bootstrap`.

### Action boundaries

- Never run the program in trim mode on production before V1 passed on staging.
- Changing the numbers (30, 7) is the owner's decision, and they must equal what the policy
  states (section 7).
- Do not delete a pod or restart a workload to shorten its logs. That is the fallback in
  section 8, item 3, and it is the owner's to choose.

### Progress evidence

`node --test k8s/bootstrap/log-retention.test.mjs` passes. On staging,
`sudo nx-log-retention --dry-run --now "$(date -d '+31 days' -Is)"` lists every file under
`/var/log/pods`, and V1 (section 5) passes. `systemctl list-timers nx-log-retention.timer`
shows the next run on both hosts. A forced failed staging deploy prints no log line in its
Actions log.

## 1. Purpose

A retention number in a privacy policy is a promise about a mechanism. Today the mechanism
is the kubelet's size rotation, which bounds bytes and not days, so the honest answer to
"how long do you keep logs" is "until the pod is replaced or 50 MiB later". This plan puts a
clock on the files themselves, on the host, where the files are.

## 2. What stays true

- Logs are read with `kubectl logs` on the host, as `CLAUDE.md` and the runbooks describe.
- The application decides what it writes; the host decides how long it stays. Neither
  depends on the other, except D3.
- Backups hold database dumps, never logs (`k8s/plans/0005`). This plan does not touch them.

## 3. Decisions

### D1. One host program trims by age, per container

`nx-log-retention` reads `/etc/nx-log-retention.conf`, one rule per line,
`<namespace>/<container> <days>`, with `*` as a whole segment wildcard, the most specific
rule winning:

```
*/* 30
*/luna-shopper-backend-assistant 7
```

The namespace is a wildcard in the second rule so that a self-hoster who installs the chart
in another namespace is covered. The cutoff is `now - days + 2h`, so that an hourly timer
keeps every line strictly younger than its rule.

For each container directory under `/var/log/pods`:

1. A rotated file (`<n>.log.<stamp>`, compressed or not) whose mtime is before the cutoff is
   deleted. Its newest line is older than the cutoff, so all of it is.
2. A rotated file that is newer than the cutoff but whose first line is older is rewritten
   to a temporary file beside it and renamed over it. Nothing writes rotated files, so this
   is safe. A `.gz` file is rewritten as `.gz`.
3. The live file (`<n>.log`, open in containerd) whose first line is older than the cutoff
   is trimmed in place: the bytes from the first kept line to the current end are copied
   out, the file is truncated to zero, and the copy is appended back. This relies on
   containerd writing with `O_APPEND` (V1). Lines written between the copy and the truncate
   are lost; the window is milliseconds, the same as logrotate's `copytruncate`. The program
   logs each trim with the file and the bytes dropped.

Every line starts with an RFC 3339 timestamp in the CRI format
(`2026-10-27T10:15:00.123456789Z stdout F ...`), so the age of a line is read from the line
and not guessed from the file.

Flags: `--dry-run` (print what would happen), `--now <time>` (for tests and the dry run),
`--root <dir>` (default `/var/log/pods`, for the test fixture), `--config <file>`,
`--only <namespace>/<container>` (V1 on one test pod), `version`.

A systemd service and timer, `nx-log-retention.service` and `.timer`, run it hourly with
`Persistent=true`, so a host that was off catches up at boot.

### D2. journald keeps 30 days

`provision-host.sh` writes `/etc/systemd/journald.conf.d/90-nx-retention.conf` with
`MaxRetentionSec=30day` and restarts `systemd-journald`. It holds the owner's own logins and
k3s messages rather than user data, and 30 days costs nothing to state.

### D3. The assistant can stop logging text

A config key `ASSISTANT_LOG_TURN_TEXT` (Joi boolean, default `false`) in
`assistant/src/app/config/app-config.ts`, read into the service config. When false,
`record()` writes `saidChars` and `repliedChars` in place of `said` and `replied`; every
other field stays, so the listResolution and latency analysis of plan 0039 section 10 still
works. Chart value `lunaShopperBackend.assistant.logTurnText`, default `false` in
`values.yaml`, rendered into the ConfigMap beside the other `ASSISTANT_*` keys
(`configmap.yaml.tpl:187-215`).

The default is false so that a self-hoster gets no transcripts in logs unless they ask. The
owner's production file sets it true only if he wants transcripts and V1 passed; zero days
is within seven. If V1 fails, D3 is the fix for the assistant and is not optional.

If one of the backend plans `0231` to `0236` already changes the assistant's turn record,
D3 belongs there, and this plan only names the chart value. The orchestrator checks before
building.

### D4. The deploy diagnosis prints no log lines

`.github/actions/deploy-unit/action.yml:292` loses `kubectl logs`. The step keeps events and
`describe`, which show the reason, exit code and probe failures, and prints one line per
failing pod: `read its logs on the host: kubectl -n <ns> logs <pod> --all-containers`.
`describe` shows a termination message only, and the chart sets no
`terminationMessagePolicy: FallbackToLogsOnError`, so it carries no log text.
`split-release.sh:491` prints a migration Job's last 30 lines; those are TypeORM output, not
request lines, and stay.

### D5. Self-hosters

`provision-host.sh` installs the program by default, with `--log-days <n>` (the `*/*` rule)
and `--assistant-log-days <n>`, and `--no-log-retention` to skip it. A re-run rewrites the
config from its flags. `k8s/README.md` gains a section that says, for a cluster
`provision-host.sh` did not set up: container logs are the kubelet's files, their age is not
bounded by Kubernetes, and the operator must bound it with this program (it needs only
bash, coreutils and gzip on the node) or with their aggregator's retention, and must state
the same numbers in their legal settings. Managed Kubernetes keeps node logs under the
provider's own policy. The Docker Desktop path of `README-homelab.md` is a temporary bridge
and is not covered; the README says so.

### D6. The static apps do not log query strings (owner decision)

The nginx access log of each static app records reset tokens and share paths. Either
`access_log off;` in `nginx-static-app.conf` (Envoy's log, if it exists, already records the
request), or a `log_format` that writes `$uri` and not `$request`, which drops the query but
keeps `/s/<secret>`. Recommended: `access_log off;`. It is one line and it applies to every
static app image, the portfolio's too.

## 4. Who edits what

One builder, one PR, title `feat(k8s): container logs on the host are kept for a stated
time (plan 0018)`. D3 and D6 are in the same PR when the owner picks them, or a second PR
`feat(luna-shopper-backend): the assistant logs no turn text by default (plan 0018)`.

## 5. Acceptance

- `node --test k8s/bootstrap/log-retention.test.mjs` builds a fixture tree with a live file,
  a rotated plain file, a rotated `.gz` file and an assistant container, runs the script
  with `--root` and `--now`, and asserts: old rotated files gone, mixed files trimmed to the
  first kept line, the assistant container trimmed at 7 days and the others at 30, the dry
  run changes nothing. It runs in `pr.yml` beside `check-tasks.test.mjs` (`pr.yml:72`).
- **V1, on staging only.** `kubectl run v1 --image=busybox -- sh -c 'while true; do date; sleep 1; done'`,
  wait two minutes, run `sudo nx-log-retention --only default/v1 --now "$(date -d '+30 days +1 minute' -Is)"`
  with a temporary rule `default/v1 30`. Then: `kubectl logs v1 --tail=3` shows new lines,
  `grep -c $'\x00' /var/log/pods/default_v1_*/v1/0.log` prints 0, and the file size grows
  from a small number, not from the old offset. Delete the pod. A NUL byte or a size that
  continues from the old offset means containerd does not append, D1 step 3 is removed, and
  section 8 item 3 applies.
- `systemctl list-timers nx-log-retention.timer` shows the timer on both hosts;
  `host-health.sh` prints the rules and fails when the timer is inactive.
- `journalctl --header | grep -i retention` or `systemd-analyze cat-config systemd/journald.conf`
  shows `MaxRetentionSec=30day`.
- A staging deploy forced to fail (a bad image tag on a branch run) prints events and
  `describe` and no line of application output.
- With D3: a turn on a slot with `ASSISTANT_LOG_TURN_TEXT` unset logs `saidChars` and no
  `said`; the assistant spec covers both values.

## 6. The owner's part

1. On each host, staging first: `sudo bash ~/nx-portfolio/k8s/bootstrap/provision-host.sh`
   from an updated clone (no keys needed on a re-run, `provision-host.sh:33-39`).
2. Run V1 on staging and say whether D1 step 3 stays.
3. Settings, Actions, General: set the artifact and log retention of the repository to 30
   days. After D4 no deploy log holds application lines, but the e2e gates print compose
   logs of their test stacks (`pr.yml:241`), and 30 days keeps CI under the same number.
4. Choose D3 for production and D6.

## 7. `CLAUDE.md` and the policy

`CLAUDE.md`, under `Docker & CI/CD`, one bullet:

> - **Logs are kept for a stated time** (k8s plan 0018). Container logs exist only as the
>   kubelet's files on the node. `nx-log-retention`, which `provision-host.sh` installs,
>   trims them hourly to 30 days, and the assistant's container to 7. The numbers live in
>   `/etc/nx-log-retention.conf` and must equal what the privacy policy states. Never print
>   `kubectl logs` from a workflow: the repository's Actions logs are public.

The policy states the numbers from the operator's legal settings (backend `0231`). The host
config and those settings are two places for one number. This plan does not join them,
because the gateway cannot read a host file; `host-health.sh` prints the rules so that a
person can compare them after each change.

## 8. Decisions left for the owner

1. **D3 in production.** Keep transcripts for 7 days (true, needs V1) or log none (false,
   recommended unless a study of real turns is planned; it can be switched on for that
   study).
2. **D6.** `access_log off` (recommended) or a format without the query string.
3. **If V1 fails.** Long lived pods (Postgres, NATS, Redis, Envoy) then keep lines past 30
   days. The options are a monthly restart of those pods in a maintenance window, which
   costs a short outage of each database, or a policy that states "until the service is
   restarted, at most 50 MiB per container". This plan recommends neither until V1 is run.
4. **The numbers.** 30 and 7 are the owner's of 2026-10-27; any change is a re-run of
   `provision-host.sh` with new flags and a new policy version.

## 9. Decisions of the plan writer

These are mine and the owner can change them:

- The cutoff margin of two hours, and the hourly timer.
- The rules file format and its wildcard matching on the container name only for the
  assistant.
- The program is installed by `provision-host.sh` and not by `install.sh`, because it is a
  root host program like `nx-host-patch`, and `install.sh` re-runs without root from host
  maintenance.
- journald gets 30 days though it holds little user data.
- D3's default is false for everyone, the owner opting in, rather than true with self-hosters
  opting out.
- D4 removes log lines from staging diagnosis too, because staging holds the data of real
  testers and the logs are public there as well.
