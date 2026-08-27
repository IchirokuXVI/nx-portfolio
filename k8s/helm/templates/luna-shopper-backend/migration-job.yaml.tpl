{{- if and .Values.lunaShopperBackend.enabled .Values.lunaShopperBackend.migrations.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $cfgName := "luna-shopper-backend-config" }}
{{- $secName := "luna-shopper-backend-secrets" }}
{{- $tag := $root.Values.imageTag }}
{{- range $ls.services }}
{{- if or (eq .role "auth") (eq .role "core") (eq .role "catalog") }}
---
# Database migrations on deploy (plan 0002, section 5 and 6). A Helm pre upgrade
# hook runs this service's migrations against its database before the new pods
# roll, so schema changes ship with the image that needs them and never run on
# app boot. Migrations are expand/contract (backward compatible), so old pods
# keep working against the new schema during the rollout.
#
# The command is `node migrate.js`, a second webpack entry point emitted beside
# main.js (plan 0027, section 2.1). It imports an explicit ordered migrations
# array rather than resolving a filesystem glob, because webpack cannot follow a
# glob and a bundled build would otherwise find zero migrations, run cleanly,
# apply nothing, and report success.
#
# `--wait` on the upgrade (plan 0003) is what makes a failure here matter: the
# Job is a hook, so a migration that exhausts backoffLimit fails the upgrade
# before any new pod takes traffic.
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
            {{- include "lunaShopperBackend.env" (dict "svc" . "cfg" $cfgName "sec" $secName "env" $root.Values.environment "tag" $tag) | nindent 12 }}
{{- end }}
{{- end }}
{{- end }}
