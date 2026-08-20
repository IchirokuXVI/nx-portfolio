{{- if .Values.reverseProxy.enabled }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: letsencrypt-pvc
  namespace: {{ .Values.namespace }}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
{{- end }}
