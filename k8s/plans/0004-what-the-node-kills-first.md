# 0004 What the node kills first

Every workload in this cluster shares one machine, so the interesting question is not how
much it can run but what happens when it cannot run all of it. Two mechanisms decide that:
QoS class, when the kubelet is reclaiming memory, and PodDisruptionBudgets, when a human is
draining the node. Both are currently set to the wrong answer.

## 1. The databases are the first thing evicted

`postgres.yaml.tpl` and `nats.yaml.tpl` declare no container `resources` at all. The
`resources:` block each file does contain belongs to `volumeClaimTemplates` and sizes the
PersistentVolumeClaim, not the container.

A container with neither requests nor limits is **BestEffort**, the lowest QoS class.
Everything else in the cluster is Burstable: the Luna services request 50m CPU and 128Mi
(limits 500m / 512Mi), the frontend apps request 50m and 64Mi (limits 200m / 256Mi).

Under memory pressure the kubelet ranks pods for eviction and takes BestEffort first,
regardless of how much memory they are actually using, and the kernel independently assigns
BestEffort containers the least favourable `oom_score_adj` so they are also the first choice
for the OOM killer. So on a node under pressure the three Postgres instances and NATS are
killed before any of the stateless services that exist only to talk to them.

That is precisely inverted. The stateless pods are the ones that can be killed harmlessly:
they hold nothing, they restart in seconds, and a rescheduled replica is indistinguishable
from the original. A Postgres kill is an unclean shutdown of the only copy of the data.

The inversion is easy to miss because it does not degrade gracefully. Nothing is wrong at
all until the node is short of memory, and then the wrong thing dies.

## 2. Give the stateful pods requests, and make them Guaranteed

Add container resources to both templates, driven from values so they stay tunable:

```yaml
resources:
  requests:
    cpu: {{ $pg.resources.requests.cpu }}
    memory: {{ $pg.resources.requests.memory }}
  limits:
    cpu: {{ $pg.resources.limits.cpu }}
    memory: {{ $pg.resources.limits.memory }}
```

Set requests **equal to** limits. A pod whose every container has requests equal to limits for
both CPU and memory is **Guaranteed**, the highest class, evicted last and given the most
favourable OOM score. For a database on a single node that is the correct class, and equality
is the only way to reach it.

Starting points, to be adjusted from real usage rather than trusted:

| Workload | cpu | memory |
| --- | --- | --- |
| Postgres, per instance | 250m | 256Mi |
| NATS with JetStream | 100m | 128Mi |

Three Postgres at 256Mi plus NATS at 128Mi reserves under 1Gi, which is affordable next to
the ten Luna pods at 128Mi each after `replicaCount` drops to 1.

**A memory limit on Postgres is a decision about Postgres, not only about Kubernetes.** Once
a limit exists, exceeding it is an immediate OOM kill rather than swapping, and Postgres sizes
its own buffers independently of the cgroup it lives in. `postgres:16-alpine` defaults
`shared_buffers` to 128MB, which fits inside 256Mi but leaves little room for work memory and
connections. Either raise the limit, or set `shared_buffers` and `work_mem` explicitly through
the container command so the two numbers are chosen together. Setting a limit without
touching the Postgres configuration is how a database that used to survive pressure starts
getting OOM killed under load instead.

### 2.1 A PriorityClass says it more directly

QoS is inferred from resource numbers, which means it is a side effect of a sizing decision
rather than a statement of intent. Preemption and eviction also consult
`priorityClassName`, which says the thing outright.

Define one PriorityClass for the stateful tier and set it on the two StatefulSets:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: luna-stateful
value: 100000
globalDefault: false
description: Databases and the broker. Evicted and preempted after everything else.
```

Do not reach for the built in `system-cluster-critical`. It is reserved for components the
cluster itself needs to function, it carries scheduling behaviour intended for those, and
borrowing it for an application database is the kind of shortcut that surprises the next
person reading a preemption event.

Belt and braces is right here: the PriorityClass expresses the intent, and Guaranteed QoS is
what the kubelet's eviction ranking actually reads.

## 3. The disruption budget blocks node maintenance

`lunaShopperBackend.pdb.minAvailable` is `1`. With `replicaCount: 2` that is correct and it is
what makes a node drain safe. With `replicaCount: 1`, which plan
`apps/luna-shopper-backend/plans/0027` section 3 adopts because socket.io has no Redis
adapter, it becomes unsatisfiable: evicting the only replica would leave zero available, so
the API refuses every voluntary eviction and `kubectl drain` blocks forever.

The failure is quiet in the worst way. Nothing is wrong until the day you need to reboot the
node for a kernel update, and then the drain hangs with no obvious cause, on the day you least
want to debug PodDisruptionBudgets.

**This plan owns the template change; 0027 section 3 owns the decision.** Render the PDB only
when there is more than one replica:

```
{{- if gt (int $ls.replicaCount) 1 }}
```

Rather than switching to `maxUnavailable: 1`. A budget that permits every disruption
constrains nothing, and an object that exists but means nothing is worse than an absent one:
the next reader has to work out that it is inert. When Redis lands and `replicaCount` goes
back to 2, the condition turns the PDB back on with no further edit.

The rolling update settings are untouched. `maxUnavailable: 0` with `maxSurge: 1` still
starts the replacement and waits for its readiness probe before retiring the old pod even at
one replica, so ordinary deploys stay nearly seamless. What one replica costs is survival of a
crash or a node failure, which is the accepted tradeoff.

## 4. While the numbers are being set

The stateless pods deserve one look too, since the same values file is open.

The Luna limit of 512Mi against a request of 128Mi is a 4x burst range. That is generous for a
Node service and it means ten pods can collectively claim 5Gi on a node sized for their 1.25Gi
of requests. On a single node with Guaranteed databases beneath them that is survivable, but
narrowing the range makes the node's behaviour under pressure much easier to predict. Consider
256Mi requests against 512Mi limits once there is real usage data to size from. This is a
refinement, not a defect, and it should follow measurement rather than lead it.

## 5. Verification

- `kubectl get pod <postgres> -o jsonpath='{.status.qosClass}'` reports `Guaranteed` for all
  three Postgres pods and for NATS.
- The same command reports `Burstable` for the Luna and frontend pods, unchanged.
- `helm template` with `replicaCount: 1` renders no PodDisruptionBudget; with `2` it renders
  ten, as today.
- `kubectl drain <node> --dry-run=server` completes rather than reporting that it would be
  blocked. This is the assertion that would have caught the defect, and it costs nothing to
  keep as a documented check after any change to replicas or budgets.
- Postgres survives a deliberate memory squeeze: apply the limits, then load enough data to
  push it, and confirm it is not the first pod killed.
