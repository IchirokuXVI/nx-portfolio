{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $nats := $ls.nats }}
---
# The broker's configuration, which exists for exactly one setting.
#
# `max_payload` is **not a command line flag**. `nats-server` refuses to start
# with `--max_payload` ("flag provided but not defined"): it is a configuration
# file option only, so raising it means giving the broker a config file and
# pointing `-c` at it. Plan 0041 section 4.2 says to set it "on its args", which
# is the one thing that section gets wrong about the mechanism; the number and
# the reasoning behind it are unchanged.
#
# A voice recording crosses this broker as base64 (plan 0045, section 3): a two
# megabyte upload is about 2.7 MB encoded and under 3 MB with its envelope,
# against a default ceiling of one megabyte. The headroom above that is
# deliberate, since setting the ceiling just above the cap would mean the next
# change to either number has to move both.
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
    max_payload: {{ $nats.maxPayload | default "8MB" }}
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
          # `-c` points at the ConfigMap above, which carries `max_payload`. See
          # that comment for why it cannot be an argument here.
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
