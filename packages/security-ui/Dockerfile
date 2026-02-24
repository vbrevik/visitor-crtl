# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package (dependency for all apps)
COPY packages/shared/ packages/shared/

# Copy convex-restricted (security-ui imports from its generated API)
COPY packages/convex-restricted/ packages/convex-restricted/

# Copy the security-ui app
COPY packages/security-ui/ packages/security-ui/

# Install dependencies for shared, convex-restricted, and security-ui
RUN npm ci --workspace=packages/shared --workspace=packages/convex-restricted --workspace=packages/security-ui

# Build shared first (security-ui depends on @vms/shared)
RUN npm run build -w packages/shared

# Convex URL for restricted side (port 3211)
ARG VITE_CONVEX_URL=http://localhost:3211
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ARG VITE_KEYCLOAK_URL=http://localhost:8180
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL

# Build the security-ui app
RUN npm run build -w packages/security-ui

# ---- Serve stage ----
FROM nginx:alpine

COPY --from=build /app/packages/security-ui/dist /usr/share/nginx/html

# SPA fallback: serve index.html for all routes
RUN echo 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri /index.html; } }' > /etc/nginx/conf.d/default.conf

EXPOSE 80
