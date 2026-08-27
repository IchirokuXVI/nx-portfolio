{{- if .Values.lunaShopperBackend.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{/*
  Only when there is more than one replica (plan 0004, section 3).

  `minAvailable: 1` against a single replica is unsatisfiable: evicting the only
  pod would leave zero available, so the API refuses every voluntary eviction and
  `kubectl drain` blocks forever. The failure is quiet in the worst way — nothing
  is wrong until the day you need to reboot the node for a kernel update.

  Rendering nothing rather than switching to `maxUnavailable: 1`: a budget that
  permits every disruption constrains nothing, and an object that exists but
  means nothing is worse than an absent one, because the next reader has to work
  out that it is inert. When a socket.io Redis adapter lands and replicaCount
  goes back to 2, this condition turns the PDBs back on with no further edit.
*/}}
{{- if gt (int $ls.replicaCount) 1 }}
{{- range $ls.services }}
---
# PodDisruptionBudget (plan 0002, section 6): a voluntary disruption (node drain
# during maintenance) may never take this service below minAvailable, so a
# rollout and a drain together still leave the service serving.
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ .name }}
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ .name }}
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  minAvailable: {{ $ls.pdb.minAvailable }}
  selector:
    matchLabels:
      app: {{ .name }}
{{- end }}
{{- end }}
{{- end }}
