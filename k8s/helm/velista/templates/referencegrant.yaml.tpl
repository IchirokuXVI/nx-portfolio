{{- /*
  This unit's consent to a route of another unit (plan 0015 D6). The portfolio
  chart renders HTTPRoute `velista-portfolio` in its own namespace with a backend
  in this one, and Gateway API ignores that backend unless a ReferenceGrant here
  names the route's namespace and the Service.
*/}}
{{- range .Values.referenceGrants }}
---
apiVersion: gateway.networking.k8s.io/v1
kind: ReferenceGrant
metadata:
  name: {{ .name }}
  namespace: {{ $.Release.Namespace }}
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: {{ required "referenceGrants[].fromNamespace is required" .fromNamespace }}
  to:
    {{- range .toServices }}
    - group: ''
      kind: Service
      name: {{ . }}
    {{- end }}
{{- end }}
