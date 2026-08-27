{{- if .Values.gateway.enabled }}
{{/*
  One Gateway, one HTTPS listener per distinct host.

  The dedup is over hosts only, which is the same set the certbot DOMAINS
  variable used to compute. It is the one grouping loop that survives the move
  off nginx, and it is now the only one in the chart rather than one of three:
  routes no longer need grouping at all (see httproute.yaml.tpl).

  Since plan 0002 the set is five hosts rather than ten, because this release
  describes one environment. The other five live on the other cluster, with their
  own Gateway and their own certificates. That is what keeps each cluster's
  listener count (and its Let's Encrypt exposure) to what it actually serves.

  Creating this object causes the Envoy Gateway controller to provision a data
  plane Deployment + Service named envoy-<namespace>-<name>-<hash> in the
  envoy-gateway-system namespace. Neither object is declared here, and the
  Service defaults to type LoadBalancer, so it is the one that takes the
  MetalLB address (see metallb.serviceNamespaces in values.yaml).
*/}}
{{- $hosts := dict }}
{{- range .Values.apps }}
{{- $_ := set $hosts (include "charts.host" (dict "item" . "root" $)) true }}
{{- end }}
{{- if .Values.lunaShopperBackend.enabled }}
{{- range .Values.lunaShopperBackend.services }}
{{- if .routed }}
{{- $_ := set $hosts (include "charts.host" (dict "item" . "root" $)) true }}
{{- end }}
{{- end }}
{{- end }}
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: portfolio
  namespace: {{ .Values.namespace }}
  {{- if or .Values.gateway.tls.enabled .Values.gateway.extraAnnotations }}
  annotations:
    {{- if .Values.gateway.tls.enabled }}
    # cert-manager watches the Gateway, sees each certificateRefs Secret that
    # does not exist, and provisions it from this ClusterIssuer. That replaces
    # the openssl init container, the certbot sidecar, and both PVCs: the
    # certificates live in Secrets now, so there is no volume to reconcile and
    # no storage class for a local overlay to override.
    cert-manager.io/cluster-issuer: {{ .Values.gateway.tls.issuer }}
    {{- end }}
    {{- with .Values.gateway.extraAnnotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
  {{- end }}
spec:
  gatewayClassName: {{ .Values.gateway.className }}
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: Same
    {{- if .Values.gateway.tls.enabled }}
    {{- range $host, $_ := $hosts }}
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
{{- end }}
