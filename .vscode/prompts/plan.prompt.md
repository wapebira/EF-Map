# Plan a change – EF-Map

mode: agent

You are planning a concrete change in EF-Map. Use the repo rules in `.github/copilot-instructions.md` and `AGENTS.md`.

Given the user’s goal, produce:
- Checklist (minimal diffs, sensitive files, risk class)
- Assumptions (≤2)
- Plan (files to touch, expected LoC delta)
- Verification steps (typecheck/build/smoke)
- If Cloudflare: prefer Wrangler CLI; preview deploy only; never commit secrets

Respond with a compact plan; then execute using tools.
