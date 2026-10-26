{{/*
The public hostname of one `apps`, `externalRoutes` or routed service entry.

An entry carries a `hostPrefix` label and the environment supplies the
`baseDomain` it sits under, so the entry lists are the same in every cluster and
the domain is what moves (plan 0002). An empty prefix is the domain root.

Precedence, highest first:

  `host` on the entry      the local values files, whose hostnames
                           (portfolio.localhost, localhost) follow no pattern
  `hostOverrides.<name>`   a values file that serves an entry under a domain of
                           another unit, as the homelab file does for velista
  `hostPrefix`.`baseDomain`

Each unit chart has a `baseDomain` of its own (plan 0015 D7), so the two
clusters need no override at all.

Call with a dict:
  (dict "item" <entry> "root" $)
*/}}
{{- define "charts.host" -}}
{{- $item := .item -}}
{{- $root := .root -}}
{{- $override := "" -}}
{{- if and $item.name $root.Values.hostOverrides -}}
{{- $override = (index $root.Values.hostOverrides $item.name | default "") -}}
{{- end -}}
{{- if $item.host -}}
{{- $item.host -}}
{{- else if $override -}}
{{- $override -}}
{{- else -}}
{{- $base := required "baseDomain is not set. Pass an environment values file (values.production.yaml or values.staging.yaml) alongside values.yaml, or set an explicit `host` on every entry." $root.Values.baseDomain -}}
{{- if $item.hostPrefix -}}
{{- printf "%s.%s" $item.hostPrefix $base -}}
{{- else -}}
{{- $base -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
imagePullSecrets for the pods that pull application images.

Empty in both clusters, because each VPS authenticates to the registry at the
node level. It exists for a cluster CI did not provision, such as the homelab,
where a private package otherwise fails as ImagePullBackOff with an
authentication error that names no fix.

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

{{/*
The name of the unit's Gateway, which is the name of its chart (plan 0015 D3).
*/}}
{{- define "common.gatewayName" -}}
{{- .Chart.Name -}}
{{- end }}

{{/*
The listener a route attaches to, as a `sectionName` line, or nothing.

With the HTTPS redirect on, a route attaches only to its host's HTTPS listener,
so that the plain listener of the host is left to the redirect. Attaching to
both would keep serving the site in plain text: an app route matching a host and
a path prefix outranks the catch all redirect, which would then never fire.
With the redirect off, as it is locally, the route answers on both listeners.

Call with a dict: (dict "host" <hostname> "root" $)
*/}}
{{- define "common.sectionName" -}}
{{- $gw := .root.Values.gateway -}}
{{- if and $gw.tls.enabled $gw.tls.redirectHttp -}}
sectionName: {{ .host | replace "." "-" }}-https
{{- end -}}
{{- end }}
