{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- range $ls.services }}
{{- if or (ne .env "staging") $root.Values.staging.enabled }}
{{- $tag := $root.Values.productionImageTag }}
{{- if eq .env "staging" }}{{- $tag = $root.Values.stagingImageTag }}{{- end }}
{{- $cfgName := printf "luna-shopper-backend-config-%s" .env }}
{{- $secName := printf "luna-shopper-backend-secrets-%s" .env }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  replicas: {{ $ls.replicaCount | default $root.Values.replicaCount }}
  selector:
    matchLabels:
      app: {{ .name }}
  # Zero downtime (plan 0002, section 6): never drop below the desired count, and
  # bring a new pod up (and past its readiness probe) before retiring an old one.
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: {{ $ls.rollout.maxUnavailable }}
      maxSurge: {{ $ls.rollout.maxSurge }}
  template:
    metadata:
      labels:
        app: {{ .name }}
        app.kubernetes.io/part-of: luna-shopper-backend
    spec:
      # Give in flight work time to finish on SIGTERM before SIGKILL.
      terminationGracePeriodSeconds: {{ $ls.terminationGracePeriodSeconds }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: {{ .name }}
          image: {{ .image }}:{{ $tag }}
          imagePullPolicy: {{ $ls.imagePullPolicy }}
          ports:
            - containerPort: {{ .port }}
          env:
            {{- include "lunaShopperBackend.env" (dict "svc" . "cfg" $cfgName "sec" $secName "env" .env "tag" $tag) | nindent 12 }}
          # Liveness/readiness hit the /health endpoint. It is a plain liveness
          # check today; the richer terminus readiness (DB/NATS reachable) arrives
          # in plan 0004 and slots in here without changing the rollout contract.
          readinessProbe:
            httpGet:
              path: /health
              port: {{ .port }}
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: {{ .port }}
            initialDelaySeconds: 15
            periodSeconds: 20
            failureThreshold: 3
          resources:
            {{- toYaml $ls.resources | nindent 12 }}
{{- end }}
{{- end }}
{{- end }}
