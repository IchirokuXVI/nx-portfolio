{{/*
Whether one optional entry of `lunaShopperBackend.services` or
`lunaShopperBackend.postgres.instances` should be rendered (plan 0038).

An entry with no `optional` key is unconditional. An entry carrying
`optional: <feature>` renders only when `lunaShopperBackend.<feature>.enabled`
is true.

It answers "1" for yes and the empty string for no, because a template can only
return a string. Use it as the condition of an `if`; never compare it.

The optional entries are gated rather than appended by an environment file
because Helm replaces a list whole: an environment file wanting one extra entry
would have to restate every other one, and the copies would drift.

Call with a dict: (dict "entry" <entry> "ls" .Values.lunaShopperBackend)
*/}}
{{- define "lunaShopperBackend.entryEnabled" -}}
{{- $entry := .entry -}}
{{- $ls := .ls -}}
{{- if not $entry.optional -}}
1
{{- else -}}
{{- $feature := index $ls $entry.optional -}}
{{- if and $feature $feature.enabled -}}
1
{{- end -}}
{{- end -}}
{{- end }}
