{{- if and .Values.gateway.enabled .Values.gateway.tls.enabled .Values.gateway.tls.redirectHttp }}
{{/*
  The nginx config shared one server block between `listen 80` and
  `listen 443 ssl` with the same locations, which means plain HTTP served the
  site unencrypted. Adding a redirect is therefore a behaviour change, so it sits
  behind a value that is on in production and off locally, where everything is
  plain HTTP.

  This does not break ACME HTTP-01. cert-manager creates a temporary solver route
  with an exact path match on the challenge token, and Gateway API specifies
  route precedence (exact beats prefix, longer prefix beats shorter, ties broken
  by creation timestamp), so the challenge wins over this catch all
  deterministically. Under Ingress that ordering was implementation defined,
  which is a classic cause of renewals failing months after the first issuance.
*/}}
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: https-redirect
  namespace: {{ .Values.namespace }}
spec:
  parentRefs:
    - name: portfolio
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
{{- end }}
