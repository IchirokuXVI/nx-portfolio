ARG APP_NAME

# Use the builder image to build the microfrontend app
FROM nx-portfolio/builder AS builder
ARG APP_NAME
RUN npx nx build ${APP_NAME} --configuration=production

# Use the local-http-server image as the base for serving the app
FROM nx-portfolio/local-http-server
ARG APP_NAME
COPY --from=builder /app/dist/apps/${APP_NAME} /var/www/html/

# Run nginx in the foreground to keep the container running
CMD ["nginx", "-g", "daemon off;"]
