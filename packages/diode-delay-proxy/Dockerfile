FROM node:22-alpine
WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy the diode-delay-proxy package
COPY packages/diode-delay-proxy/ packages/diode-delay-proxy/

# Install dependencies
RUN npm ci --workspace=packages/diode-delay-proxy

# Environment variables with sensible defaults
ENV NATS_URL=nats://localhost:4222
ENV DELAY_MS=5000
ENV JITTER_MS=2000
ENV DROP_RATE=0.0

# Run with tsx (TypeScript execution, no build step needed)
CMD ["npx", "tsx", "packages/diode-delay-proxy/src/index.ts"]
