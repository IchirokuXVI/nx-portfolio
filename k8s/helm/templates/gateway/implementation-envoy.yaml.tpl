{{/*
  THE DELIBERATE PORTABILITY EXCEPTION (plan 0001, section 8.2).

  Everything else this chart renders for routing is core
  gateway.networking.k8s.io/v1. This file is the single place that rule is
  knowingly broken, and it is kept alone in one clearly named file so that
  swapping the implementation is mechanical and the blast radius is exactly here.

  What it covers: the realtime service's long lived connection timeouts, which
  nginx expressed as `proxy_read_timeout 3600s` / `proxy_send_timeout 3600s`.
  There is no core spec equivalent yet, so it must be expressed per
  implementation:
    - Envoy Gateway (here):  a BackendTrafficPolicy targeting the HTTPRoute
    - Traefik, if ever swapped to: a ServersTransport, or an entrypoint timeout

  The WebSocket upgrade headers nginx also carried need nothing: HTTP/1.1 upgrade
  is handled for a normal HTTPRoute.

  Because a BackendTrafficPolicy only DECORATES the HTTPRoute, the realtime route
  itself stays a portable object. Swapping implementations loses the timeout
  tuning, not the routing, and the symptom would be sockets dropping at the
  default idle timeout rather than the service failing to route at all.

  Note on the filename: this is not `_implementation-envoy.yaml.tpl` as the plan
  first wrote it, because Helm treats a leading underscore as "partial, do not
  render" (see _helpers.tpl, luna-shopper-backend/_env.tpl). An underscored file
  here would silently emit nothing.
*/}}
{{- if and .Values.gateway.enabled .Values.lunaShopperBackend.enabled }}
{{- if eq .Values.gateway.className "eg" }}
{{- range .Values.lunaShopperBackend.services }}
{{- if and .routed .websocket }}
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: {{ .name }}-timeouts
  namespace: {{ $.Values.namespace }}
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: {{ .name }}
  timeout:
    http:
      # Matches the nginx pair this replaces. A WebSocket that goes quiet for an
      # hour is dropped, exactly as before.
      connectionIdleTimeout: {{ $.Values.gateway.websocketTimeout }}
      requestTimeout: {{ $.Values.gateway.websocketTimeout }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
