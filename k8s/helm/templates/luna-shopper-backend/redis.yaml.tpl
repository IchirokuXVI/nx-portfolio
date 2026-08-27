{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $redis := $ls.redis }}
---
apiVersion: v1
kind: Service
metadata:
  name: luna-shopper-backend-redis
  namespace: {{ $root.Values.namespace }}
  labels:
    app: luna-shopper-backend-redis
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  selector:
    app: luna-shopper-backend-redis
  ports:
    - name: redis
      port: 6379
      targetPort: 6379
---
# The cache, presence store and socket backplane (plan 0028).
#
# A Deployment rather than a StatefulSet, which is the one place this template
# departs from nats.yaml.tpl beside it. A StatefulSet buys a stable identity and
# a volume claim per pod, and this Redis has neither: there is exactly one
# replica, it is reached through the Service, and it stores nothing that has to
# survive its own restart.
#
# **Persistence: none, deliberately.** Everything held here is either ephemeral
# by nature (presence, relay messages, the socket adapter's rooms) or
# reconstructible (the access and stats caches, the throttle counters, the
# JetStream dedupe window). Redis coming back empty is a brief loosening of rate
# limits and a presence resync, not data loss, so there is no PVC and no AOF.
# `--save ''` and `--appendonly no` say that to the server rather than leaving it
# to the image's defaults.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: luna-shopper-backend-redis
  namespace: {{ $root.Values.namespace }}
  labels:
    app: luna-shopper-backend-redis
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  replicas: 1
  # Never two Redis pods at once. A second one would answer half the reads with
  # an empty presence set and an empty throttle counter, which is precisely the
  # split brain this whole plan exists to remove.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: luna-shopper-backend-redis
  template:
    metadata:
      labels:
        app: luna-shopper-backend-redis
        app.kubernetes.io/part-of: luna-shopper-backend
    spec:
      {{- if $ls.priorityClass.enabled }}
      # Stateful tier, for the same reason as NATS and the databases (plan 0004):
      # everything that talks to it can be rescheduled harmlessly and it cannot.
      # It holds no disk, but evicting it still empties every room's presence and
      # resets every rate limit at once.
      priorityClassName: {{ $ls.priorityClass.name }}
      {{- end }}
      containers:
        - name: redis
          image: {{ $redis.image }}
          # `maxmemory` is set below the container limit on purpose: Redis has to
          # start evicting before the kernel starts killing, or the memory ceiling
          # is enforced by an OOM kill that drops every key rather than by a
          # policy that drops the least useful ones.
          #
          # `volatile-lru` rather than `allkeys-lru` is the one judgement call in
          # this template. Every key plan 0028 defines carries a TTL, so
          # restricting eviction to keys with a TTL costs nothing today and means
          # that anything later written without one cannot be silently dropped
          # under pressure.
          args:
            - redis-server
            - --maxmemory
            - {{ $redis.maxmemory | quote }}
            - --maxmemory-policy
            - {{ $redis.maxmemoryPolicy | quote }}
            - --save
            - ''
            - --appendonly
            - 'no'
          ports:
            - name: redis
              containerPort: 6379
          readinessProbe:
            exec:
              command: ['redis-cli', 'ping']
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            exec:
              command: ['redis-cli', 'ping']
            initialDelaySeconds: 15
            periodSeconds: 20
          # Requests equal limits for Guaranteed QoS, exactly as NATS and the
          # Postgres instances (plan 0004, section 2). Raise this limit and
          # `maxmemory` together, never one alone: they are one decision written
          # in two places, and only the pair of them keeps eviction ahead of the
          # OOM killer.
          resources:
            {{- toYaml $redis.resources | nindent 12 }}
{{- end }}
