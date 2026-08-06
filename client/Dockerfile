# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency manifests first (layer caching)
COPY package.json pnpm-lock.yaml ./

# Install all deps
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source and build
COPY . .
RUN pnpm run build

# ── Stage 2: Production ────────────────────────────────────
FROM nginx:alpine

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]