{{- if .Values.lunaShopper.enabled }}
{{- $root := . }}
{{- $pg := .Values.lunaShopper.postgres }}
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
    app.kubernetes.io/part-of: luna-shopper
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
    app.kubernetes.io/part-of: luna-shopper
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
        app.kubernetes.io/part-of: luna-shopper
    spec:
      containers:
        - name: postgres
          image: {{ $pg.image }}
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
