{{- if and .Values.lunaShopperBackend.enabled .Values.lunaShopperBackend.priorityClass.enabled }}
{{- $pc := .Values.lunaShopperBackend.priorityClass }}
{{/*
  The stateful tier's priority (plan 0004, section 2.1).

  QoS is inferred from resource numbers, which makes it a side effect of a sizing
  decision rather than a statement of intent. Preemption and eviction also
  consult priorityClassName, which says the thing outright.

  Deliberately NOT the built in `system-cluster-critical`. That is reserved for
  components the cluster itself needs to function and carries scheduling
  behaviour intended for those; borrowing it for an application database is the
  kind of shortcut that surprises the next person reading a preemption event.

  PriorityClass is a cluster scoped object, so it carries no namespace.
*/}}
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: {{ $pc.name }}
value: {{ $pc.value }}
globalDefault: false
description: Databases and the broker. Evicted and preempted after everything else.
{{- end }}
