-- World API raw table counts (exact COUNT(*))
-- Use these directly in Grafana PostgreSQL panels.

-- World API (DLT raw landing schema)
SELECT COUNT(*) AS rows FROM world_api_dlt.raw_solarsystems;          -- ~24,5k
SELECT COUNT(*) AS rows FROM world_api_dlt.raw_types;                 -- ~321
SELECT COUNT(*) AS rows FROM world_api_dlt.raw_tribes;                -- ~24
SELECT COUNT(*) AS rows FROM world_api_dlt.raw_smartcharacters;       -- ~9,5k
SELECT COUNT(*) AS rows FROM world_api_dlt.raw_smartcharacters_details; -- ~2,000
SELECT COUNT(*) AS rows FROM world_api_dlt.raw_smartcharacters_details__smart_assemblies; -- ~19k

-- World API (processed schema — may be zero until transforms run)
SELECT COUNT(*) AS rows FROM world_api.raw_solarsystems;
SELECT COUNT(*) AS rows FROM world_api.raw_types;
SELECT COUNT(*) AS rows FROM world_api.raw_tribes;
SELECT COUNT(*) AS rows FROM world_api.raw_smartcharacters;
SELECT COUNT(*) AS rows FROM world_api.raw_smartcharacters_details;
SELECT COUNT(*) AS rows FROM world_api.smartcharacters;
SELECT COUNT(*) AS rows FROM world_api.smartcharacters_details;
SELECT COUNT(*) AS rows FROM world_api.solarsystems;
SELECT COUNT(*) AS rows FROM world_api.tribes;
SELECT COUNT(*) AS rows FROM world_api.types;

-- Union view for a single table panel (label, rows)
-- Paste this in a Grafana Table panel to see multiple counts at once.
SELECT * FROM (
  SELECT 'world_api_dlt.raw_solarsystems' AS table_name, COUNT(*)::bigint AS rows FROM world_api_dlt.raw_solarsystems
  UNION ALL SELECT 'world_api_dlt.raw_types', COUNT(*) FROM world_api_dlt.raw_types
  UNION ALL SELECT 'world_api_dlt.raw_tribes', COUNT(*) FROM world_api_dlt.raw_tribes
  UNION ALL SELECT 'world_api_dlt.raw_smartcharacters', COUNT(*) FROM world_api_dlt.raw_smartcharacters
  UNION ALL SELECT 'world_api_dlt.raw_smartcharacters_details', COUNT(*) FROM world_api_dlt.raw_smartcharacters_details
  UNION ALL SELECT 'world_api_dlt.raw_smartcharacters_details__smart_assemblies', COUNT(*) FROM world_api_dlt.raw_smartcharacters_details__smart_assemblies
  UNION ALL SELECT 'world_api.raw_solarsystems', COUNT(*) FROM world_api.raw_solarsystems
  UNION ALL SELECT 'world_api.raw_types', COUNT(*) FROM world_api.raw_types
  UNION ALL SELECT 'world_api.raw_tribes', COUNT(*) FROM world_api.raw_tribes
  UNION ALL SELECT 'world_api.raw_smartcharacters', COUNT(*) FROM world_api.raw_smartcharacters
  UNION ALL SELECT 'world_api.raw_smartcharacters_details', COUNT(*) FROM world_api.raw_smartcharacters_details
  UNION ALL SELECT 'world_api.smartcharacters', COUNT(*) FROM world_api.smartcharacters
  UNION ALL SELECT 'world_api.smartcharacters_details', COUNT(*) FROM world_api.smartcharacters_details
  UNION ALL SELECT 'world_api.solarsystems', COUNT(*) FROM world_api.solarsystems
  UNION ALL SELECT 'world_api.tribes', COUNT(*) FROM world_api.tribes
  UNION ALL SELECT 'world_api.types', COUNT(*) FROM world_api.types
) AS t
ORDER BY table_name;

-- Optional: quick approximate counts (no table scans) across both schemas
-- Use when tables get large and exact COUNT(*) becomes slow.
-- SELECT n.nspname AS schema, c.relname AS table_name, c.reltuples::bigint AS approx_rows
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE c.relkind = 'r' AND n.nspname IN ('world_api','world_api_dlt')
-- ORDER BY 1,2;
