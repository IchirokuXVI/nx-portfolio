FROM certbot/certbot:latest

# Install docker-cli to allow interaction with Docker daemon after issuing certificates
RUN apk add --no-cache docker-cli

COPY entrypoint.sh /entrypoint.sh
COPY deploy-hook.sh /deploy-hook.sh
RUN chmod +x /entrypoint.sh /deploy-hook.sh

ENTRYPOINT ["/entrypoint.sh"]
