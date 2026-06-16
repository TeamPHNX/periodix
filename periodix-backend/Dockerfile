# Build stage
FROM node:25-bookworm-slim AS build
WORKDIR /app

# Install OS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests and install deps
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
# Prefer clean reproducible install (npm ci) but fall back to npm install if lockfile out of sync
RUN npm config set strict-ssl false && if [ -f package-lock.json ]; then (npm ci || (echo '[Dockerfile] npm ci failed (likely lock mismatch) falling back to npm install' && npm install)); \
    elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile; \
    elif [ -f yarn.lock ]; then npm i -g yarn && yarn install --frozen-lockfile; \
    else npm i; fi

# Copy source (everything below invalidates cache only when sources change)
COPY tsconfig.json ./tsconfig.json
COPY prisma.config.ts ./prisma.config.ts
COPY prisma ./prisma
COPY src ./src

# Declare build args AFTER dependency install so changing secrets / URLs doesn't force reinstall
ARG DATABASE_URL
ARG JWT_SECRET
ENV DATABASE_URL=${DATABASE_URL}
ENV JWT_SECRET=${JWT_SECRET}

# Generate Prisma Client and build (needs DATABASE_URL for some generators)
RUN DATABASE_URL="postgresql://postgres:postgres@localhost:5432/periodix" npx prisma generate && npm run build

# Runtime stage
FROM node:25-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
    PRISMA_CLIENT_ENGINE_TYPE=library \
    PRISMA_CLI_QUERY_ENGINE_TYPE=library

ARG CORS_ORIGIN
ARG PORT

ENV CORS_ORIGIN=${CORS_ORIGIN}
ENV PORT=${PORT}

# Install tini and curl for healthchecks, openssl for Prisma
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/usr/bin/tini", "--"]

# Copy built app and prisma artifacts
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/prisma /app/prisma
COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/prisma.config.ts /app/prisma.config.ts

# App port (documented default)
EXPOSE 3001

# Entrypoint to run migrations and start app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Normalize potential Windows CRLF line-endings and ensure executable bit
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh
CMD ["/usr/local/bin/docker-entrypoint.sh"]

# Note: Whitelist is DB-backed; no file is needed inside the container.
