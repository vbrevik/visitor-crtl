FROM node:22-alpine
WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy the full mocks package
COPY packages/mocks/ packages/mocks/

# Install dependencies for the mocks workspace
RUN npm ci --workspace=packages/mocks

# Expose OnGuard (8080), Registers (8081), Notifications (8082)
EXPOSE 8080 8081 8082

# Run all three mock servers concurrently
CMD ["npx", "concurrently", \
  "npx tsx packages/mocks/onguard/src/server.ts", \
  "npx tsx packages/mocks/registers/src/server.ts", \
  "npx tsx packages/mocks/notifications/src/server.ts"]
