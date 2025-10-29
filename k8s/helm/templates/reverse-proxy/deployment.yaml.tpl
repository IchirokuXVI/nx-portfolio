apiVersion: apps/v1
kind: Deployment
metadata:
  name: reverse-proxy
  namespace: {{ .Values.namespace }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: reverse-proxy
  template:
    metadata:
      labels:
        app: reverse-proxy
    spec:
      initContainers:
        {{- include "reverse-proxy.initContainer" . | nindent 8 }}
      containers:
        - name: reverse-proxy
          image: "{{ .Values.proxyImage.repository }}:{{ .Values.proxyImage.tag }}"
          imagePullPolicy: {{ .Values.proxyImage.pullPolicy }}
          ports:
            - containerPort: 80
            - containerPort: 443
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/nginx.conf
              subPath: nginx.conf
            - name: certs
              mountPath: /etc/nginx/certs
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
        - name: certbot
          image: "{{ .Values.certbotImage.repository }}:{{ .Values.certbotImage.tag }}"
          imagePullPolicy: {{ .Values.certbotImage.pullPolicy }}
          env:
            - name: DOMAINS
              value: |-
                {{- $hosts := dict }}
                {{- range .Values.apps }}
                  {{- if not (hasKey $hosts .host) }}
                    {{- $_ := set $hosts .host true }}
                    {{ .host }}
                  {{- end }}
                {{- end }}
          volumeMounts:
            - name: certs
              mountPath: /certs
      volumes:
        - name: nginx-config
          configMap:
            name: reverse-proxy-config
        - name: certs
          persistentVolumeClaim:
            claimName: {{ .Values.certsVolume.claimName }}
