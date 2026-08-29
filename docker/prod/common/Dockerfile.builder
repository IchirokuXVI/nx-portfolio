FROM node:24
WORKDIR /app
COPY . .
RUN npm ci --legacy-peer-deps
