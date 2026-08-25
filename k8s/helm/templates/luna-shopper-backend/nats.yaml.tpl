{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $nats := .Values.lunaShopperBackend.nats }}
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
      containers:
        - name: nats
          image: {{ $nats.image }}
          # JetStream enabled with a persistent store so durable streams survive a
          # restart; monitoring on 8222 backs the readiness/liveness probes.
          args: ['-js', '-sd', '/data', '-m', '8222']
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
