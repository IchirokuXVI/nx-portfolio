{{/*
A static app: one Deployment, one Service and, behind the gateway, one
HTTPRoute for every entry of `.Values.apps`.

Call with the root context: {{ include "common.apps" . }}
*/}}
{{- define "common.apps" -}}
{{- range .Values.apps }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .name }}
  namespace: {{ $.Release.Namespace }}
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
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  namespace: {{ $.Release.Namespace }}
spec:
  {{- if .lbPort }}
  # "Port" mode: this app is exposed on its own LoadBalancer port instead of
  # behind the gateway. Docker Desktop publishes it on localhost:<lbPort>.
  type: LoadBalancer
  {{- end }}
  selector:
    app: {{ .name }}
  ports:
    - port: {{ .lbPort | default 80 }}
      targetPort: 80
{{- end }}
{{- if .Values.gateway.enabled }}
{{- range $app := .Values.apps }}
{{- $host := include "charts.host" (dict "item" $app "root" $) }}
---
{{- /*
  ReplacePrefixMatch "/" strips the app's path, with or without a trailing
  slash: /landingV2/main.js reaches the pod as /main.js, and a bare /landingV2
  as /. A host root app (`path: /`) gets no filter.
*/}}
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: {{ $app.name }}
  namespace: {{ $.Release.Namespace }}
spec:
  parentRefs:
    - name: {{ include "common.gatewayName" $ }}
      {{- with include "common.sectionName" (dict "host" $host "root" $) }}
      {{- . | nindent 6 }}
      {{- end }}
  hostnames:
    - {{ $host }}
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: {{ $app.path }}
      {{- if ne $app.path "/" }}
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
      {{- end }}
      backendRefs:
        - name: {{ $app.name }}
          port: 80
{{- end }}
{{- end }}
{{- end }}

{{/*
A route on one of this unit's hosts to a Service of another unit (plan 0015 D6).

Each entry of `.Values.externalRoutes` renders HTTPRoute `<name>-<chart name>`,
the name PR #809 gave the portfolio path of velista. Its backend names the other
unit's namespace, and that unit's chart holds the ReferenceGrant that allows it.
`keepPrefix: true` forwards the path as it arrived, for a backend that owns the
prefix itself.

Call with the root context: {{ include "common.externalRoutes" . }}
*/}}
{{- define "common.externalRoutes" -}}
{{- if .Values.gateway.enabled }}
{{- range $route := .Values.externalRoutes }}
{{- $host := include "charts.host" (dict "item" $route "root" $) }}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: {{ $route.name }}-{{ $.Chart.Name }}
  namespace: {{ $.Release.Namespace }}
spec:
  parentRefs:
    - name: {{ include "common.gatewayName" $ }}
      {{- with include "common.sectionName" (dict "host" $host "root" $) }}
      {{- . | nindent 6 }}
      {{- end }}
  hostnames:
    - {{ $host }}
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: {{ $route.path }}
      {{- if not $route.keepPrefix }}
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
      {{- end }}
      backendRefs:
        - name: {{ required "externalRoutes[].backend.service is required" $route.backend.service }}
          namespace: {{ required "externalRoutes[].backend.namespace is required" $route.backend.namespace }}
          port: {{ $route.backend.port | default 80 }}
{{- end }}
{{- end }}
{{- end }}
