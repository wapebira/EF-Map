# Archived: Post‑Ingestion Playbook (EF Index)

This file preserves the operational playbook for a D1-backed indexer (decode/materialize, retention/cleanup, cost controls) prior to the project's pivot to KV-first Smart Gates.

Highlights (archived):
- Decode pipeline from `raw_logs` → `record_latest` → domain tables
- Retention strategy (A1/A2 archives), archiver cadence, budget levers
- Delivery architecture for semi-live overlays on top of static snapshots

For current Smart Gates delivery, rely on KV snapshots and lightweight overlays as documented in recent decision log entries.
