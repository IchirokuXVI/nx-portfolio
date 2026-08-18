{{/*
  Template: reverse-proxy.initContainer
  Description: Generates an initContainer that creates dummy certs for all configured apps.
*/}}

{{- define "reverse-proxy.initContainer" -}}
- name: init-certs
  image: alpine:latest
  imagePullPolicy: IfNotPresent
  command:
    - /bin/sh
    - -c
    - |
      set -e
      echo "🔍 Checking and generating dummy certs..."
      apk add --no-cache openssl

      CERTS_DIR="/certs"
      mkdir -p "$CERTS_DIR"

      {{- range .Values.apps }}
      {{- if or (ne .env "staging") $.Values.staging.enabled }}
      DOMAIN="{{ .host }}"
      KEY_FILE="$CERTS_DIR/$DOMAIN.key"
      CRT_FILE="$CERTS_DIR/$DOMAIN.crt"

      if [ ! -f "$CRT_FILE" ]; then
        echo "⚙️ Generating self-signed certificate for $DOMAIN ..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
          -keyout "$KEY_FILE" \
          -out "$CRT_FILE" \
          -subj "/C=US/ST=State/L=City/O=nx-portfolio/OU=Dev/CN=$DOMAIN"
      else
        echo "Certificate for $DOMAIN already exists."
      fi
      {{- end }}
      {{- end }}

      echo "All dummy certs ready."
  volumeMounts:
    - name: certs
      mountPath: /certs
{{- end }}
