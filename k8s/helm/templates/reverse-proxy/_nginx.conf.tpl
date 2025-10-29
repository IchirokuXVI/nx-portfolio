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
    {{- $host := .host }}
    {{- if not (hasKey $appsByHost $host) }}
      {{- $_ := set $appsByHost $host (list .) }}
    {{- else }}
      {{- $_ := set $appsByHost $host (append (get $appsByHost $host) .) }}
    {{- end }}
  {{- end }}

  {{- range $host, $apps := $appsByHost }}
    server {
      listen 80;
      listen 443 ssl;
      server_name {{ $host }};

      ssl_certificate     /etc/nginx/certs/{{ $host }}.crt;
      ssl_certificate_key /etc/nginx/certs/{{ $host }}.key;

      {{- range $apps }}
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
}
