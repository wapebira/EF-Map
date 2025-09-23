FROM python:3.11-slim

# Keep Python output unbuffered and avoid writing .pyc
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Install minimal OS deps: certs, curl, dumb-init, util-linux (flock), pg client
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl dumb-init util-linux postgresql-client \
 && rm -rf /var/lib/apt/lists/*

# Install supercronic (lightweight cron for containers) using stable latest URL
RUN curl -fsSL -o /usr/local/bin/supercronic \
     https://github.com/aptible/supercronic/releases/latest/download/supercronic-linux-amd64 \
 && chmod +x /usr/local/bin/supercronic

WORKDIR /app

# Copy cron spec and wrapper first (allows Docker layer cache reuse)
COPY tools/worldapi-cron/cron.d/worldapi /etc/cron.d/worldapi
COPY tools/worldapi-cron/run_pipeline.sh /app/run_pipeline.sh

# Copy only the pipeline source (avoid copying local venvs)
COPY tools/worldapi-pipeline/worldapi/worldapi_pipeline /app/worldapi_pipeline

# Python deps: dlt with Postgres extras, httpx for transport, duckdb optional
RUN python -m pip install --upgrade pip \
 && pip install \
      "dlt[postgres]>=0.5.4,<1" \
      "httpx>=0.24" \
      "duckdb>=0.10" \
      "psycopg[binary]>=3.1"

# dlt state directory (persisted via volume in compose)
# Default; can be overridden per service to separate state
ENV DLT_DATA_DIR=/app/.dlt

RUN chmod +x /app/run_pipeline.sh

# Use dumb-init to handle signals, then run supercronic with JSON logs
ENTRYPOINT ["dumb-init", "--"]
CMD ["supercronic", "-json", "/etc/cron.d/worldapi"]
