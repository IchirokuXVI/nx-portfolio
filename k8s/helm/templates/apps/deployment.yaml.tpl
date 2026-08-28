{{- range .Values.apps }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .name }}
  namespace: {{ $.Values.namespace }}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: {{ .name }}
  template:
    metadata:
      labels:
        app: {{ .name }}
    spec:
      {{- include "charts.imagePullSecrets" $ | nindent 6 }}
      containers:
        - name: {{ .name }}
          image: {{ .image }}:{{ $.Values.imageTag }}
          imagePullPolicy: {{ $.Values.appImagePullPolicy }}
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 256Mi
{{- end }}
