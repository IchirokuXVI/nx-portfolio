apiVersion: v1
kind: ConfigMap
metadata:
  name: reverse-proxy-config
  namespace: {{ .Values.namespace }}
data:
  nginx.conf: |-
{{ include (print $.Template.BasePath "/reverse-proxy/_nginx.conf.tpl") . | indent 4 }}
