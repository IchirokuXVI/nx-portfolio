{{- if .Values.lunaShopper.enabled }}
{{- $root := . }}
{{- range .Values.lunaShopper.services }}
{{- if or (ne .env "staging") $root.Values.staging.enabled }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
    app.kubernetes.io/part-of: luna-shopper
spec:
  # ClusterIP: the gateway and realtime are reached through the reverse proxy on
  # port 80; auth and core are internal only. Port 80 keeps the proxy config
  # uniform with the static apps; targetPort is the service's real listen port.
  type: ClusterIP
  selector:
    app: {{ .name }}
  ports:
    - port: 80
      targetPort: {{ .port }}
{{- end }}
{{- end }}
{{- end }}
