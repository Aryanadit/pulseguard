# apps/api-gateway/Dockerfile

FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable

# Copy workspace metadata and shared TypeScript config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./

# Copy monorepo source
COPY apps ./apps
COPY packages ./packages

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build API Gateway and all workspace dependencies
RUN pnpm --filter @pulseguard/api-gateway... build

# Runtime image
FROM node:20-alpine AS runtime

WORKDIR /app

RUN corepack enable

# Copy everything from builder
COPY --from=builder /app ./

ENV NODE_ENV=production
ENV API_PORT=3001

EXPOSE 3001

# Start compiled JavaScript
CMD ["node", "apps/api-gateway/dist/index.js"]
