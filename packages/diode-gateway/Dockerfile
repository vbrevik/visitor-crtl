FROM node:22-alpine
WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package (diode-gateway may use shared/diode types)
COPY packages/shared/ packages/shared/

# Copy the diode-gateway package
COPY packages/diode-gateway/ packages/diode-gateway/

# Install dependencies for shared and diode-gateway
RUN npm ci --workspace=packages/shared --workspace=packages/diode-gateway

# Build shared (diode-gateway may depend on @vms/shared)
RUN npm run build -w packages/shared

# Environment variables with sensible defaults
ENV SIDE=unclass
ENV CONVEX_URL=http://localhost:3210
ENV NATS_URL=nats://localhost:4222
ENV POLL_INTERVAL_MS=5000

EXPOSE 3000

# Run with tsx (TypeScript execution)
CMD ["npx", "tsx", "packages/diode-gateway/src/index.ts"]
