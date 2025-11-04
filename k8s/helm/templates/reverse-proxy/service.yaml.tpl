apiVersion: v1
kind: Service
metadata:
  name: reverse-proxy
  namespace: {{ .Values.namespace }}
spec:
  type: LoadBalancer
  selector:
    app: reverse-proxy
  ports:
    - name: http
      port: 80
      targetPort: 80
    - name: https
      port: 443
      targetPort: 443
