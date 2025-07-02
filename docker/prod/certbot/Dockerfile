FROM certbot/certbot:latest

COPY entrypoint.sh /entrypoint.sh
COPY deploy-hook.sh /deploy-hook.sh
RUN chmod +x /entrypoint.sh /deploy-hook.sh

ENTRYPOINT ["/entrypoint.sh"]
