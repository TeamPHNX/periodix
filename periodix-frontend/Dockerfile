# Build stage
FROM node:25-alpine AS build
WORKDIR /app

# Allow passing Vite env at build-time (used by import.meta.env)
ARG VITE_ENABLE_DEVELOPER_MODE
ENV VITE_ENABLE_DEVELOPER_MODE=$VITE_ENABLE_DEVELOPER_MODE

COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
# Prefer reproducible clean install; fall back to npm install if lockfile is out of sync (mirrors backend strategy)
RUN if [ -f package-lock.json ]; then \
            (npm ci || (echo '[Dockerfile] npm ci failed (likely lock mismatch) falling back to npm install' && npm install)); \
        elif [ -f pnpm-lock.yaml ]; then \
            npm i -g pnpm && pnpm i --frozen-lockfile; \
        elif [ -f yarn.lock ]; then \
            npm i -g yarn && yarn install --frozen-lockfile; \
        else \
            npm install; \
        fi

COPY . .
RUN npm run build

# Serve with nginx
FROM nginx:1.27-alpine AS runtime
WORKDIR /usr/share/nginx/html

# Copy built assets
COPY --from=build /app/dist/ /usr/share/nginx/html

# Fix permissions for Nginx
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Nginx config to support SPA routing and proxy /api to backend by default
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
