{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- range $ls.services }}
{{- if not (include "lunaShopperBackend.entryEnabled" (dict "entry" . "ls" $ls)) }}{{- continue }}{{- end }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  # ClusterIP: the gateway and realtime are reached through the Gateway on port
  # 80; auth, core and catalog are internal only. Port 80 keeps the routing
  # uniform with the static apps; targetPort is the service's real listen port.
  type: ClusterIP
  selector:
    app: {{ .name }}
  ports:
    - port: 80
      targetPort: {{ .port }}
{{- end }}
{{- end }}
