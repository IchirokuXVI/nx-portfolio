{{- range .Values.apps }}
{{- if or (ne .env "staging") $.Values.staging.enabled }}
{{- $tag := $.Values.productionImageTag }}
{{- if eq .env "staging" }}{{- $tag = $.Values.stagingImageTag }}{{- end }}
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
      containers:
        - name: {{ .name }}
          image: {{ .image }}:{{ $tag }}
          imagePullPolicy: Always
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
{{- end }}
