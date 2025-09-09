-- 004_run_duration: add run_duration_ms column to indexer_run
ALTER TABLE indexer_run ADD COLUMN run_duration_ms INTEGER DEFAULT NULL;
