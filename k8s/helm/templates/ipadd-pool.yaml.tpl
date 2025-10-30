apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: main-pool
  namespace: metallb-system
spec:
  addresses:
    - {{ .Values.ipAddress }}/32
  serviceAllocation:
    namespaces:
      - {{ .Values.namespace }}
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: main-advertisement
  namespace: metallb-system
spec:
  ipAddressPools:
    - main-pool
