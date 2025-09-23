#!/usr/bin/env node
/**
 * Decision log curation script
 * - Reads docs/decision-log.md
 * - Splits into sections by headings starting with '## '
 * - Classifies sections:
 *    KEEP if related to current setup: Primordium indexer, World API via Docker, Postgres, Grafana, Docker, Cloudflare website/KV snapshots & overlays, Smart Gates overlay/UI
 *    ARCHIVE if legacy/irrelevant: Cloudflare D1 indexer, /api/indexer-* endpoints, cron/scheduled workers for ingestion, raw_logs/store_all/decode, shadow tables, ABI/topic map tooling, Netlify-era details
 * - Writes:
 *    docs/decision-log.md (curated, with banner + condensed whitespace)
 *    docs/archive/decision-log/decision-log-legacy-<YYYY-MM-DD>.md (archived sections with banner)
 *
 * Non-destructive condense: collapse 2+ blank lines to a single blank line; trim trailing spaces.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const DECISION_LOG = path.join(ROOT, 'docs', 'decision-log.md');
const ARCHIVE_DIR = path.join(ROOT, 'docs', 'archive', 'decision-log');
const TODAY = new Date().toISOString().slice(0, 10);
const ARCHIVE_FILE_TODAY = path.join(ARCHIVE_DIR, `decision-log-legacy-${TODAY}.md`);

function readFileSafe(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeFileSafe(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function splitSections(markdown) {
  // Ensure we preserve any initial banner before the first '## '
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { heading: line, body: [] };
    } else {
      if (!current) {
        // Preamble before first section
        current = { heading: null, body: [line] };
      } else {
        current.body.push(line);
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

// Keywords for relevance
const RELEVANT_KEYWORDS = [
  // Current data pipeline & ops
  'primordium', 'world api', 'world_api', 'worldapi', 'dlt', 'openapi', 'docker', 'compose', 'postgres', 'postgresql',
  'grafana', 'dashboard', 'metrics_server.js', 'world_api_dlt', 'worldapi_dlt', 'tribe_member',
  // Website & CF KV overlays
  'cloudflare pages', 'cloudflare worker', 'kv', 'ef_snapshots', 'smart gate', 'smart-gate', '/api/smart-gate-links', '/api/system-overlays',
  'usage-event', '/api/stats', 'ef_stats', 'bom', 'utf-8 bom', 'short share', '/s/<id>', '/api/create-share', '/api/get-share',
  // Exporters & snapshots
  'snapshot', 'exporter', 'tools/snapshot-exporter', 'smart_gate_links_v1',
];

const LEGACY_KEYWORDS = [
  // Legacy D1 indexer & cron
  'd1', 'index_db', '/api/indexer', 'indexer_run', 'store_all', 'store_events', 'raw_logs', 'decode', 'shadow', 'gap scan',
  'abi', 'topic map', 'worlds.json', 'registertable', 'apply_cursor', 'record_latest', 'cron', 'ef-indexer-cron',
  'scheduled(', 'wrangler.jsonc', 'migrations/00', 'migration ', 'INDEXER_', 'admin token', 'openPreview', 'pages cron',
  // Netlify era (generally legacy now)
  'netlify functions', '/.netlify/functions', 'netlify blobs',
];

function containsAny(text, arr) {
  const lc = text.toLowerCase();
  return arr.some(k => lc.includes(k));
}

function classifySection(sec) {
  const text = [sec.heading || '', ...sec.body].join('\n');
  const hasRelevant = containsAny(text, RELEVANT_KEYWORDS);
  const hasLegacy = containsAny(text, LEGACY_KEYWORDS);

  // Always keep Smart Gates + KV + current stats/shares topics
  if (hasRelevant) return 'keep';

  // Heuristic: Sections mentioning only legacy concepts get archived
  if (hasLegacy) return 'archive';

  // Default: keep if neutral (e.g., general website/UI features), unless it's clearly an old indexer-only topic
  // Quick guard: if it mentions strictly indexer-specific verbs without any app/kv/grafana keywords, archive
  const indexerOnlyHints = ['ingest', 'cursor', 'eth_getlogs', 'decode', 'table_registry', 'indexer'];
  if (containsAny(text, indexerOnlyHints)) return 'archive';

  return 'keep';
}

function condenseWhitespace(content) {
  // Trim trailing spaces and collapse 2+ blank lines to single blank line
  const trimmed = content.split(/\r?\n/).map(l => l.replace(/[\t ]+$/g, '')).join('\n');
  return trimmed.replace(/\n{3,}/g, '\n\n');
}

function compactSection(sec) {
  // Reduce a section to essential bullets: keep heading and select lines
  // Drop code fences and long paragraphs. Keep only lines starting with dash bullets or simple prefixes.
  const STRICT = process.argv.includes('--strict') || process.env.COMPACT_STRICT === '1';
  // Defaults: in non-strict mode we keep most bullets; in strict mode we only keep a minimal set
  const defaultKeepPrefixes = STRICT
    ? ['- Goal', '- Verification', '- Preview', '- Risk', '- Gates', '- API', '- Endpoint', '- Endpoints', 'Preview:', 'Risk:', 'Gates:']
    : ['- Goal', '- Files', '- Endpoints', '- Actions', '- Verification', '- Preview', '- Risk', '- Gates', '- Follow-ups', '- Impact', '- Result', '- Outcome', '- Notes', 'Preview:', 'Risk:', 'Gates:', 'Follow-ups:'];

  // Allow overrides via env: comma-separated list
  const envKeep = (process.env.COMPACT_KEEP_PREFIXES || '').split(',').map(s => s.trim()).filter(Boolean);
  const keepPrefixes = envKeep.length ? envKeep : defaultKeepPrefixes;

  // Drop list (used to aggressively remove noisy lines)
  const defaultDropPrefixes = ['- Files', '- Follow-ups', '- Notes', '- Actions', '- Impact', '- Result', '- Outcome', '- Purpose'];
  const envDrop = (process.env.COMPACT_DROP_PREFIXES || '').split(',').map(s => s.trim()).filter(Boolean);
  const dropPrefixes = envDrop.length ? envDrop : defaultDropPrefixes;

  // In non-strict mode, keep any bullet by default; in strict, only keep if it matches keepPrefixes
  const keepAnyBullet = process.env.COMPACT_KEEP_ANY_BULLET === '1' || !STRICT;
  const maxLen = Number(process.env.COMPACT_MAX_LINE || 200);
  const body = (sec.body || []).join('\n')
    // remove fenced code blocks
    .replace(/```[\s\S]*?```/g, '')
    // collapse multiple blank lines early
    .replace(/\n{3,}/g, '\n\n');
  const lines = body.split(/\r?\n/);
  const out = [];
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(''); continue; }
    // Keep short bullets and key prefixes
    const isDash = trimmed.startsWith('- ');
    // Drop if matches any explicit drop prefix first
    const isDropped = dropPrefixes.some(p => trimmed.startsWith(p));
    if (isDropped) continue;
    const hasPrefix = keepPrefixes.some(p => trimmed.startsWith(p));
    if ((isDash && (keepAnyBullet || hasPrefix)) || (!isDash && hasPrefix)) {
      // Limit overly long lines for readability
      let kept = trimmed;
      if (kept.length > maxLen) kept = kept.slice(0, maxLen - 1) + '…';
      out.push(kept);
    }
  }
  // Remove leading/trailing empty lines and collapse extras
  const compacted = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^(\n)+|\n+$/g, '');
  return { heading: sec.heading, body: compacted ? compacted.split('\n') : [] };
}

function run() {
  const original = readFileSafe(DECISION_LOG);
  const sections = splitSections(original);

  // Preserve any preamble (first section without heading) at the top
  const preamble = sections.length && sections[0].heading === null ? sections.shift() : null;

  const keep = [];
  const archive = [];

  for (const sec of sections) {
    const cls = classifySection(sec);
    (cls === 'keep' ? keep : archive).push(sec);
  }

  // Remove any existing Quick Reference sections from the kept list to avoid duplication
  const isQuickRef = (sec)=> !!sec.heading && /^##\s+Current Environment Quick Reference/i.test(sec.heading.trim());
  const keepFiltered = keep.filter(sec => !isQuickRef(sec));

  function latestArchiveRelPath(){
    try {
      if(!fs.existsSync(ARCHIVE_DIR)) return null;
      const files = fs.readdirSync(ARCHIVE_DIR).filter(f=>/^decision-log-legacy-\d{4}-\d{2}-\d{2}\.md$/.test(f));
      files.sort();
      const latest = files[files.length-1];
      return latest ? path.join('archive','decision-log', latest) : null;
    } catch{ return null; }
  }

  const archiveRel = latestArchiveRelPath() || path.join('archive','decision-log', `decision-log-legacy-${TODAY}.md`);

  const bannerMain = [
    `<!-- Curated on ${TODAY}. This log keeps entries relevant to: Primordium indexer (World API via Docker), Postgres, Grafana, Docker, and the Cloudflare-hosted website (KV stats/snapshots/overlays). Older/legacy D1 indexer & cron/decoder content moved to archive. -->`,
    '',
    `Older entries and legacy indexer details have been archived: [${archiveRel}](./${archiveRel.replace(/\\/g,'/')})`,
    '',
  ].join('\n');

  const bannerArchive = [
    `# Decision Log (Legacy / Archived on ${TODAY})`,
    '',
    `This file contains entries not directly relevant to the current setup (Primordium indexer + World API via Docker, Postgres, Grafana, Cloudflare website/KV).`,
    `They are preserved for historical context: legacy Cloudflare D1 indexer, cron/scheduled ingestion, raw_logs/store_all/decode, shadow/gap scan, ABI/topic-map, and Netlify-era notes.`,
    '',
  ].join('\n');

  const COMPACT = process.argv.includes('--compact') || process.env.COMPACT === '1';

  function joinSections(list, applyCompact = true) {
    const processed = applyCompact && COMPACT ? list.map(compactSection) : list;
    return processed.map(sec => [sec.heading || '', ...sec.body].join('\n')).join('\n');
  }

  // Build an auto-generated quick reference from wrangler configs and worker.js
  function stripJsonc(text){
    // remove /* */ comments
    let t = text.replace(/\/\*[\s\S]*?\*\//g, '');
    // remove // comments (tolerate JSONC style)
    t = t.split(/\r?\n/).map(l=> l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
    return t;
  }
  function loadJsoncSafe(p){
    try { const raw = readFileSafe(p); const stripped = stripJsonc(raw); return JSON.parse(stripped); } catch { return null; }
  }
  function safeGet(obj, pathArr, dflt=null){
    try { return pathArr.reduce((o,k)=> (o && k in o) ? o[k] : undefined, obj) ?? dflt; } catch { return dflt; }
  }
  function extractEndpoints(workerText){
    const out = new Set();
    const re = /if\(p\s*===\s*['"]([^'"]+)['"]/g;
    let m; while((m=re.exec(workerText))){ out.add(m[1]); }
    return Array.from(out).sort();
  }
  function extractConst(text, name){
    const re = new RegExp(`const\\s+${name}\\s*=\\s*['\"]([^'\"]+)['\"]`);
    const m = text.match(re); return m ? m[1] : null;
  }
  function extractCacheControls(text){
    // find Cache-Control strings used in smart-gate-links and system-overlays
    const lines = [];
    const re = /'Cache-Control'\s*:\s*'([^']+)'/g;
    let m; while((m=re.exec(text))){ lines.push(m[1]); }
    return Array.from(new Set(lines));
  }
  function buildQuickRef(){
    const rootWrangler = loadJsoncSafe(path.join(ROOT, 'wrangler.jsonc')) || {};
    const pagesWrangler = loadJsoncSafe(path.join(ROOT, 'eve-frontier-map', 'wrangler.jsonc')) || {};
    const workerPath = path.join(ROOT, 'worker.js');
    const workerText = fs.existsSync(workerPath) ? readFileSafe(workerPath) : '';
    const pagesName = pagesWrangler.name || 'ef-map';
    const kvs = Array.isArray(pagesWrangler.kv_namespaces) ? pagesWrangler.kv_namespaces : (rootWrangler.kv_namespaces||[]);
    const kvLines = (kvs||[]).map(k => `  - ${k.binding} → ${k.id}`).join('\n');
    const vars = pagesWrangler.vars || {};
    const pyro = vars.PYROPE_RPC || null;
    const world = vars.WORLD_ADDRESS || null;
    const deploy = vars.DEPLOY_BLOCK || null;
    const confirm = vars.CONFIRM_DEPTH || null;
    const worldApiBase = extractConst(workerText, 'WORLD_API_BASE') || null;
    const endpoints = extractEndpoints(workerText);
  const cacheControls = extractCacheControls(workerText);
  // Diagnostic headers present in worker responses
  const diagHeaders = [];
  if(/X-Links-Source/i.test(workerText)) diagHeaders.push('X-Links-Source');
  if(/X-Overlays-Source/i.test(workerText)) diagHeaders.push('X-Overlays-Source');
  if(/X-Stats-Impl/i.test(workerText)) diagHeaders.push('X-Stats-Impl');
    const now = TODAY;
    const lines = [];
    lines.push(`## Current Environment Quick Reference (as of ${now})`);
    lines.push('- Hosting/runtime');
    lines.push("  - Cloudflare Pages + Worker (Pages serves assets; `_worker.js` handles `/api/*`). Netlify code removed post-cutover.");
    lines.push("  - Preview detection: hosts ending with `.pages.dev`; admin endpoints allow preview bypass with `?openPreview=1` when token is absent/mismatched.");
    lines.push('- Pages project');
    lines.push(`  - name: ${pagesName}`);
    lines.push('- KV namespaces (binding → namespace id)');
    lines.push(kvLines || '  - (none)');
    lines.push('- Chain / indexer config (Pages vars)');
    if(pyro) lines.push(`  - PYROPE_RPC: ${pyro}`);
    if(world) lines.push(`  - WORLD_ADDRESS: ${world}`);
    if(deploy) lines.push(`  - DEPLOY_BLOCK: ${deploy}`);
    if(confirm) lines.push(`  - CONFIRM_DEPTH: ${confirm}`);
    if(worldApiBase){
      lines.push('- World API');
      lines.push(`  - Base: ${worldApiBase}`);
    }
    if(endpoints.length){
      lines.push('- API endpoints (Worker)');
      for(const ep of endpoints){ lines.push(`  - ${ep}`); }
    }
    if(cacheControls.length){
      lines.push('- Caching (selected Cache-Control values)');
      for(const c of cacheControls){ lines.push(`  - ${c}`); }
    }
    if(diagHeaders.length){
      lines.push('- Diagnostic headers');
      for(const h of diagHeaders){ lines.push(`  - ${h}`); }
    }
    lines.push('- Data flow');
    lines.push('  - Primordium pg-indexer → Postgres (local) → Grafana');
    lines.push("  - Node snapshot exporter → `EF_SNAPSHOTS` (keys: `smart_gate_links_v1`, `system_overlays_v1`)");
    lines.push('  - Frontend reads snapshots via Worker; usage metrics write to `EF_STATS`.');
    lines.push('- Observability');
    lines.push('  - Grafana (local): http://localhost:3000 (datasource: `ef-postgres`) – tiles: chain head vs processed head vs lag; World API counts; last loads.');
    lines.push('- Preview URLs');
    lines.push('  - Pattern: `https://<branch-or-alias>.ef-map.pages.dev` (project `ef-map`).');
    lines.push('');
    return lines.join('\n');
  }

  const quickRefBlock = buildQuickRef();

  const mainBody = [
    bannerMain,
    quickRefBlock,
    // Intentionally skip existing preamble to avoid duplicating banners or older quick refs
    joinSections(keepFiltered, true),
  ].filter(Boolean).join('\n');

  const archiveBody = [
    bannerArchive,
    // Do NOT compact the archive; preserve full detail for historical record
    joinSections(archive, false),
  ].join('\n');

  const mainCondensed = condenseWhitespace(mainBody);
  const archiveCondensed = condenseWhitespace(archiveBody);

  // Only write a new archive file if we actually archived sections this run
  let archiveFileWritten = null;
  if(archive.length > 0){
    writeFileSafe(ARCHIVE_FILE_TODAY, archiveCondensed);
    archiveFileWritten = ARCHIVE_FILE_TODAY;
  }
  writeFileSafe(DECISION_LOG, mainCondensed);

  // Summary output
  const keptCount = keep.length + (preamble ? 1 : 0);
  const archivedCount = archive.length;
  console.log(JSON.stringify({
    status: 'ok',
    keptSections: keptCount,
    archivedSections: archivedCount,
    mainLines: mainCondensed.split(/\r?\n/).length,
    archiveLines: archiveCondensed.split(/\r?\n/).length,
    archiveFile: archiveFileWritten ? path.relative(ROOT, archiveFileWritten) : (latestArchiveRelPath() || null),
    compact: COMPACT,
  }, null, 2));
}

run();
