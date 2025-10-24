FROM node:22
WORKDIR /app
# Copy only dependency files first to leverage Docker cache
COPY --parents **/package*.json .
RUN npm ci --legacy-peer-deps
# Now copy the rest of the application code
COPY . .
