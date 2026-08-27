{{- range .Values.apps }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  namespace: {{ $.Values.namespace }}
spec:
  {{- if .lbPort }}
  # "Port" mode: expose this app directly on its own LoadBalancer port instead of
  # behind the reverse proxy. Docker Desktop publishes it on localhost:<lbPort>.
  type: LoadBalancer
  {{- end }}
  selector:
    app: {{ .name }}
  ports:
    - port: {{ .lbPort | default 80 }}
      targetPort: 80
{{- end }}
