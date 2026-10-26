{{- if .Values.gateway.enabled }}
{{- include "common.gateway" (dict "root" . "hosts" (include "common.appHosts" .)) }}
{{- end }}
