# ============================================
# Stage 1: Install dependencies
# ============================================
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ============================================
# Stage 2: Build the Next.js application
# ============================================
FROM node:20-slim AS builder

WORKDIR /app

# Copy all dependencies (including devDependencies for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the Next.js app (produces .next/standalone)
RUN npm run build

# ============================================
# Stage 3: Production runtime
# ============================================
FROM node:20-slim AS runner

# Install only the system tools needed at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    && python3 -m pip install --break-system-packages --no-cache-dir \
    yt-dlp instaloader gallery-dl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy the standalone Next.js server (self-contained, no node_modules needed)
COPY --from=builder /app/.next/standalone ./

# Copy static assets and public files
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy cookies.txt if it exists (needed for yt-dlp auth)
COPY cookies.txt* ./

# Cloud Run injects PORT env var; Next.js standalone respects it
EXPOSE 3000

# Run as non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /tmp/downloads && chown nextjs:nodejs /tmp/downloads

USER nextjs

# Start the standalone server
CMD ["node", "server.js"]
