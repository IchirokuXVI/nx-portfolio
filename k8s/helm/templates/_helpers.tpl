{{/*
Expand the name of the chart.
*/}}
{{- define "charts.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "charts.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "charts.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "charts.labels" -}}
helm.sh/chart: {{ include "charts.chart" . }}
{{ include "charts.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "charts.selectorLabels" -}}
app.kubernetes.io/name: {{ include "charts.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "charts.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "charts.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
The public hostname for one `apps` or `lunaShopperBackend.services` entry.

Both lists are environment agnostic (plan 0002): an entry carries a `hostPrefix`
label, and the environment supplies the `baseDomain` it sits under. An empty
prefix is the domain root, which is where the shell lives. So the lists are
identical in both clusters and the domain is the only thing that moves.

`host` on the entry wins when set. That is the escape hatch the local values
files use, where the hostnames (portfolio.localhost, localhost) do not follow the
prefix-under-a-domain pattern the two clusters do.

Call with a dict:
  (dict "item" <entry> "root" $)
*/}}
{{- define "charts.host" -}}
{{- $item := .item -}}
{{- $root := .root -}}
{{- if $item.host -}}
{{- $item.host -}}
{{- else -}}
{{- $base := required "baseDomain is not set. Pass an environment values file (values.production.yaml or values.staging.yaml) alongside values.yaml, or set an explicit `host` on every apps/services entry." $root.Values.baseDomain -}}
{{- if $item.hostPrefix -}}
{{- printf "%s.%s" $item.hostPrefix $base -}}
{{- else -}}
{{- $base -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
imagePullSecrets for the pods that pull application images from the registry.

Empty in both clusters, and it should stay that way: each VPS authenticates to
the registry at the node level, so nothing per pod is needed there and the two
cluster deploys render exactly what they rendered before this existed.

It exists for a cluster that CI did not provision. A home machine running Docker
Desktop against the same published images holds no node level registry
credential, and a private package then fails as ImagePullBackOff carrying an
authentication error that names no fix. See values.homelab.yaml.

Call with the root context.
*/}}
{{- define "charts.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}
