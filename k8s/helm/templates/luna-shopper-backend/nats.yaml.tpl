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
          # `--max_payload` is raised from the one megabyte default because a voice
          # comment travels gateway to core, and a recording to the assistant, as
          # base64 over this broker (plan 0041, section 4.2; plan 0045, section 3).
          # A two megabyte upload is about 2.7 MB encoded and under 3 MB with its
          # envelope, so the ceiling has deliberate headroom: setting it just above
          # the cap would mean the next change to either number has to move both.
          #
          # **This and `compose.yml` are one decision and change together.** A raise
          # applied here and not there, or there and not here, is a feature that
          # works on the development machine and fails in the cluster with a broker
          # level rejection, which is the slowest possible way to find out.
          args:
            [
              '-js',
              '-sd',
              '/data',
              '-m',
              '8222',
              '--max_payload',
              '{{ $nats.maxPayload | default "8MB" }}',
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
