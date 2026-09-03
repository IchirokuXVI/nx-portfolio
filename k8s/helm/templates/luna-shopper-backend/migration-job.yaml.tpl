{{- if and .Values.lunaShopperBackend.enabled .Values.lunaShopperBackend.migrations.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $secName := "luna-shopper-backend-secrets" }}
{{- $tag := $root.Values.imageTag }}
{{- range $ls.services }}
{{- if not (include "lunaShopperBackend.entryEnabled" (dict "entry" . "ls" $ls)) }}{{- continue }}{{- end }}
{{- if or (eq .role "auth") (eq .role "core") (eq .role "catalog") (eq .role "harvester") }}
{{- $svc := . }}
{{- $dbKey := printf "%s_DB_URL" (upper $svc.role) }}
{{- $dbName := "" }}
{{- range $ls.postgres.instances }}
{{- if eq .urlSecretKey $dbKey }}{{- $dbName = .name }}{{- end }}
{{- end }}
{{- $dbExists := and $dbName (lookup "v1" "Service" $root.Values.namespace $dbName) }}
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
# exists, so the retry is an upgrade and takes the pre-upgrade path.
#
# The ConfigMap is the reason this Job takes `lunaShopperBackend.migrationEnv`
# rather than the env every other pod gets. On the pre-upgrade path the ConfigMap
# exists, but it is the PREVIOUS release's copy, so a key the chart adds in this
# release is not in it yet and the kubelet fails the container the same way an
# absent ConfigMap does. Reading none of it is what makes the hook independent of
# the release it is part of; the helper has the full account.
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .name }}-migrate
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}-migrate
    app.kubernetes.io/part-of: luna-shopper-backend
  annotations:
    # pre-upgrade, EXCEPT on the upgrade that introduces this service's database,
    # which takes post-upgrade instead.
    #
    # The comment above explains why a first install migrates post-install: Helm
    # runs pre hooks before it applies a single chart resource, so a hook that
    # needs a database cannot run before the release that creates one. A service
    # switched on inside an ALREADY INSTALLED release is the same problem wearing
    # a different name, and it is not the install path, so it did not get the
    # install path's answer. k8s plan 0008 turned the harvester on in staging and
    # the deploy failed in two minutes:
    #
    #   Error: getaddrinfo ENOTFOUND luna-shopper-backend-harvester-db
    #   job luna-shopper-backend-harvester-migrate failed: BackoffLimitExceeded
    #   Error: UPGRADE FAILED: ... rolled back due to atomic being set
    #
    # The Job was correct, its image was correct, and its database was three
    # steps further down the same upgrade. --atomic then rolled the release back,
    # which removed the StatefulSet that would have fixed it, so every retry
    # failed identically. Nothing about it is specific to the harvester: it is
    # what the fifth database will do too.
    #
    # So the condition is asked of the cluster rather than assumed. `lookup`
    # returns empty for a Service that does not exist yet, and that is exactly
    # the case that cannot migrate first. It renders post-upgrade for that one
    # deploy; the next deploy finds the Service and is back on pre-upgrade, with
    # no flag to remember to remove.
    #
    # post-upgrade is safe HERE and would not be safe as the general rule. The
    # upgrade uses --wait, so Helm has applied the StatefulSet and waited for
    # Postgres to be ready before this hook starts, and a failure still fails the
    # release. What is given up is the expand/contract ordering: the new pods
    # roll before the migration. On the deploy that introduces a database that
    # costs nothing, because the pods rolling are the first copies of a service
    # nothing has talked to yet, against a schema no release has ever migrated.
    # On every other deploy it would cost exactly the 500s the imagePullPolicy
    # comment below describes, which is why this is a lookup and not a values
    # switch somebody could leave on.
    #
    # `helm template` (and so `provision-release.sh --check`) has no cluster to
    # ask and renders post-upgrade for every service. That is correct for what
    # the check does, which is assert that every secretKeyRef it references
    # exists; it does not read hook annotations.
    helm.sh/hook: {{ if $dbExists }}post-install,pre-upgrade{{ else }}post-install,post-upgrade{{ end }}
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
          # The same policy the Deployment uses, and for a stronger reason.
          #
          # Omitting it does not mean "the default": Kubernetes derives one from
          # the tag, and derives IfNotPresent for every tag that is not `latest`.
          # Staging's tag is `staging`, which is mutable and re-pushed on every
          # deploy, so the kubelet found the name already on the node and ran the
          # PREVIOUS release's image. Its bundled migrate.js carries the previous
          # release's migrations array, so the Job applied nothing, exited 0, and
          # the hook passed. The Deployment then pulled the new image, because it
          # does set this, and staging came up as new code on an old schema:
          #
          #   select name from migrations  ->  stopped at VoiceComments1756000400000
          #   GET /v1/share-links/{secret} ->  500, on a route that cannot fail
          #
          # Every route wanting a new table or column answered 500 while the
          # deploy stayed green throughout. hook-delete-policy removes the Job on
          # success, so no pod survived to explain it either.
          #
          # Production escaped only by luck: deploy-release.sh passes an immutable
          # `--set imageTag=<version>`, and a tag the node has never seen is
          # pulled even under IfNotPresent. That leaves the mutable tag as the one
          # case the derived default gets wrong, which is precisely the case
          # staging is. Saying the policy out loud ends the dependence on the tag.
          imagePullPolicy: {{ $ls.imagePullPolicy }}
          command: {{ toYaml $ls.migrations.command | nindent 12 }}
          # The role's own DB URL and nothing else, from the Secret, which the
          # chart does not render. NOT `lunaShopperBackend.env`: on the
          # pre-upgrade path the ConfigMap is still the previous release's, so
          # every ConfigMap key this Job reads is a key that may not exist yet.
          # `lunaShopperBackend.migrationEnv` carries the whole argument.
          env:
            {{- include "lunaShopperBackend.migrationEnv" (dict "svc" . "sec" $secName) | nindent 12 }}
{{- end }}
{{- end }}
{{- end }}
