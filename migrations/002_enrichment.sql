-- Migration 002_enrichment.sql (enrichment metadata schema)
-- Purpose: Introduce side-table for API / off-chain enriched metadata related to smart assemblies
-- and extend indexer_run with api_enrichments counter without mutating existing dynamic columns.
-- Idempotent creation guarded by IF NOT EXISTS and conditional column add pattern.

-- Assembly Metadata (API-sourced / derived fields)
CREATE TABLE IF NOT EXISTS assembly_metadata (
  id TEXT PRIMARY KEY REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  source_priority TEXT NOT NULL DEFAULT 'api', -- future: 'api' | 'chain' | 'mixed'
  name_api TEXT NULL,
  description_api TEXT NULL,
  extra_json TEXT NULL, -- arbitrary structured metadata (names, stats, tags)
  metadata_hash TEXT NULL, -- stable hash of normalized JSON to skip redundant writes
  last_api_update_at TIMESTAMP NULL,
  last_chain_ref_at TIMESTAMP NULL
);
CREATE INDEX IF NOT EXISTS idx_assembly_metadata_world ON assembly_metadata(world_version);
CREATE INDEX IF NOT EXISTS idx_assembly_metadata_api_update ON assembly_metadata(last_api_update_at);

-- Extend indexer_run with enrichment metric if missing
-- (D1 lacks IF NOT EXISTS on ALTER ADD COLUMN; attempt and ignore error if exists)
ALTER TABLE indexer_run ADD COLUMN api_enrichments INTEGER DEFAULT 0;
