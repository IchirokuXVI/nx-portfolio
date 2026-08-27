# 0003 Deploys that fail when they fail

Neither deploy path waits for anything. `helm upgrade` returns as soon as the API server has
accepted the manifests, so both workflows report success while pods crashloop, images fail to
pull, or a rollout blocks forever. The pipeline is green and the site is down, and nothing in
between says otherwise.

## 1. Why this is urgent rather than tidy

This is normally a nice to have. Here it is not, because of what it interacts with.

`lunaShopperBackend.rollout.maxUnavailable` is `0`. That tells Kubernetes it may not retire
an old pod until a new one passes its readiness probe. Combined with the probe defect in
`apps/luna-shopper-backend/plans/0027` section 1, where both probes point at a path with no
handler, a rollout does not fail. **It hangs.** There is no `progressDeadlineSeconds`
breach that anyone is watching, no failed job, and no notification. The first Luna deploy
would have gone green with ten Deployments stuck at zero available replicas, and the only
symptom would have been the site not working.

So the probe fix and this plan are the same defence from two directions: one makes readiness
achievable, the other makes an unachievable readiness fail loudly.

There is precedent inside the repository already. `k8s/bootstrap/install.sh` passes `--wait`
to all three of its `helm upgrade --install` calls, because the next step depends on the
previous one being real. The application deploy is the one place where nothing depends on the
result, so nothing checked it.

## 2. What is unverified today

**The staging upgrade.** `.github/workflows/docker-ci.yml`:

```sh
helm upgrade nx-portfolio /root/k8s/helm \
  --namespace nx-portfolio \
  --create-namespace \
  --values /root/k8s/helm/values.yaml \
  $EXTRA_VALUES
```

No `--wait`, no `--timeout`, no `--atomic`.

**The rollout restarts.** Immediately after, for each affected app:

```sh
kubectl rollout restart "deployment/$dep" -n nx-portfolio || true
```

`rollout restart` is asynchronous by design: it patches the pod template annotation and
returns. So this loop asks for ten restarts and observes none of them. The `|| true` then
discards even the failure of the request itself, meaning a typo in a deployment name is
silently ignored. This is the half that `--wait` alone cannot fix, because the restarts
happen after Helm has finished.

**The production release.** `k8s/helm/deploy-release.sh` has the same bare `helm upgrade`,
and then prints:

```
Production is now serving release ${VERSION}
```

which it has not checked. A statement a script makes about the world should be one it
verified, or it trains the reader to disbelieve the output.

## 3. Target

A deploy that finishes green means every pod it touched is running and ready. A deploy that
cannot reach that state fails the workflow within a bounded time, and prints enough to
diagnose it without SSH.

### 3.1 Wait on the upgrade

Both call sites gain:

```sh
--wait --timeout 10m
```

`--wait` blocks until every Deployment, StatefulSet and Job in the release reports ready.
Ten minutes is chosen against the slowest real path: three migration Jobs as pre-upgrade
hooks, then ten Deployments rolling one at a time with a readiness probe whose
`initialDelaySeconds` is 5 and `periodSeconds` 10, on a single node pulling images. It is
comfortably above that and well below "somebody has gone home".

Note what `--wait` already covers for free: the migration Jobs are Helm hooks, so a migration
that fails through its `backoffLimit: 3` fails the upgrade before any new pod takes traffic.
That is the behaviour plan 0027 assumes and nothing currently enforces.

### 3.2 `--atomic` on staging, and deliberately not on production

Add `--atomic` to the staging upgrade. It implies `--wait` and rolls the release back on
failure, which is exactly right for the environment whose purpose is to absorb failures: a
broken staging deploy leaves staging on the last good revision instead of half migrated.

Do **not** add it to `deploy-release.sh` without deciding, because `--atomic` on production
turns a partial failure into an automatic rollback of the whole release, including the
database migrations' side effects, which do not roll back with it. Migrations are expand and
contract and therefore backward compatible, so an automatic rollback of the pods is safe.
The honest position is that it is safe *because* of the migration discipline, and that
reasoning should be written next to the flag rather than assumed. Recommend adopting it on
production too, once a release has been rehearsed on staging with it enabled.

### 3.3 Verify the restarts

Replace the fire and forget loop:

```sh
for dep in $AFFECTED_STAGING; do
  kubectl rollout restart "deployment/$dep" -n nx-portfolio
done

for dep in $AFFECTED_STAGING; do
  kubectl rollout status "deployment/$dep" -n nx-portfolio --timeout=5m
done
```

Two loops rather than one, so all ten restarts are requested before any is awaited and the
rollouts overlap. The `|| true` goes: a restart that cannot be requested is a real failure,
and after `k8s/plans/0002` the deployment names are the plain lowercased project names, so a
mismatch is a bug rather than a naming quirk to tolerate.

`rollout status` exits non zero on timeout, which fails the step, which is the entire point.

### 3.4 Print something useful when it fails

A failed deploy currently leaves a Helm error and nothing else. Add a step that runs only on
failure:

```yaml
- name: Diagnose the failed deploy
  if: failure()
  run: |
    ssh ... <<'EOF'
      export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
      kubectl -n nx-portfolio get pods -o wide
      kubectl -n nx-portfolio get events --sort-by=.lastTimestamp | tail -40
      for p in $(kubectl -n nx-portfolio get pods \
            --field-selector=status.phase!=Running -o name); do
        echo "::group::$p"
        kubectl -n nx-portfolio describe "$p" | tail -30
        kubectl -n nx-portfolio logs "$p" --tail=50 --all-containers || true
        echo "::endgroup::"
      done
    EOF
```

Events are the part that matters and the part people forget: `ImagePullBackOff` against a
private GHCR package, a PVC that cannot bind, and a failing readiness probe all announce
themselves there and nowhere else.

### 3.5 Make the release script tell the truth

`deploy-release.sh` gets `--wait --timeout 10m`, and its closing message moves after a
verification rather than after the command:

```sh
kubectl rollout status deployment -n "$NAMESPACE" --timeout=5m
echo "Production is now serving release ${VERSION}"
```

## 4. What this does not do

It does not add health checking beyond readiness. A deploy that is green here means every pod
is ready, not that the application is correct; that is what the tier 2 e2e suite before the
deploy is for. Nor does it add alerting: this plan makes a **deploy** fail loudly, and says
nothing about a service that degrades an hour later. Metrics are already exposed
(`metricsEnabled`) with nothing scraping them, and that is a separate piece of work.

## 5. Verification

The check that matters is a deliberate failure. Before fixing the probe paths in plan 0027,
or by temporarily pointing a probe at a bad path afterwards, run a staging deploy and confirm
that:

- the workflow fails rather than passing,
- it fails within the timeout rather than hanging until the job limit,
- the diagnosis step names the failing probe in the events output,
- and with `--atomic`, the release is left on the previous revision.

Confirming the green path still goes green is the easy half; confirming the red path goes red
is the reason for the plan.
