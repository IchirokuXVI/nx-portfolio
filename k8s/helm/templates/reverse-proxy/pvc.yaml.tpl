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
  storageClassName: local-path
