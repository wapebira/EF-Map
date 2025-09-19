-- Schema for World API ingestion (idempotent)
CREATE SCHEMA IF NOT EXISTS world_api;

-- Track sync runs
CREATE TABLE IF NOT EXISTS world_api.sync_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running|ok|error
  notes TEXT
);

-- Solar systems
CREATE TABLE IF NOT EXISTS world_api.solarsystems (
  id BIGINT PRIMARY KEY,
  name TEXT,
  constellation_id BIGINT,
  region_id BIGINT,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION,
  raw JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Types
CREATE TABLE IF NOT EXISTS world_api.types (
  id BIGINT PRIMARY KEY,
  name TEXT,
  description TEXT,
  category_id BIGINT,
  category_name TEXT,
  group_id BIGINT,
  group_name TEXT,
  icon_url TEXT,
  mass DOUBLE PRECISION,
  portion_size BIGINT,
  radius DOUBLE PRECISION,
  volume DOUBLE PRECISION,
  raw JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tribes
CREATE TABLE IF NOT EXISTS world_api.tribes (
  id BIGINT PRIMARY KEY,
  name TEXT,
  name_short TEXT,
  description TEXT,
  member_count BIGINT,
  founded_at TEXT,
  tribe_url TEXT,
  raw JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Smart characters (list) - keyed by id (string per spec)
CREATE TABLE IF NOT EXISTS world_api.smartcharacters (
  id TEXT PRIMARY KEY,
  address TEXT,
  name TEXT,
  tribe_id BIGINT,
  portrait_url TEXT,
  raw JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Smart character by address (details)
CREATE TABLE IF NOT EXISTS world_api.smartcharacters_details (
  address TEXT PRIMARY KEY,
  id TEXT,
  name TEXT,
  tribe_id BIGINT,
  portrait_url TEXT,
  raw JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Views to help Grafana
CREATE OR REPLACE VIEW world_api.table_row_counts AS
SELECT 'solarsystems' AS table, count(*)::bigint AS rows FROM world_api.solarsystems
UNION ALL SELECT 'types', count(*) FROM world_api.types
UNION ALL SELECT 'tribes', count(*) FROM world_api.tribes
UNION ALL SELECT 'smartcharacters', count(*) FROM world_api.smartcharacters
UNION ALL SELECT 'smartcharacters_details', count(*) FROM world_api.smartcharacters_details;
