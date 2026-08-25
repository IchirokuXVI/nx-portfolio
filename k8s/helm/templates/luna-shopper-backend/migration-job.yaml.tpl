{{- if and .Values.lunaShopperBackend.enabled .Values.lunaShopperBackend.migrations.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- range $ls.services }}
{{- if or (eq .role "auth") (eq .role "core") (eq .role "catalog") }}
{{- if or (ne .env "staging") $root.Values.staging.enabled }}
{{- $tag := $root.Values.productionImageTag }}
{{- if eq .env "staging" }}{{- $tag = $root.Values.stagingImageTag }}{{- end }}
{{- $cfgName := printf "luna-shopper-backend-config-%s" .env }}
{{- $secName := printf "luna-shopper-backend-secrets-%s" .env }}
---
# Database migrations on deploy (plan 0002, section 5 and 6). A Helm pre upgrade
# hook runs this service's migrations against its database before the new pods
# roll, so schema changes ship with the image that needs them and never run on
# app boot. Migrations are expand/contract (backward compatible), so old pods
# keep working against the new schema during the rollout.
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .name }}-migrate
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}-migrate
    app.kubernetes.io/part-of: luna-shopper-backend
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: '0'
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
spec:
  backoffLimit: 3
  template:
    metadata:
      labels:
        app: {{ .name }}-migrate
        app.kubernetes.io/part-of: luna-shopper-backend
    spec:
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: migrate
          image: {{ .image }}:{{ $tag }}
          command: {{ toYaml $ls.migrations.command | nindent 12 }}
          env:
            {{- include "lunaShopperBackend.env" (dict "svc" . "cfg" $cfgName "sec" $secName) | nindent 12 }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
