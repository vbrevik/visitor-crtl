# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package (dependency for all apps)
COPY packages/shared/ packages/shared/

# Copy convex-unclass (portal imports from its generated API)
COPY packages/convex-unclass/ packages/convex-unclass/

# Copy the portal app
COPY packages/portal/ packages/portal/

# Install dependencies for shared, convex-unclass, and portal
RUN npm ci --workspace=packages/shared --workspace=packages/convex-unclass --workspace=packages/portal

# Build shared first (portal depends on @vms/shared)
RUN npm run build -w packages/shared

# Convex URL for unclass side (port 3210)
ARG VITE_CONVEX_URL=http://localhost:3210
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ARG VITE_KEYCLOAK_URL=http://localhost:8180
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL

# Build the portal app
RUN npm run build -w packages/portal

# ---- Serve stage ----
FROM nginx:alpine

COPY --from=build /app/packages/portal/dist /usr/share/nginx/html

# SPA fallback: serve index.html for all routes
RUN echo 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri /index.html; } }' > /etc/nginx/conf.d/default.conf

EXPOSE 80
