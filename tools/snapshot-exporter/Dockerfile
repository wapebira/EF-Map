FROM node:22-slim

ENV NODE_ENV=production \
    PIP_NO_CACHE_DIR=1

# Packages: dumb-init for signal handling, curl + unzip for wrangler install, procps for health/debug
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates curl unzip procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Wrangler CLI (auth via env/volume at runtime). Use npm for stable install.
RUN npm i -g wrangler@latest \
 && wrangler --version

# Install app deps
COPY package.json package-lock.json* pnpm-lock.yaml* ./
# Prefer pnpm lock if present; fall back to npm ci
RUN if [ -f pnpm-lock.yaml ]; then \
      npm -g install pnpm@8 && pnpm install --prod; \
    else \
      npm ci --omit=dev; \
    fi

# Copy exporter source and cron specs
COPY tools/snapshot-exporter/exporter.js /app/exporter.js
COPY tools/snapshot-exporter/structure_snapshot_exporter.js /app/structure_snapshot_exporter.js
COPY tools/snapshot-exporter/inspect_schema.js /app/inspect_schema.js
COPY tools/snapshot-exporter/cron.d/snapshot-exporter /etc/cron.d/snapshot-exporter
RUN sed -i 's/\r$//' /etc/cron.d/snapshot-exporter

# Minimal cron runner: use supercronic for reliability
RUN curl -fsSL -o /usr/local/bin/supercronic \
     https://github.com/aptible/supercronic/releases/latest/download/supercronic-linux-amd64 \
 && chmod +x /usr/local/bin/supercronic

# Create a writable work dir for temporary files if needed
RUN mkdir -p /app/work

ENTRYPOINT ["dumb-init","--"]
CMD ["supercronic","-json","/etc/cron.d/snapshot-exporter"]
