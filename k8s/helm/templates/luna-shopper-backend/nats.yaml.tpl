{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $nats := $ls.nats }}
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
          # `--max_payload` is raised above the broker's 1 MB default so a voice
          # recording can reach the assistant at all (luna plan 0041, section 4.2).
          # The number comes from values.yaml, which is also where the compose
          # stack's copy is explained: the two have to move together, and a raise
          # applied here and not there fails only in the cluster.
          args:
            [
              '-js',
              '-sd',
              '/data',
              '-m',
              '8222',
              '--max_payload',
              # `int64` before `quote`, and it is load bearing: Sprig carries a YAML
              # integer as a float64, so `quote` alone renders 8388608 as
              # "8.388608e+06" and nats-server refuses to parse it. The pod then
              # crashloops in the cluster and nowhere else, which is the slowest
              # possible way to find out.
              {{ $nats.maxPayload | default 8388608 | int64 | quote }},
            ]
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
