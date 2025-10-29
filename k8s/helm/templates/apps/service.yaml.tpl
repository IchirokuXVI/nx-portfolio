{{- range .Values.apps }}
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
