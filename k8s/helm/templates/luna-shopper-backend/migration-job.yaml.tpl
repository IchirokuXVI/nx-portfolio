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
#
# post-install rather than pre-install, and this is the difference between a
# first deploy that works and one that cannot.
#
# Helm runs pre-install hooks BEFORE it applies a single chart resource, so on a
# first install this Job would start in an empty namespace. It has two hard
# dependencies there and neither exists yet: the ConfigMap it reads its whole
# environment from, and the Postgres it migrates. The first is what you actually
# see, because the kubelet cannot even create the container without it:
#
#   Error: configmap "luna-shopper-backend-config" not found
#   CreateContainerConfigError, x21 over 4m13s
#
# which is what production did on 0.2.0 and again on 0.2.1. Creating the
# ConfigMap earlier would not fix it, only move the failure one step along to a
# database that has not been created either, because Helm is still blocked on
# this hook and cannot apply the StatefulSet that would provide one.
#
# post-install runs after every resource is applied and, because the deploy uses
# --wait, after they are ready. Nothing is lost by migrating then: readiness for
# auth and core is `db.pingCheck`, a SELECT 1 that an empty schema answers
# perfectly well, and the services set `synchronize: false`, so no pod does DDL
# of its own on the way up. A first install therefore comes up on an empty
# schema, migrates, and is correct from that point on.
#
# The upgrade path is untouched: pre-upgrade still runs before any new pod
# takes traffic, which is the property the expand/contract argument above
# depends on. And a first install whose migration fails leaves a release that
# exists, so the retry is an upgrade and takes the pre-upgrade path, where the
# ConfigMap is now there.
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .name }}-migrate
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}-migrate
    app.kubernetes.io/part-of: luna-shopper-backend
  annotations:
    helm.sh/hook: post-install,pre-upgrade
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
      {{- include "charts.imagePullSecrets" $root | nindent 6 }}
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
