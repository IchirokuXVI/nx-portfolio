{{- if .Values.metallb.enabled }}
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: main-pool
  namespace: metallb-system
spec:
  addresses:
    {{/* Fail the render rather than advertise an empty pool. values.staging.yaml
         ships this empty on purpose until the staging VPS exists; an unset
         address would otherwise leave the data plane Service <pending> forever
         while every other object looked healthy, which is the exact silent
         failure the serviceNamespaces note below is also about. */}}
    - {{ required "ipAddress is not set. Put this cluster's public IP in its environment values file (values.production.yaml / values.staging.yaml), or set metallb.enabled=false for a local deploy." .Values.ipAddress }}/32
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
