# Local Indexer Scripts (Windows)

Quick reference for starting/stopping local ingest, metrics/dashboard, and decode jobs. Paths assume repo root at `C:\EF-Map-main`.

Tips:
- For clickable links, use Markdown Preview: View -> Open Preview (or Ctrl+Shift+V). Then just click the links below.
- In the plain editor, ensure “Editor: Detect Links” is enabled and Ctrl+Click a link to open it.

## Ingestion
- Start ingester (detached): [open](../tools/local-indexer/start_ingest.ps1)
- Restart ingester: [open](../tools/local-indexer/restart_ingest.ps1)
- Kill ingester: [open](../tools/local-indexer/kill_ingest.ps1)

## Metrics & Dashboard
- Metrics server + dashboard (default port 8733): [open](../tools/local-indexer/start_metrics.ps1)
- Restart metrics (kill port then start): [open](../tools/local-indexer/restart_metrics.ps1)
- Stop metrics: [open](../tools/local-indexer/stop_metrics.ps1)
- Optional status server: [open](../tools/local-indexer/start_status.ps1)
- Metrics server source: [open](../tools/local-indexer/metrics_server.js)
- Status server source: [open](../tools/local-indexer/status_server.js)

## Decoding (typed)
- Start decode pass: [open](../tools/local-indexer/start_decode.ps1)
- Stop decode (cooperative): [open](../tools/local-indexer/stop_decode.ps1)
- Kill decode (force): [open](../tools/local-indexer/kill_decode.ps1)
- Restart decode: [open](../tools/local-indexer/restart_decode.ps1)
- Re-run recent window: [open](../tools/local-indexer/recode_recent.ps1)
- Decode runner source: [open](../tools/local-indexer/decode_apply.js)

## Materialization helpers
- MUD: [open](../tools/local-indexer/start_mud.ps1)
- ERC-20: [open](../tools/local-indexer/start_erc20.ps1)
- ERC-721: [open](../tools/local-indexer/start_erc721.ps1)
- ERC-1155: [open](../tools/local-indexer/start_erc1155.ps1)

## Utilities & references
- DB snapshot: [open](../tools/local-indexer/snapshot_db.js)
- Schema: [open](../tools/local-indexer/schema.sql)
- Topic map builder: [open](../tools/build_topic_map.js)
- Diagnose store logs: [open](../tools/diagnose_store_logs.js)

## Tips
- Run from PowerShell with: `& 'C:\\EF-Map-main\\tools\\local-indexer\\start_ingest.ps1'`
- You can create desktop shortcuts pointing to `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<script>"`.
- Most scripts write PID files under `data/` for easy process control.
- Metrics dashboard default: http://127.0.0.1:8733/ (summary at `/api/summary`).
