{{- if and .Values.gateway.enabled .Values.lunaShopperBackend.enabled }}
{{/*
  Luna Shopper public services (plan 0002, section 5). The gateway (REST) and
  realtime (WebSocket/SSE) each own a host; the other services stay internal.
  Each is a plain host root route, so no rewrite filter applies.

  WebSockets need nothing here: HTTP/1.1 upgrade works on a normal HTTPRoute.
  Their long lived connection timeouts have no core spec equivalent and live in
  implementation-envoy.yaml.tpl.
*/}}
{{- range $service := .Values.lunaShopperBackend.services }}
{{- if $service.routed }}
{{- $host := include "charts.host" (dict "item" $service "root" $) }}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: {{ $service.name }}
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
{{- /*
      Slow paths first, though the order decides nothing: Gateway API ranks
      rules by how specific the match is, so a path prefix always wins over `/`.

      `timeouts.request` is core Gateway API, so it survives a change of
      implementation. It replaces Envoy's default of fifteen seconds, which no
      file in this chart states. See the entry in values.yaml for why the
      assistant needs more and how the number is tied to
      ASSISTANT_TURN_TIMEOUT_MS.
*/ -}}
{{- range $slow := $service.slowPaths }}
    - matches:
        - path:
            type: PathPrefix
            value: {{ $slow.path }}
      timeouts:
        request: {{ $slow.timeout }}
      backendRefs:
        - name: {{ $service.name }}
          port: 80
{{- end }}
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: {{ $service.name }}
          port: 80
{{- end }}
{{- end }}
{{- end }}
