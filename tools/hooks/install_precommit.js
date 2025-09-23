#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const GIT_HOOKS = path.join(ROOT, '.git', 'hooks');
const HOOK_PATH = path.join(GIT_HOOKS, 'pre-commit');

function main(){
  if(!fs.existsSync(path.join(ROOT, '.git'))){
    console.log('[hooks] .git not found; skipping pre-commit install');
    process.exit(0);
  }
  fs.mkdirSync(GIT_HOOKS, { recursive: true });
  const script = `#!/usr/bin/env bash\nset -e\n# Auto-curate decision log before commit\nnode tools/docs/curate_decision_log.js --compact --strict || { echo "curation failed"; exit 1; }\n# Stage updated docs if changed\nif git diff --quiet -- docs/decision-log.md docs/archive/decision-log; then\n  echo "[hooks] no doc changes"\nelse\n  git add docs/decision-log.md docs/archive/decision-log || true\nfi\n`;
  fs.writeFileSync(HOOK_PATH, script, { mode: 0o755 });
  console.log('[hooks] pre-commit installed');
}

main();
