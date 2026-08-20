{{- if .Values.reverseProxy.enabled }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ .Values.certsVolume.claimName }}
  namespace: {{ .Values.namespace }}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  {{- if .Values.certsVolume.storageClassName }}
  storageClassName: {{ .Values.certsVolume.storageClassName }}
  {{- end }}
{{- end }}
