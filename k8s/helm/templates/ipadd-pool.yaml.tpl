{{- if .Values.metallb.enabled }}
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: main-pool
  namespace: metallb-system
spec:
  addresses:
    - {{ .Values.ipAddress }}/32
  serviceAllocation:
    # A list rather than just this chart's namespace: the gateway implementation
    # provisions its data plane Service in its own namespace, and that Service is
    # the one that has to receive the address. Restricting the pool to
    # .Values.namespace would leave it <pending> forever, silently.
    namespaces:
      {{- range .Values.metallb.serviceNamespaces }}
      - {{ . }}
      {{- end }}
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: main-advertisement
  namespace: metallb-system
spec:
  ipAddressPools:
    - main-pool
{{- end }}
