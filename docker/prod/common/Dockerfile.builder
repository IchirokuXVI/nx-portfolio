FROM node:22
WORKDIR /app
COPY . .
RUN ls -la
RUN npm ci
