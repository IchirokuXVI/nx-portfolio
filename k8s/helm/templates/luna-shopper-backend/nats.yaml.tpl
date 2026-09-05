{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $nats := $ls.nats }}
---
# The broker's configuration file, which exists for exactly one setting.
#
# `max_payload` is raised above the 1 MB default so a voice recording can reach
# the assistant at all (luna plan 0041 section 4.2, luna plan 0045 section 3) and
# an uploaded `HarvestDocument` can reach the harvester (luna plan 0086, section
# 6.2), and it is **config file only**: nats-server has no `--max_payload` flag, and
# passing one makes it print its usage and exit — the pod then crashloops and
# takes every service behind it with it. Both plans assumed a command line
# argument; it is not one.
#
# `int64` before the value, and it is load bearing: Sprig carries a YAML integer
# as a float64, so rendering 16777216 unaided writes "1.6777216e+07", which the
# broker will not parse.
#
# **This and `k8s/e2e/luna-shopper-backend/nats.conf` are one decision and change
# together.** A raise in one and not the other is a feature that works on the
# development machine and fails in the cluster with a broker level rejection.
apiVersion: v1
kind: ConfigMap
metadata:
  name: luna-shopper-backend-nats-config
  namespace: {{ $root.Values.namespace }}
  labels:
    app: luna-shopper-backend-nats
    app.kubernetes.io/part-of: luna-shopper-backend
data:
  nats.conf: |
    max_payload: {{ $nats.maxPayload | default 16777216 | int64 }}
---
apiVersion: v1
kind: Service
metadata:
  name: luna-shopper-backend-nats
  namespace: {{ $root.Values.namespace }}
  labels:
    app: luna-shopper-backend-nats
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  selector:
    app: luna-shopper-backend-nats
  ports:
    - name: client
      port: 4222
      targetPort: 4222
    - name: monitor
      port: 8222
      targetPort: 8222
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: luna-shopper-backend-nats
  namespace: {{ $root.Values.namespace }}
  labels:
    app: luna-shopper-backend-nats
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  serviceName: luna-shopper-backend-nats
  replicas: 1
  selector:
    matchLabels:
      app: luna-shopper-backend-nats
  template:
    metadata:
      labels:
        app: luna-shopper-backend-nats
        app.kubernetes.io/part-of: luna-shopper-backend
    spec:
      {{- if $ls.priorityClass.enabled }}
      # The broker belongs to the stateful tier for the same reason the databases
      # do (plan 0004): everything that talks to it can be rescheduled harmlessly
      # and it cannot.
      priorityClassName: {{ $ls.priorityClass.name }}
      {{- end }}
      containers:
        - name: nats
          image: {{ $nats.image }}
          # JetStream enabled with a persistent store so durable streams survive a
          # restart; monitoring on 8222 backs the readiness/liveness probes.
          #
          # `-c` for the ConfigMap above, which carries `max_payload` and nothing
          # else. The rest stays here rather than moving into the file, because
          # CLI flags win over it and this way the container still says what it is
          # at a glance. See that comment for why the ceiling cannot be a flag.
          args: ['-c', '/etc/nats/nats.conf', '-js', '-sd', '/data', '-m', '8222']
          ports:
            - name: client
              containerPort: 4222
            - name: monitor
              containerPort: 8222
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8222
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8222
            initialDelaySeconds: 15
            periodSeconds: 20
          # Requests equal limits for Guaranteed QoS, exactly as the Postgres
          # instances (plan 0004, section 2). With no resources declared this was
          # BestEffort and therefore first in line for both the kubelet's
          # eviction ranking and the kernel's OOM killer.
          resources:
            {{- toYaml $nats.resources | nindent 12 }}
          volumeMounts:
            - name: data
              mountPath: /data
            - name: config
              mountPath: /etc/nats
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: luna-shopper-backend-nats-config
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ['ReadWriteOnce']
        storageClassName: {{ $nats.storageClassName }}
        resources:
          requests:
            storage: {{ $nats.storageSize }}
{{- end }}
