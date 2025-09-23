# Archived: Indexer Resilience Plan

This is an archived copy of `docs/indexer_resilience_plan.md` preserved for context. It reflects the standalone/D1 indexer roadmap (heartbeat, watchdog, leasing, adaptive windows). The active project path has shifted to KV-first snapshots for Smart Gates; retain this file for historical reference.

Key themes (archived):
- Heartbeat + watchdog, RPC timeouts, stall finalize metrics
- Multi-worker leasing concept, adaptive window sizing, tail/backfill split
- Failure queue & alerting, rollback strategies

Refer to decision-log entries on/after 2025-09-19 for the current Smart Gates KV-first approach.
