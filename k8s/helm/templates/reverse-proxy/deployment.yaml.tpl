{{- if .Values.reverseProxy.enabled }}
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
      annotations:
        # Restart the proxy only when its rendered nginx config actually changes
        # (e.g. a host/route added), instead of on every deploy.
        checksum/config: {{ include (print $.Template.BasePath "/reverse-proxy/_nginx.conf.tpl") . | sha256sum }}
    spec:
    # Needed in order to restart nginx from the certbot container
      shareProcessNamespace: true
      initContainers:
        {{- include "reverse-proxy.initContainer" . | nindent 8 }}
      containers:
        - name: reverse-proxy
          image: "{{ .Values.proxyImage.image }}:{{ .Values.proxyImage.tag }}"
          imagePullPolicy: {{ .Values.proxyImage.pullPolicy }}
          ports:
            - containerPort: 80
            - containerPort: 443
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/nginx.conf
              subPath: nginx.conf
            - name: certbot-webroot
              mountPath: /var/www/certbot
            - name: certs
              mountPath: /etc/nginx/certs
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
        {{- if .Values.certbot.enabled }}
        - name: certbot
          image: "{{ .Values.certbotImage.image }}:{{ .Values.certbotImage.tag }}"
          imagePullPolicy: {{ .Values.certbotImage.pullPolicy }}
          env:
            - name: DOMAINS
              value: |-
                {{- $hosts := dict }}
                {{- range .Values.apps }}
                  {{- if or (ne .env "staging") $.Values.staging.enabled }}
                  {{- if not (hasKey $hosts .host) }}
                    {{- $_ := set $hosts .host true }}
                    {{ .host }}
                  {{- end }}
                  {{- end }}
                {{- end }}
                {{- if .Values.lunaShopperBackend.enabled }}
                {{- range .Values.lunaShopperBackend.services }}
                  {{- if and .routed (or (ne .env "staging") $.Values.staging.enabled) }}
                  {{- if not (hasKey $hosts .host) }}
                    {{- $_ := set $hosts .host true }}
                    {{ .host }}
                  {{- end }}
                  {{- end }}
                  {{- end }}
                {{- end }}
          volumeMounts:
          # To avoid renewing certificates every time the pod restarts
            - name: letsencrypt-data
              mountPath: /etc/letsencrypt
          # To serve the acme-challenge responses via nginx reverse proxy
            - name: certbot-webroot
              mountPath: /var/www/certbot
          # To share the certs with other containers
            - name: certs
              mountPath: /certs
        {{- end }}
      volumes:
        - name: nginx-config
          configMap:
            name: reverse-proxy-config
        - name: certs
          persistentVolumeClaim:
            claimName: {{ .Values.certsVolume.claimName }}
        - name: certbot-webroot
          emptyDir: {}
        - name: letsencrypt-data
          persistentVolumeClaim:
            claimName: letsencrypt-pvc
{{- end }}
