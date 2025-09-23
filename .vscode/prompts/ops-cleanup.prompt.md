# Ops cleanup – stop legacy jobs

mode: agent

Goal: Stop memory-heavy or legacy local jobs and prevent respawn; document in `docs/decision-log.md`.

Steps:
1) Identify and terminate processes (Windows): use existing scripts under `tools/win/` when possible
2) Disable/remove related Scheduled Tasks; verify none remain
3) Search for auto-start vectors (Startup folders, Run/RunOnce registry)
4) Quarantine legacy launchers (rename/move)
5) Append a short decision-log entry (≤10 lines)

Output:
- Brief summary with actions taken and verification
- Deltas only for todo status
