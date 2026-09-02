{{- if and .Values.lunaShopperBackend.enabled .Values.lunaShopperBackend.referenceSeed.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $secName := "luna-shopper-backend-secrets" }}
{{- $tag := $root.Values.imageTag }}
{{- range $ls.services }}
{{- if not (include "lunaShopperBackend.entryEnabled" (dict "entry" . "ls" $ls)) }}{{- continue }}{{- end }}
{{- if eq .role "catalog" }}
---
# The reference catalog seed (plan 0067, section 7).
#
# Catalog only, because the reference catalog is catalog data: groups, the two
# receipt-priced chains, their products and their prices. Nothing it writes
# crosses a database boundary, which is why this is one Job and not four.
#
# It runs on the same hooks as the migration Job and at a heavier weight, so
# Helm orders it strictly after: the seed writes through the entities and would
# fail against a schema the migration in the same release had not yet applied.
# post-install is what makes a first install work at all, for exactly the reason
# spelled out at length on the migration Job — a pre-install hook runs before the
# ConfigMap and the Postgres exist, and a Job that cannot start does not report a
# missing database, it reports a missing ConfigMap.
#
# `backoffLimit: 1` rather than the migration Job's 3. A migration that fails on
# a transient connection error is worth retrying because the rollout is blocked
# on it; this one is not blocking anything, and a real failure here is a data
# problem that a second identical attempt will reproduce.
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .name }}-reference-seed
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}-reference-seed
    app.kubernetes.io/part-of: luna-shopper-backend
  annotations:
    helm.sh/hook: post-install,pre-upgrade
    # After the migration hook, which is weight 0.
    helm.sh/hook-weight: '1'
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
spec:
  backoffLimit: 1
  template:
    metadata:
      labels:
        app: {{ .name }}-reference-seed
        app.kubernetes.io/part-of: luna-shopper-backend
    spec:
      {{- include "charts.imagePullSecrets" $root | nindent 6 }}
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: reference-seed
          image: {{ .image }}:{{ $tag }}
          # Stated, not derived, for the same reason the migration Job states it:
          # staging's tag is mutable and re-pushed, and a derived IfNotPresent
          # would run the previous release's seed data against the new schema.
          imagePullPolicy: {{ $ls.imagePullPolicy }}
          command: {{ toYaml $ls.referenceSeed.command | nindent 12 }}
          # The role's own DB URL from the Secret and nothing else, for the same
          # reason as the migration Job: on the pre-upgrade path the ConfigMap is
          # still the previous release's copy, so any key this release adds is
          # not in it yet and the kubelet fails the container.
          env:
            {{- include "lunaShopperBackend.migrationEnv" (dict "svc" . "sec" $secName) | nindent 12 }}
{{- end }}
{{- end }}
{{- end }}
