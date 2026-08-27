{{- if .Values.gateway.enabled }}
{{/*
  One route per app. Flat, no grouping, no shared state between iterations:
  the $appsByHost dict the nginx template needed is gone, because hostname
  intersection does that work instead.

  ReplacePrefixMatch "/" is an exact behavioural match for the old
  `rewrite ^{{ .path }}/?(.*)$ /$1 break;`, including the optional trailing
  slash: /landing/main.js becomes /main.js, and a bare /landing becomes /.

  The four proxy_set_header lines are not carried over. Setting Host and the
  X-Forwarded-* family is default behaviour in every conformant implementation.

  On sectionName. When the HTTPS redirect is on, these routes must attach ONLY
  to their host's HTTPS listener, so that the shared HTTP listener is left to the
  redirect route alone. Attaching to both (which is what omitting sectionName
  does, because the HTTP listener sets no hostname and therefore intersects every
  route) would keep serving the site in plain text: Gateway API precedence is by
  specificity, so an app route matching host + a path prefix always beats a catch
  all redirect, and the redirect would never fire for any real URL.

  With the redirect off, as it is locally, sectionName is omitted on purpose so
  the routes answer on both plain HTTP and HTTPS.
*/}}
{{- $pinToHttps := and .Values.gateway.tls.enabled .Values.gateway.tls.redirectHttp }}
{{- range .Values.apps }}
{{- $host := include "charts.host" (dict "item" . "root" $) }}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: {{ .name }}
  namespace: {{ $.Values.namespace }}
spec:
  parentRefs:
    - name: portfolio
      {{- if $pinToHttps }}
      sectionName: {{ $host | replace "." "-" }}-https
      {{- end }}
  hostnames:
    - {{ $host }}
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: {{ .path }}
      {{- if ne .path "/" }}
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
      {{- end }}
      backendRefs:
        - name: {{ .name }}
          port: 80
{{- end }}
{{- if .Values.lunaShopperBackend.enabled }}
{{/*
  Luna Shopper public services (plan 0002, section 5). The gateway (REST) and
  realtime (WebSocket/SSE) each own a dedicated host; auth, core and catalog stay
  internal. Each is a plain host root route, so no rewrite filter applies.

  The realtime service needs nothing here for WebSockets: HTTP/1.1 upgrade is
  handled for a normal HTTPRoute. Its long lived connection timeouts are the one
  thing with no core spec equivalent, and they live in
  implementation-envoy.yaml.tpl.
*/}}
{{- range .Values.lunaShopperBackend.services }}
{{- if .routed }}
{{- $host := include "charts.host" (dict "item" . "root" $) }}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: {{ .name }}
  namespace: {{ $.Values.namespace }}
spec:
  parentRefs:
    - name: portfolio
      {{- if $pinToHttps }}
      sectionName: {{ $host | replace "." "-" }}-https
      {{- end }}
  hostnames:
    - {{ $host }}
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: {{ .name }}
          port: 80
{{- end }}
{{- end }}
{{- end }}
{{- end }}
