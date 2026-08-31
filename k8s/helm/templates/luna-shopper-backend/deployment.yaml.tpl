{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $cfgName := "luna-shopper-backend-config" }}
{{- $secName := "luna-shopper-backend-secrets" }}
{{- $tag := $root.Values.imageTag }}
{{- range $ls.services }}
{{- if not (include "lunaShopperBackend.entryEnabled" (dict "entry" . "ls" $ls)) }}{{- continue }}{{- end }}
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
  {{/* One replica by default since plan 0027 section 3: socket.io has no Redis
       adapter here, so a second realtime pod breaks broadcasts rather than
       adding redundancy. See lunaShopperBackend.replicaCount in values.yaml.

       An entry may pin its own `replicas`, which the harvester does (plan 0038,
       section 4.1): a run holds an in memory work queue and an AbortController,
       so a second replica would not share the work, it would be a second run. */}}
  replicas: {{ .replicas | default $ls.replicaCount | default 1 }}
  selector:
    matchLabels:
      app: {{ .name }}
  {{- if eq (.strategy | default "RollingUpdate") "Recreate" }}
  # Recreate rather than RollingUpdate, for the entries that ask for it. A rolling
  # update briefly runs two pods, and for the harvester the new one cannot start a
  # run until the old one's finishes: the active run index refuses it. Taking the
  # old pod down first is the honest shape for a singleton worker, and its SIGTERM
  # path aborts and flushes rather than losing what it fetched.
  strategy:
    type: Recreate
  {{- else }}
  # Zero downtime (plan 0002, section 6): never drop below the desired count, and
  # bring a new pod up (and past its readiness probe) before retiring an old one.
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: {{ $ls.rollout.maxUnavailable }}
      maxSurge: {{ $ls.rollout.maxSurge }}
  {{- end }}
  template:
    metadata:
      annotations:
        # Roll the pods when the ConfigMap changes, and only then (the CORS
        # regression of 2026-08-29).
        #
        # Every value in `lunaShopperBackend.config` reaches the container as a
        # `configMapKeyRef`, never as a literal in this file, so editing one
        # leaves this Deployment byte for byte identical. `helm upgrade` then
        # updates the ConfigMap, reports success, and changes nothing: env is
        # read once at process start, so a running pod keeps the values it booted
        # with forever. Kubernetes does not restart pods on a ConfigMap change and
        # never has.
        #
        # That is how staging came to serve `staging.velista.app` from a gateway
        # whose CORS_ORIGINS still named `velista.staging.ichirokuxvi.com`: the
        # Gateway and HTTPRoute halves of the move reconciled immediately, because
        # they are the objects themselves rather than something read at boot, so
        # the routing and the certificate looked correct while every browser
        # request was blocked.
        #
        # CI cannot cover this. Both workflows `rollout restart` the deployments
        # in `nx affected`, and a change to a values file affects no Nx project,
        # so the list is empty exactly when the ConfigMap is what changed.
        #
        # Hashing the rendered ConfigMap puts the change back into the pod spec,
        # which is what makes `helm upgrade` roll these pods by itself. It is a
        # hash of the content, so an upgrade that does not touch the config leaves
        # it identical and rolls nothing.
        #
        # The Secrets are deliberately not hashed here: `provision-release.sh`
        # creates them outside the chart, so Helm never renders them and there is
        # nothing to hash. Rotating a secret still needs a manual restart.
        checksum/config: {{ include (print $root.Template.BasePath "/luna-shopper-backend/configmap.yaml.tpl") $root | sha256sum }}
      labels:
        app: {{ .name }}
        app.kubernetes.io/part-of: luna-shopper-backend
    spec:
      {{- include "charts.imagePullSecrets" $root | nindent 6 }}
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
            {{- include "lunaShopperBackend.env" (dict "svc" . "cfg" $cfgName "sec" $secName "env" $root.Values.environment "tag" $tag) | nindent 12 }}
          # The two probes hit two DIFFERENT handlers, and the split is the point
          # rather than a detail (plan 0027, section 1).
          #
          # Both used to point at a bare `/health`, which has no handler at all:
          # the controller is @Controller('health') with @Get('live') and
          # @Get('ready') beneath it. Both probes therefore took a 404, readiness
          # never passed, and with rollout.maxUnavailable 0 the rollout did not
          # fail, it HUNG at zero available replicas while `helm upgrade`
          # reported success.
          #
          # `ready` runs the heap check and every dependency indicator the
          # service registered, and flips to not ready on SIGTERM so the proxy
          # stops sending new work during a graceful shutdown.
          readinessProbe:
            httpGet:
              path: /health/ready
              port: {{ .port }}
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          # `live` runs health.check([]), which answers as long as the event loop
          # turns. Restarting a pod because its database is briefly unreachable
          # only makes an outage longer, so liveness deliberately checks less
          # than readiness does.
          livenessProbe:
            httpGet:
              path: /health/live
              port: {{ .port }}
            initialDelaySeconds: 15
            periodSeconds: 20
            failureThreshold: 3
          resources:
            {{- toYaml $ls.resources | nindent 12 }}
{{- end }}
{{- end }}
