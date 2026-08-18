{{- range .Values.apps }}
{{- if or (ne .env "staging") $.Values.staging.enabled }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  namespace: {{ $.Values.namespace }}
spec:
  selector:
    app: {{ .name }}
  ports:
    - port: 80
      targetPort: 80
{{- end }}
{{- end }}
