{{- if .Values.gateway.enabled }}
{{- $hosts := include "common.appHosts" . }}
{{- if .Values.lunaShopperBackend.enabled }}
{{- range .Values.lunaShopperBackend.services }}
{{- if .routed }}
{{- $hosts = printf "%s\n%s" $hosts (include "charts.host" (dict "item" . "root" $)) }}
{{- end }}
{{- end }}
{{- end }}
{{- include "common.gateway" (dict "root" . "hosts" $hosts) }}
{{- end }}
