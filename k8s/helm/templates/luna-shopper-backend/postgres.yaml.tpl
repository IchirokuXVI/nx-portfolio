{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $pg := $ls.postgres }}
{{- range $pg.instances }}
---
# Headless Service for the StatefulSet's stable network identity, and the name
# services connect to (e.g. AUTH_DB_URL host = {{ .name }}).
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  clusterIP: None
  selector:
    app: {{ .name }}
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  serviceName: {{ .name }}
  replicas: 1
  selector:
    matchLabels:
      app: {{ .name }}
  template:
    metadata:
      labels:
        app: {{ .name }}
        app.kubernetes.io/part-of: luna-shopper-backend
    spec:
      {{- if $ls.priorityClass.enabled }}
      # Says outright what Guaranteed QoS only implies (plan 0004, section 2.1).
      # Eviction and preemption consult both, so this is belt and braces on
      # purpose: the class states the intent, the resource numbers below are what
      # the kubelet's eviction ranking actually reads.
      priorityClassName: {{ $ls.priorityClass.name }}
      {{- end }}
      containers:
        - name: postgres
          image: {{ $pg.image }}
          # shared_buffers and work_mem are set explicitly because the memory
          # limit below exists (plan 0004, section 2). Postgres sizes its buffers
          # from its own configuration and knows nothing about the cgroup it
          # lives in, so postgres:16-alpine's 128MB default would sit against a
          # 256Mi limit with almost nothing left for work memory and connections.
          # Past the limit it is OOM killed rather than swapped. Raise these and
          # the limit together, never one alone.
          args:
            - postgres
            - -c
            - shared_buffers={{ $pg.sharedBuffers }}
            - -c
            - work_mem={{ $pg.workMem }}
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: {{ .database | quote }}
            - name: POSTGRES_USER
              value: {{ .user | quote }}
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ .secret }}
                  key: POSTGRES_PASSWORD
            # Keep the data under a subdirectory so the mounted volume root
            # (which may contain lost+found) is not used as the data directory.
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          readinessProbe:
            exec:
              command: ['sh', '-c', 'pg_isready -U {{ .user }} -d {{ .database }}']
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            exec:
              command: ['sh', '-c', 'pg_isready -U {{ .user }} -d {{ .database }}']
            initialDelaySeconds: 30
            periodSeconds: 20
          # Requests EQUAL limits, which is the only way to reach Guaranteed QoS
          # (plan 0004, section 2). Declaring no container resources at all — as
          # this template did — makes the pod BestEffort, the class the kubelet
          # evicts FIRST under memory pressure and the kernel gives the least
          # favourable oom_score_adj. Every stateless pod here is Burstable, so
          # the databases were being killed ahead of the services that exist only
          # to talk to them. The stateless pods are the ones that can be killed
          # harmlessly; a Postgres kill is an unclean shutdown of the only copy.
          #
          # Note the `resources` block further down belongs to the
          # volumeClaimTemplate and sizes the PVC. It is not this one, which is
          # how the omission went unnoticed.
          resources:
            {{- toYaml $pg.resources | nindent 12 }}
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ['ReadWriteOnce']
        storageClassName: {{ $pg.storageClassName }}
        resources:
          requests:
            storage: {{ $pg.storageSize }}
{{- end }}
{{- end }}
