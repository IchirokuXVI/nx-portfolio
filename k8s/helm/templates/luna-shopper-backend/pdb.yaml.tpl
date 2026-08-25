{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- range $ls.services }}
{{- if or (ne .env "staging") $root.Values.staging.enabled }}
---
# PodDisruptionBudget (plan 0002, section 6): a voluntary disruption (node drain
# during maintenance) may never take this service below minAvailable, so a
# rollout and a drain together still leave the service serving.
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  minAvailable: {{ $ls.pdb.minAvailable }}
  selector:
    matchLabels:
      app: {{ .name }}
{{- end }}
{{- end }}
{{- end }}
