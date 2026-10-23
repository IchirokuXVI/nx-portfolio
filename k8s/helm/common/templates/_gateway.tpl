{{/*
The hosts of `.Values.apps` and `.Values.externalRoutes`, one per line. A unit
chart adds the hosts of anything else it routes and passes the set to
`common.gateway`.

Call with the root context.
*/}}
{{- define "common.appHosts" -}}
{{- range .Values.apps }}
{{ include "charts.host" (dict "item" . "root" $) }}
{{- end }}
{{- range .Values.externalRoutes }}
{{ include "charts.host" (dict "item" . "root" $) }}
{{- end }}
{{- end }}

{{/*
The unit's Gateway, its Issuer and its HTTPS redirect (plan 0015 D3 and D4).

One Gateway per unit, named after the chart, with an HTTP and an HTTPS listener
per host. Envoy Gateway merges the Gateways of class `eg` into one data plane
(the EnvoyProxy `merged` that k8s/bootstrap/install.sh creates), and a merged
data plane refuses two listeners with the same port, protocol and hostname. So
no listener is hostless, and no two units may serve one host.

cert-manager watches the Gateway and issues the Secret `<host>-tls` that each
HTTPS listener names, from the issuer in the annotation.

Call with a dict: (dict "root" $ "hosts" <newline separated hosts>)
*/}}
{{- define "common.gateway" -}}
{{- $root := .root }}
{{- $gw := $root.Values.gateway }}
{{- if $gw.enabled }}
{{- $hosts := splitList "\n" .hosts | compact | uniq | sortAlpha }}
{{- $issuer := $gw.tls.issuer }}
{{- $name := include "common.gatewayName" $root }}
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: {{ $name }}
  namespace: {{ $root.Release.Namespace }}
  {{- if or $gw.tls.enabled $gw.extraAnnotations }}
  annotations:
    {{- if $gw.tls.enabled }}
    {{- if eq $issuer.kind "Issuer" }}
    cert-manager.io/issuer: {{ $issuer.name }}
    {{- else if eq $issuer.kind "ClusterIssuer" }}
    cert-manager.io/cluster-issuer: {{ $issuer.name }}
    {{- else }}
    {{- fail (printf "gateway.tls.issuer.kind is %q. It must be Issuer or ClusterIssuer." $issuer.kind) }}
    {{- end }}
    {{- end }}
    {{- with $gw.extraAnnotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
  {{- end }}
spec:
  gatewayClassName: {{ $gw.className }}
  listeners:
    {{- range $host := $hosts }}
    - name: {{ $host | replace "." "-" }}-http
      protocol: HTTP
      port: 80
      hostname: {{ $host }}
      allowedRoutes:
        namespaces:
          from: Same
    {{- end }}
    {{- if $gw.tls.enabled }}
    {{- range $host := $hosts }}
    - name: {{ $host | replace "." "-" }}-https
      protocol: HTTPS
      port: 443
      hostname: {{ $host }}
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: {{ $host | replace "." "-" }}-tls
      allowedRoutes:
        namespaces:
          from: Same
    {{- end }}
    {{- end }}
{{- if and $gw.tls.enabled $issuer.create }}
{{- if ne $issuer.kind "Issuer" }}
{{- fail "gateway.tls.issuer.create renders a namespaced Issuer, so kind must be Issuer. A unit chart never renders a cluster scoped issuer." }}
{{- end }}
---
{{- /*
  The unit's own ACME account (plan 0015 D4). Never issue one certificate that
  covers hosts of two units. The HTTP-01 challenge route carries its host in
  `hostnames`, so it lands on that host's HTTP listener, and its exact path
  outranks the HTTPS redirect below.
*/}}
apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: {{ $issuer.name }}
  namespace: {{ $root.Release.Namespace }}
spec:
  acme:
    server: {{ required "gateway.tls.issuer.acme.server is required when the chart creates its Issuer" $issuer.acme.server }}
    email: {{ required "gateway.tls.issuer.acme.email is required when the chart creates its Issuer. Set it in the environment values file." $issuer.acme.email }}
    privateKeySecretRef:
      name: {{ $issuer.name }}-account-key
    solvers:
      - http01:
          gatewayHTTPRoute:
            parentRefs:
              - kind: Gateway
                name: {{ $name }}
                namespace: {{ $root.Release.Namespace }}
{{- end }}
{{- if and $gw.tls.enabled $gw.tls.redirectHttp }}
---
{{- /*
  Plain HTTP answers with a 301 to HTTPS on every host of the unit. Off locally,
  where everything is plain HTTP.
*/}}
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: https-redirect
  namespace: {{ $root.Release.Namespace }}
spec:
  parentRefs:
    {{- range $host := $hosts }}
    - name: {{ $name }}
      sectionName: {{ $host | replace "." "-" }}-http
    {{- end }}
  hostnames:
    {{- range $host := $hosts }}
    - {{ $host }}
    {{- end }}
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
{{- end }}
{{- end }}
{{- end }}
