ARG NODE_ENV=development

# Use the builder image to build the microfrontend app
# TO-DO: set the builder image tag, right now it uses latest always which means
# that dev tag is never used at all which is confusing
# Also it might not make much sense to use another image as base if we are going to
# build an app and the image might not have the code updated
FROM nx-portfolio/builder AS builder
ARG NODE_ENV=development
ENV NODE_ENV=$NODE_ENV
ARG APP_NAME
RUN npx nx build ${APP_NAME} --configuration=${NODE_ENV}

# Use the local-http-server image as the base for serving the app
FROM nx-portfolio/local-http-server
ARG APP_NAME
COPY --from=builder /app/dist/apps/${APP_NAME} /var/www/html/

# Run nginx in the foreground to keep the container running
CMD ["nginx", "-g", "daemon off;"]
