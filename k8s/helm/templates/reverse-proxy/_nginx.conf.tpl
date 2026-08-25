user nginx;
worker_processes auto;

events { worker_connections 1024; }

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;

  sendfile on;
  keepalive_timeout 65;

  {{- $appsByHost := dict }}
  {{- range .Values.apps }}
    {{- if or (ne .env "staging") $.Values.staging.enabled }}
    {{- $host := .host }}
    {{- if not (hasKey $appsByHost $host) }}
      {{- $_ := set $appsByHost $host (list .) }}
    {{- else }}
      {{- $_ := set $appsByHost $host (append (get $appsByHost $host) .) }}
    {{- end }}
    {{- end }}
  {{- end }}

  {{- range $host, $apps := $appsByHost }}
    server {
      listen 80;
      listen 443 ssl;
      server_name {{ $host }};

      ssl_certificate     /etc/nginx/certs/{{ $host }}.crt;
      ssl_certificate_key /etc/nginx/certs/{{ $host }}.key;

      location /.well-known/acme-challenge/ {
        root /var/www/certbot;
      }

      {{- range $apps }}
        # Acme Challenge Location
        location {{ .path }} {
          proxy_pass http://{{ .name }}:80;
          {{- if ne .path "/" }}
          rewrite ^{{ .path }}/?(.*)$ /$1 break;
          {{- end }}
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
        }
      {{- end }}
    }
  {{- end }}

  {{- if $.Values.lunaShopperBackend.enabled }}
  # Luna Shopper public services (plan 0002, section 5). The gateway (REST) and
  # realtime (WebSocket/SSE) each own a dedicated host. Only these two are routed;
  # auth and core stay internal. The realtime host carries the WebSocket upgrade
  # headers and long read/send timeouts so sockets survive.
  {{- range $.Values.lunaShopperBackend.services }}
  {{- if and .routed (or (ne .env "staging") $.Values.staging.enabled) }}
    server {
      listen 80;
      listen 443 ssl;
      server_name {{ .host }};

      ssl_certificate     /etc/nginx/certs/{{ .host }}.crt;
      ssl_certificate_key /etc/nginx/certs/{{ .host }}.key;

      location /.well-known/acme-challenge/ {
        root /var/www/certbot;
      }

      location / {
        proxy_pass http://{{ .name }}:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        {{- if .websocket }}
        # WebSocket upgrade + long lived connections.
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        {{- end }}
      }
    }
  {{- end }}
  {{- end }}
  {{- end }}
}
