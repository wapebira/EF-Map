#!/usr/bin/env node
// Local indexer status server (clean ES5-safe HTML/JS)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.STATUS_PORT || 8731);
function saneEnvPath(v, fallback){
  if (v === undefined || v === null) return fallback;
  var s = String(v).trim();
  if (!s || /^true$/i.test(s)) return fallback;
  return s;
}
const STATUS_PATH = saneEnvPath(process.env.STATUS_PATH, path.resolve(__dirname, '../../data/local-indexer-status.json'));
// Phase 0: decode status split for atomicity
const DECODE_STATUS_PATH = saneEnvPath(process.env.DECODE_STATUS_PATH, path.resolve(__dirname, '../../data/local-indexer-decode-status.json'));
const HISTORY_PATH = saneEnvPath(process.env.HISTORY_PATH, path.resolve(__dirname, '../../data/local-indexer-status-history.json'));
const CONTROL_PATH = saneEnvPath(process.env.CONTROL_PATH, path.resolve(__dirname, '../../data/local-indexer-control.json'));
const PID_PATH = saneEnvPath(process.env.PID_PATH, path.resolve(__dirname, '../../data/local-indexer-ingest.pid'));
const DB_PATH = saneEnvPath(process.env.LOCAL_DB_PATH, path.resolve(__dirname, '../../data/local-indexer.db'));
const LOG_OUT_PATH = saneEnvPath(process.env.LOG_OUT_PATH, path.resolve(__dirname, '../../scratch/ingest.out.log'));
const LOG_ERR_PATH = saneEnvPath(process.env.LOG_ERR_PATH, path.resolve(__dirname, '../../scratch/ingest.err.log'));
const ROOT_DIR = path.resolve(__dirname, '../../');
const STATUS_SRV_LOG = path.resolve(ROOT_DIR, 'scratch/status_server.out.log');
const STATUS_SRV_ERR = path.resolve(ROOT_DIR, 'scratch/status_server.err.log');

// Ensure scratch dir exists for logs
try { fs.mkdirSync(path.resolve(ROOT_DIR, 'scratch'), { recursive: true }); } catch (e) {}

function srvLog(msg){ try { fs.appendFileSync(STATUS_SRV_LOG, new Date().toISOString()+" "+String(msg)+"\n"); } catch(e){} }
function srvErr(msg){ try { fs.appendFileSync(STATUS_SRV_ERR, new Date().toISOString()+" "+String(msg)+"\n"); } catch(e){} }

function readJsonFile(p, fallback){
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function readTextFile(p, fallback){
  try { return fs.readFileSync(p, 'utf8'); } catch { return fallback; }
}
function readStatus(){
  var base = readJsonFile(STATUS_PATH, { status: 'idle', updatedAt: null }) || {};
  try {
    // Keep a simple last-good decode in module scope
    if (!global.__lastDecode) global.__lastDecode = null;
    var dec = readJsonFile(DECODE_STATUS_PATH, null);
    if (dec && typeof dec === 'object') { base.decode = dec; global.__lastDecode = dec; }
    else if (global.__lastDecode) { base.decode = global.__lastDecode; }
  } catch(e){}
  return base;
}
function readHistory(){ var arr = readJsonFile(HISTORY_PATH, []); return Array.isArray(arr) ? arr : []; }
function readControl(){ return readJsonFile(CONTROL_PATH, null); }
function readPid(){ return readTextFile(PID_PATH, null); }
function isPidAlive(pid){
  try {
    if (!pid) return false;
    process.kill(Number(pid), 0); // throws if not alive or not permitted
    return true;
  } catch { return false; }
}

function miniSpark(values){
  if (!values || !values.length) return '(no data)';
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (min === max) return new Array(Math.min(values.length, 80)+1).join('▁');
  var chars = '▁▂▃▄▅▆▇█';
  return values.slice(-120).map(function(v){
    var n = (v - min) / (max - min);
    var idx = Math.min(chars.length-1, Math.max(0, Math.floor(n * (chars.length))));
    return chars[idx];
  }).join('');
}

function calcRates(hist){
  if (!hist || hist.length < 3) return null;
  var recent = hist.slice(Math.max(0, hist.length-60));
  var first = recent[0], last = recent[recent.length-1];
  var dt = (new Date(last.t) - new Date(first.t))/1000;
  if (dt <= 0) return null;
  var dBlocks = (last.block - first.block);
  var dRows = (last.rows - first.rows);
  return { blocksPerHour: (dBlocks/dt)*3600, rowsPerSec: dRows/dt };
}

function calcEta(remainingBlocks, blocksPerHour){
  if (!blocksPerHour || blocksPerHour <= 0) return null;
  var hours = remainingBlocks / blocksPerHour; if (!isFinite(hours)) return null;
  return hours < 1 ? Math.round(hours*60) + ' min' : hours.toFixed(1) + ' hr';
}

function html(status){
  var hist = readHistory();
  var rate = calcRates(hist) || {};
  var dbMB = status.dbSizeBytes ? (status.dbSizeBytes/1024/1024).toFixed(1)+' MB' : '-';
  var blocksPerHour = (rate.blocksPerHour!=null) ? rate.blocksPerHour.toFixed(0) : '-';
  var rowsPerSec = (rate.rowsPerSec!=null) ? rate.rowsPerSec.toFixed(1) : '-';
  var spark = miniSpark(hist.map(function(h){ return h.block; }));
  var eta = (status && status.safeHead!=null && status.cursor && status.cursor.last_block_number!=null)
    ? calcEta(status.safeHead - (status.cursor.last_block_number||0), rate.blocksPerHour)
    : null;
  var pid = readPid() || '-';
  return `<!doctype html>
  <meta charset="utf-8" />
  <title>Local Indexer Status</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b0f17;color:#e2e8f0;margin:0;padding:24px}
    .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;max-width:1400px;width:calc(100vw - 64px);margin:0 auto}
    h1{margin:0 0 8px 0;font-size:22px}
    .grid{display:grid;grid-template-columns:repeat(4, 1fr);gap:10px}
    .muted{color:#9ca3af;font-size:12px}
    code{background:#0b1220;padding:2px 6px;border-radius:6px}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    button{background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:6px 10px;cursor:pointer}
    button:hover{background:#243041}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #374151;background:#0b1220}
    .pill.ok{border-color:#065f46;color:#34d399}
  /* Animated pulse to make LIVE state obvious */
  .pill.ok::before{content:"";display:inline-block;width:6px;height:6px;background:#34d399;border-radius:50%;margin-right:6px;box-shadow:0 0 0 0 rgba(52,211,153,0.7);animation:pulse 1.5s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,0.7)}70%{box-shadow:0 0 0 8px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
    .pill.warn{border-color:#7c2d12;color:#f59e0b}
    .banner{margin:8px 0;padding:10px 12px;border-radius:10px;font-weight:600;font-size:18px}
    .banner.ok{background:rgba(22,163,74,0.15);border:1px solid rgba(22,163,74,0.45)}
    .banner.warn{background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.45)}
    .banner.err{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.45)}
  .section{margin-top:16px}
    .logs{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .logpane{background:#0b1220;border-radius:8px;padding:8px;overflow:auto;white-space:pre-wrap;height:220px}
    canvas{display:block;width:100%;height:180px;background:#0b1220;border-radius:8px}
  .diag{margin-top:6px;color:#cbd5e1;font-size:12px}
  /* Progress bar */
  .progress{background:#0b1220;border:1px solid #1f2937;border-radius:8px;height:44px;position:relative;overflow:hidden;margin-top:8px}
  .progress .fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2563eb,#22d3ee);opacity:0.9}
  .progress .label{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px;color:#e5e7eb}
  .progress .pct{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-weight:600}
  </style>
  <div class="card">
  <h1>Local Indexer <span id="livePill" class="pill">-</span> <span id="ssePill" class="pill">SSE: off</span> <span class="muted" style="margin-left:8px">v:${Date.now()}</span></h1>
  <div id="bigStatus" class="banner warn">Starting…</div>
    <div class="muted">Updated: <span id="updatedAt">${status.updatedAt||'-'}</span></div>
  <div id="diag" class="diag">diag: -</div>
    <div class="grid" style="margin-top:12px">
      <div><b>Status</b><div id="state">${(status.state||status.status)||'-'}</div></div>
      <div><b>Seg last</b><div id="seg">${status.segment? (String(status.segment.from)+' -> '+String(status.segment.to)+' ('+String(status.segment.rows)+' rows)'):'-'}</div></div>
      <div><b>Cursor</b><div id="cursor">${status.cursor? (String(status.cursor.last_block_number)+':'+String(status.cursor.last_log_index)):'-'}</div></div>
      <div><b>Head (safe)</b><div id="safeHead">${(status.safeHead!=null)?String(status.safeHead):'-'}</div></div>
      <div><b>Head (tip)</b><div id="head">${(status.head!=null)?String(status.head):'-'}</div></div>
      <div><b>Total rows</b><div id="rows">${(status.counts && status.counts.raw_logs!=null)?String(status.counts.raw_logs):'-'}</div></div>
      <div><b>Blocks</b><div id="blocks">${status.blocks? (String(status.blocks.min)+' -> '+String(status.blocks.max)):'-'}</div></div>
      <div><b>DB size</b><div id="dbSize">${dbMB}</div></div>
      <div><b>Δ rows (last)</b><div id="rowsDelta">-</div></div>
      <div><b>Rate</b><div id="rate">${blocksPerHour} blocks/hr | ${rowsPerSec} rows/s</div></div>
      <div><b>ETA</b><div id="eta">${eta || '-'}</div></div>
      <div><b>Engine</b><div id="engine">${status.engine||'-'}</div></div>
    </div>
    <div class="row" style="margin-top:16px; gap:16px; align-items:center">
      <form id="ctrl" class="row">
        <button data-action="pause" type="button">Pause</button>
        <button data-action="resume" type="button">Resume</button>
        <button data-action="stop" type="button">Stop</button>
      </form>
      <div class="row" style="gap:8px">
        <button id="btnStart" type="button">Start Ingest</button>
        <button id="btnKill" type="button">Kill Ingest</button>
      </div>
      <span class="muted">PID: <span id="pid">${pid}</span></span>
    </div>
    <div class="row" style="margin-top:12px">
      <div><b>RPC</b></div>
      <code id="rpc">${status.rpc||'-'}</code>
    </div>
    <div class="row" style="margin-top:8px">
      <div><b>DB file</b></div>
      <code id="dbPath">${DB_PATH}</code>
    </div>
    <div class="row" style="margin-top:8px; gap:16px">
      <div><b>Proc</b></div>
      <div class="muted">CPU: <span id="cpu">-</span> · Mem: <span id="mem">-</span></div>
      <div class="muted">Last fetch: <span id="lastFetch">-</span></div>
    </div>
    <div class="row" style="margin-top:16px;align-items:center;gap:10px">
      <div class="muted">Sync progress</div>
      <div id="progressInfo" class="muted">-</div>
    </div>
    <div id="progress" class="progress" aria-label="sync progress">
      <div class="fill" id="progressFill"></div>
      <div class="label" id="progressLabel"></div>
      <div class="pct" id="progressPct">0%</div>
    </div>
    <div class="row" style="margin-top:16px;align-items:center;gap:10px">
      <div class="muted">Decode progress</div>
      <div id="decodeInfo" class="muted">-</div>
    </div>
    <div id="decodeProgress" class="progress" aria-label="decode progress">
      <div class="fill" id="decodeProgressFill"></div>
      <div class="label" id="decodeProgressLabel"></div>
      <div class="pct" id="decodeProgressPct">0%</div>
    </div>
    <div style="margin-top:16px" class="muted">Progress (last ~400 samples)</div>
    <canvas id="chart" width="1200" height="180"></canvas>
    <pre id="spark" style="background:#0b1220;border-radius:8px;padding:8px;overflow:auto;margin-top:6px">${spark}</pre>
    <div style="margin-top:16px"><b>Recent activity</b></div>
    <pre id="recent" style="background:#0b1220;border-radius:8px;padding:8px;overflow:auto;white-space:pre-wrap">(loading)</pre>
    <div class="section">
      <div class="muted">Rolling logs</div>
      <div class="logs">
        <div>
          <div class="muted">Out</div>
          <pre id="logOut" class="logpane"></pre>
        </div>
        <div>
          <div class="muted">Err</div>
          <pre id="logErr" class="logpane"></pre>
        </div>
      </div>
  <div style="margin-top:10px" class="muted">Client diagnostics</div>
  <pre id="clientDiag" class="logpane" style="height:120px"></pre>
    </div>
  </div>
  <script>
  (function(){
    function $$(id){ return document.getElementById(id); }
  // Safe text setter to avoid null element exceptions halting the refresh loop
  function setText(id, v){ try { var el=$$(id); if (el) el.textContent = v; } catch(_){} }
    function val(x, fb){ return (x===undefined||x===null)? fb : x; }
    // Minimal polyfills for older browsers
    if (!window.URLSearchParams){
      window.URLSearchParams = function(obj){ this._ = obj||{}; this.toString = function(){ var p=[]; for (var k in this._){ if (!Object.prototype.hasOwnProperty.call(this._,k)) continue; p.push(encodeURIComponent(k)+'='+encodeURIComponent(this._[k])); } return p.join('&'); }; };
    }
    function urlWithTs(u){ try { var sep = (u.indexOf('?')>=0)? '&' : '?'; return u + sep + '_ts=' + Date.now(); } catch(_){ return u; } }
    function xhrJson(url){ url=urlWithTs(url); return new Promise(function(res, rej){ try{ var x=new XMLHttpRequest(); x.open('GET', url, true); x.setRequestHeader('Cache-Control','no-store'); x.setRequestHeader('Pragma','no-cache'); x.onreadystatechange=function(){ if (x.readyState===4){ try{ res(JSON.parse(x.responseText||'{}')); } catch(e){ rej(e); } } }; x.onerror=rej; x.send(); }catch(e){ rej(e); } }); }
    function xhrText(url){ url=urlWithTs(url); return new Promise(function(res, rej){ try{ var x=new XMLHttpRequest(); x.open('GET', url, true); x.setRequestHeader('Cache-Control','no-store'); x.setRequestHeader('Pragma','no-cache'); x.onreadystatechange=function(){ if (x.readyState===4){ res(x.responseText||''); } }; x.onerror=rej; x.send(); }catch(e){ rej(e); } }); }
  function fetchJson(url){ url=urlWithTs(url); if (window.fetch){ return fetch(url, { cache:'no-store' }).then(function(r){ return r.json(); }); } return xhrJson(url); }
  function fetchText(url){ url=urlWithTs(url); if (window.fetch){ return fetch(url, { cache:'no-store' }).then(function(r){ return r.text(); }); } return xhrText(url); }
    function fmtMB(bytes){ if (bytes===undefined||bytes===null) return '-'; return (bytes/1024/1024).toFixed(1)+' MB'; }
    function spark(values){
      if (!values || !values.length) return '(no data)';
      var min = Math.min.apply(null, values); var max = Math.max.apply(null, values);
      if (min === max) return new Array(Math.min(values.length,80)+1).join('▁');
      var chars = '▁▂▃▄▅▆▇█';
      return values.slice(-120).map(function(v){
        var n = (v-min)/(max-min); var idx = Math.min(chars.length-1, Math.max(0, Math.floor(n*chars.length)));
        return chars[idx];
      }).join('');
    }
    function calcRates(hist){
      if (!hist || hist.length < 3) return null;
      var recent = hist.slice(Math.max(0, hist.length-60));
      var first = recent[0], last = recent[recent.length-1];
      var dt = (new Date(last.t) - new Date(first.t))/1000; if (dt <= 0) return null;
      var db = (last.block-first.block); if (db < 0) db = 0;
      var dr = (last.rows-first.rows); if (dr < 0) dr = 0;
      return { blocksPerHour: (db/dt)*3600, rowsPerSec: dr/dt };
    }
    function calcEta(remainingBlocks, bph){ if (!bph || bph<=0) return null; var h=remainingBlocks/bph; return !isFinite(h)?null:(h<1?Math.round(h*60)+' min':h.toFixed(1)+' hr'); }
  var lastPct = null; var sseConnected = false; var diagBuf=[];
  var lastDecodePct = null;
    function setProgress(s){
      try{
  var el=$$('#progress'); if(!el) return; var fill=$$('#progressFill'); var pctEl=$$('#progressPct'); var label=$$('#progressLabel'); var info=$$('#progressInfo');
        var cur = s && s.cursor && s.cursor.last_block_number!=null ? Number(s.cursor.last_block_number) : null;
        var safe = s && s.safeHead!=null ? Number(s.safeHead) : null;
        if (cur==null || safe==null || !(isFinite(cur)&&isFinite(safe))){
          if (fill) fill.style.width='0%'; if (pctEl) pctEl.textContent='-'; if (label) label.textContent='-'; if(info) info.textContent='-';
          lastPct = null; updateDiag(s, null);
          return;
        }
        var pct = Math.max(0, Math.min(100, (Math.max(0, Math.min(cur, safe)) / Math.max(1, safe)) * 100 ));
        if (fill) fill.style.width = pct.toFixed(1)+'%';
        if (pctEl) pctEl.textContent = pct.toFixed(1)+'%';
        if (label) label.textContent = 'cursor '+cur+' / safe '+safe;
  if (info) info.textContent = 'Blocks '+cur+' -> '+safe+' (remaining '+Math.max(0,safe-cur)+')';
        lastPct = pct;
        updateDiag(s, pct);
      }catch(_){ }
    }
    function setDecodeProgress(s){
      try{
        var el=$$('#decodeProgress'); if(!el) return; var fill=$$('#decodeProgressFill'); var pctEl=$$('#decodeProgressPct'); var label=$$('#decodeProgressLabel'); var info=$$('#decodeInfo');
        var d = s && s.decode ? s.decode : null;
        if (!d || d.total==null || d.done==null || d.total<=0){
          if (fill) fill.style.width='0%'; if (pctEl) pctEl.textContent='-'; if (label) label.textContent='-'; if(info) info.textContent='-';
          lastDecodePct = null; return;
        }
        var pct = Math.max(0, Math.min(100, (Math.max(0, Math.min(d.done, d.total)) / Math.max(1, d.total)) * 100 ));
        if (fill) fill.style.width = pct.toFixed(1)+'%';
        if (pctEl) pctEl.textContent = pct.toFixed(1)+'%';
        var rps = (d.rps!=null)? (d.rps + ' rows/s') : '-';
        var eta = (d.etaMs!=null)? (d.etaMs<60000 ? Math.round(d.etaMs/1000)+' s' : (d.etaMs/3600000).toFixed(2)+' hr') : '-';
        if (label) label.textContent = 'rows '+(d.done||0)+' / '+(d.total||0)+'  |  unknown '+(d.unknown||0);
        if (info) info.textContent = 'State: '+(d.state||'-')+'  ·  Rate: '+rps+'  ·  ETA: '+eta;
        lastDecodePct = pct;
      }catch(_){ }
    }
    function updateDiag(s, pct){
      try{
        var el=$$('#diag'); if(!el) return;
        var cur = s && s.cursor && s.cursor.last_block_number!=null ? Number(s.cursor.last_block_number) : null;
        var safe = s && s.safeHead!=null ? Number(s.safeHead) : null;
        var st = (s && (s.state||s.status)) || '-';
        el.textContent = 'diag: state='+st+' cur='+cur+' safe='+safe+' pct='+(pct==null?'-':pct.toFixed(1))+' sse='+(sseConnected?'on':'off');
      }catch(_){ }
    }
    function pushClientDiag(msg){
      try{
        var el=$$('#clientDiag'); if(!el) return; var ts=new Date().toLocaleTimeString();
        diagBuf.push('['+ts+'] '+msg); if (diagBuf.length>50) diagBuf.shift();
  el.textContent = diagBuf.join('\\n'); el.scrollTop = el.scrollHeight;
      }catch(_){ }
    }
    function setLivePill(dateStr){
      var el = $$('#livePill'); if (!el) return;
      var state='STALE', cls='pill warn';
      // Consider both updatedAt and recent fetch pulse
      var liveByUpdatedAt = false; var liveByPulse = false;
      if (dateStr){ var dt = new Date(dateStr).getTime(); var age = Date.now()-dt; if (isFinite(age) && age<15000){ liveByUpdatedAt = true; } }
      if ((Date.now() - lastUiTick) < 5000) liveByPulse = true;
      if (liveByUpdatedAt || liveByPulse){ state='LIVE'; cls='pill ok'; }
      el.className = cls; el.textContent = state;
    }
    function setBanner(state, statusObj){
      var el=$$('#bigStatus'); if(!el) return; var s=(state||'').toLowerCase();
      // Heuristic: if cursor < safeHead, consider running even if state is blank
      try{
        if ((!s || s==='starting' || s==='idle') && statusObj && statusObj.cursor && statusObj.safeHead!=null){
          var cur = Number(statusObj.cursor.last_block_number||0); var safe = Number(statusObj.safeHead||0);
          if (isFinite(cur) && isFinite(safe) && cur < safe) s = 'running';
        }
      }catch(_){ }
      var text=''; var cls='banner warn';
      if(s==='paused'){ text='PAUSED'; cls='banner warn'; }
      else if(s==='ingest' || s==='running'){ text='RUNNING'; cls='banner ok'; }
      else if(s==='stopping'){ text='STOPPING'; cls='banner warn'; }
      else if(s==='stopped'){ text='STOPPED'; cls='banner err'; }
      else { text=state||'-'; }
      el.className=cls; el.textContent=text;
    }
    function drawChart(hist){
      try{
        var c=$$('#chart'); if(!c||!c.getContext) return; var ctx=c.getContext('2d'); var w=c.width, h=c.height; ctx.clearRect(0,0,w,h);
        if(!hist||hist.length<2){ ctx.fillStyle='#9ca3af'; ctx.fillText('No data', 10, 20); return; }
        var recent=hist.slice(Math.max(0,hist.length-400));
        var ys=recent.map(function(x){return x.rows;});
        var min=Math.min.apply(null,ys), max=Math.max.apply(null,ys); if(min===max){min=0;}
        var xs=recent.map(function(_,i){return i/(recent.length-1||1)});
        // grid
        ctx.strokeStyle='#1f2937'; ctx.lineWidth=1; for(var i=0;i<6;i++){ var gy=h*(i/5); ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(w,gy); ctx.stroke(); }
        // line
        ctx.strokeStyle='#60a5fa'; ctx.lineWidth=2; ctx.beginPath();
        for(var i=0;i<recent.length;i++){
          var x=xs[i]*w; var y=h-( (ys[i]-min)/Math.max(1,(max-min)) )*h; if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }catch(_){/* noop */}
    }
  var lastUiTick = Date.now();
  function updateUI(){
      if (!$$('updatedAt')) return; // DOM not ready
      var lastStatus = null;
      // Always attempt each step; do not let one failure stop the rest
      fetchJson('/api/status')
        .then(function(s){
          lastStatus = s || {};
          setText('updatedAt', val(s.updatedAt, '-'));
          setLivePill(s.updatedAt);
          setText('state', val(s.state || s.status, '-'));
          setBanner(s.state||s.status, s);
          setText('seg', s.segment ? (String(s.segment.from)+' -> '+String(s.segment.to)+' ('+String(s.segment.rows)+' rows)') : '-');
          setText('cursor', s.cursor ? (String(s.cursor.last_block_number)+':'+String(s.cursor.last_log_index)) : '-');
          setText('safeHead', (s.safeHead!==undefined && s.safeHead!==null) ? String(s.safeHead) : '-');
          setText('head', (s.head!==undefined && s.head!==null) ? String(s.head) : '-');
          setText('rows', (s.counts && s.counts.raw_logs!==undefined) ? String(s.counts.raw_logs) : '-');
          setText('blocks', s.blocks ? (String(s.blocks.min)+' -> '+String(s.blocks.max)) : '-');
          setText('dbSize', fmtMB(s.dbSizeBytes));
          setText('engine', s.engine || '-');
          setText('rpc', s.rpc || '-');
          setText('lastFetch', new Date().toLocaleTimeString());
          lastUiTick = Date.now();
          setLivePill(new Date().toISOString());
          setProgress(s);
          setDecodeProgress(s);
        })
        .catch(function(){ /* keep going */ })
        .finally(function(){
          // History & derived metrics
          fetchJson('/api/history')
            .then(function(h){
              setText('spark', spark(h.map(function(x){return x.block;})));
              drawChart(h);
              if (h && h.length){
                var lastN = h.slice(Math.max(0, h.length-10));
                var lines = lastN.map(function(x){ var t = new Date(x.t).toLocaleTimeString(); return (t+'  block='+x.block+'  rows='+x.rows+'  db='+fmtMB(x.db)); }).join('\\n');
                setText('recent', lines);
              } else {
                setText('recent', '(no recent samples)');
              }
              if (h && h.length>=2){ var last=h[h.length-1], prev=h[h.length-2]; var dRows=(last.rows-prev.rows); if (dRows<0) dRows=0; setText('rowsDelta', isFinite(dRows)? String(dRows) : '-'); }
              var r = calcRates(h)||{}; var bph = (r.blocksPerHour!=null)? r.blocksPerHour.toFixed(0) : '-'; var rps = (r.rowsPerSec!=null)? r.rowsPerSec.toFixed(1) : '-';
              setText('rate', (bph+' blocks/hr | '+rps+' rows/s'));
              // ETA uses cached status when available to avoid a second fetch dependency
              var e = (r && lastStatus && lastStatus.safeHead!=null && lastStatus.cursor && lastStatus.cursor.last_block_number!=null)
                ? calcEta(lastStatus.safeHead-(lastStatus.cursor.last_block_number||0), r.blocksPerHour)
                : null;
              setText('eta', e || '-');
              if (lastStatus) setProgress(lastStatus);
            })
            .catch(function(){ /* ignore but do not break loop */ });
          // Proc stats (best-effort)
          fetchJson('/api/proc-stats')
            .then(function(p){
              if (p && p.pid){ setText('pid', String(p.pid)); setText('cpu', (p.cpu!=null? String(p.cpu.toFixed? p.cpu.toFixed(1): p.cpu): '-') + ' s'); setText('mem', (p.memMB!=null? String(p.memMB.toFixed? p.memMB.toFixed(1): p.memMB): '-') + ' MB'); }
              else { setText('cpu','-'); setText('mem','-'); }
            })
            .catch(function(){ setText('cpu','-'); setText('mem','-'); });
        });
    }
    // Live updates via SSE when available, with polling fallback
    function setupSSE(){
      if (!('EventSource' in window)) return false;
      try {
  var es = new EventSource('/api/stream?_ts=' + Date.now());
        var bump = function(){ $$('#lastFetch').textContent = new Date().toLocaleTimeString(); };
  es.addEventListener('open', function(){ sseConnected = true; var sp=$$('#ssePill'); if(sp){ sp.className='pill ok'; sp.textContent='SSE: on'; } updateDiag(null, lastPct); });
  es.addEventListener('error', function(){ sseConnected = false; var sp=$$('#ssePill'); if(sp){ sp.className='pill warn'; sp.textContent='SSE: off'; } updateDiag(null, lastPct); /* browser will retry */ });
        es.addEventListener('status', function(ev){ try{ var s = JSON.parse(ev.data||'{}');
            $$('#updatedAt').textContent = val(s.updatedAt, '-');
            setLivePill(s.updatedAt);
            $$('#state').textContent = val(s.state || s.status, '-');
            setBanner(s.state||s.status, s);
            $$('#seg').textContent = s.segment ? (String(s.segment.from)+' -> '+String(s.segment.to)+' ('+String(s.segment.rows)+' rows)') : '-';
            $$('#cursor').textContent = s.cursor ? (String(s.cursor.last_block_number)+':'+String(s.cursor.last_log_index)) : '-';
            $$('#safeHead').textContent = (s.safeHead!==undefined && s.safeHead!==null) ? String(s.safeHead) : '-';
            $$('#head').textContent = (s.head!==undefined && s.head!==null) ? String(s.head) : '-';
            $$('#rows').textContent = (s.counts && s.counts.raw_logs!==undefined) ? String(s.counts.raw_logs) : '-';
            $$('#blocks').textContent = s.blocks ? (String(s.blocks.min)+' -> '+String(s.blocks.max)) : '-';
            $$('#dbSize').textContent = fmtMB(s.dbSizeBytes);
            $$('#rpc').textContent = s.rpc || '-';
            $$('#engine').textContent = s.engine || '-';
            bump();
            lastUiTick = Date.now();
            setLivePill(new Date().toISOString());
            setProgress(s);
            setDecodeProgress(s);
          }catch(e){} }
        );
        es.addEventListener('history', function(ev){ try{ var h = JSON.parse(ev.data||'[]');
            $$('#spark').textContent = spark(h.map(function(x){return x.block;}));
            drawChart(h);
            if (h && h.length){
              var lastN = h.slice(Math.max(0, h.length-10));
              var lines = lastN.map(function(x){ var t = new Date(x.t).toLocaleTimeString(); return (t+'  block='+x.block+'  rows='+x.rows+'  db='+fmtMB(x.db)); }).join('\\n');
              $$('#recent').textContent = lines;
              if (h.length>=2){ var last=h[h.length-1], prev=h[h.length-2]; var dRows=(last.rows-prev.rows); if (dRows<0) dRows=0; $$('#rowsDelta').textContent = isFinite(dRows)? String(dRows) : '-'; }
              var r = calcRates(h)||{}; var bph = (r.blocksPerHour!=null)? r.blocksPerHour.toFixed(0) : '-'; var rps = (r.rowsPerSec!=null)? r.rowsPerSec.toFixed(1) : '-';
              $$('#rate').textContent = (bph+' blocks/hr | '+rps+' rows/s');
              fetchJson('/api/status').then(function(s2){ var e = (r && s2 && s2.safeHead!=null && s2.cursor && s2.cursor.last_block_number!=null) ? calcEta(s2.safeHead-(s2.cursor.last_block_number||0), r.blocksPerHour) : null; $$('#eta').textContent = e || '-'; });
            }
          }catch(e){} }
        );
        return true;
      } catch (e) { return false; }
    }
  var hasSSE = setupSSE();
  // Keep a 1s polling loop so the UI always moves
  setInterval(updateUI, 1000); updateUI();
  // Watchdog: if UI hasn't updated in 60s, reload the page (recovers from rare cache/SSE stalls)
  setInterval(function(){ try { var age = Date.now()-lastUiTick; if (age > 60000) location.reload(); } catch(e){} }, 5000);
    // Client error capture
    try{
      window.addEventListener('error', function(ev){ pushClientDiag('error: '+(ev.message||'')+' @ '+(ev.filename||'')+':'+(ev.lineno||'')); });
      window.addEventListener('unhandledrejection', function(ev){ pushClientDiag('unhandledrejection: '+(ev.reason && (ev.reason.stack||ev.reason.message||ev.reason) || 'unknown')); });
    }catch(_){ }
    document.getElementById('ctrl').addEventListener('click', function(ev){
      var btn = ev.target && ev.target.closest ? ev.target.closest('button') : ev.target; if (!btn || !btn.getAttribute) return;
      var action = btn.getAttribute('data-action');
      fetch('/api/control', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({ action: action }) }).then(function(){ setTimeout(updateUI, 300); });
    });
    document.getElementById('btnStart').addEventListener('click', function(){ fetch('/api/start-ingest', { method:'POST' }).then(function(){ setTimeout(updateUI, 800); }); });
    document.getElementById('btnKill').addEventListener('click', function(){ fetch('/api/kill-ingest', { method:'POST' }).then(function(){ setTimeout(updateUI, 300); }); });
    function refreshLogs(){
      var elOut = $$('#logOut');
      var elErr = $$('#logErr');
      if (elOut) {
        fetchText('/api/logs?type=out&n=250').then(function(t){ elOut.textContent = t && t.trim().length ? t : '(no logs yet)'; }).catch(function(){ elOut.textContent = '(no data)'; });
      }
      if (elErr) {
        fetchText('/api/logs?type=err&n=250').then(function(t){ elErr.textContent = t && t.trim().length ? t : '(no logs yet)'; }).catch(function(){ elErr.textContent = '(no data)'; });
      }
    }
    refreshLogs(); setInterval(refreshLogs, 3000);
  })();
  </script>`;
}

const server = http.createServer(function(req,res){
  try {
    var url = new URL(req.url, 'http://localhost');
    var pathname = url.pathname;

    if (req.method === 'POST' && pathname === '/api/control'){
      var body='';
      req.on('data', function(chunk){ body += chunk.toString(); });
      req.on('end', function(){
        var params = new URLSearchParams(body);
        var action = params.get('action');
        var ctrl = readControl() || {};
        if (action === 'pause') ctrl.paused = true;
        if (action === 'resume') ctrl.paused = false;
        if (action === 'stop') ctrl.stop = true;
        fs.writeFileSync(CONTROL_PATH, JSON.stringify(ctrl));
        res.writeHead(303, { Location: '/' }); res.end();
      });
      return;
    }

    if (pathname === '/api/status'){
      var s = readStatus();
      try { s.__hb = Date.now(); } catch (e) {}
      res.writeHead(200, {
        'content-type':'application/json',
        'access-control-allow-origin':'*',
        'cache-control':'no-store, no-cache, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0'
      });
      res.end(JSON.stringify(s));
      return;
    }
    if (pathname === '/api/health'){
      res.writeHead(200, {
        'content-type':'application/json',
        'cache-control':'no-store, no-cache, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0'
      });
      res.end(JSON.stringify({ now: new Date().toISOString(), pid: process.pid, ok: true }));
      return;
    }
    if (pathname === '/api/history'){
      var h = readHistory();
      res.writeHead(200, {
        'content-type':'application/json',
        'access-control-allow-origin':'*',
        'cache-control':'no-store, no-cache, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0'
      });
      res.end(JSON.stringify(h));
      return;
    }
    if (pathname === '/favicon.ico'){
      res.writeHead(204, { 'cache-control':'no-store' });
      return res.end();
    }
    if (pathname === '/api/logs'){
      var type = url.searchParams.get('type') || 'out';
      var n = Number(url.searchParams.get('n') || '100');
      // Try primary then alternates
      var candidates = [];
      if (type === 'err') {
        candidates = [LOG_ERR_PATH, path.resolve(ROOT_DIR,'data/ingest_raw.err.log'), path.resolve(ROOT_DIR,'data/ingest.err.log')];
      } else {
        candidates = [LOG_OUT_PATH, path.resolve(ROOT_DIR,'data/ingest_raw.out.log'), path.resolve(ROOT_DIR,'data/ingest.out.log')];
      }
      res.writeHead(200, {
        'content-type':'text/plain; charset=utf-8',
        'cache-control':'no-store, no-cache, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0'
      });
      (async function(){
        for (var i=0;i<candidates.length;i++){
          try {
            var p = candidates[i];
            if (fs.existsSync(p)){
              var txt = await tailFile(p, n);
              if (txt && txt.trim().length){ res.end(txt); return; }
            }
          } catch(e){}
        }
        res.end('');
      })();
      return;
    }
    if (pathname === '/api/start-ingest'){
      // Prefer direct spawn (detached) so it survives VS Code/terminal exits; fall back to PowerShell script
      const already = readPid();
      if (isPidAlive(Number(already))) {
        res.writeHead(200, { 'content-type':'application/json' });
        res.end(JSON.stringify({ started:false, reason:'already_running', pid:Number(already) }));
        return;
      }
      const ok = startIngestDetached();
      if (!ok) {
        runPs(path.join(ROOT_DIR, 'tools/local-indexer/start_ingest.ps1'));
      }
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ started: !!ok, fallback: !ok }));
      return;
    }
    if (pathname === '/api/kill-ingest'){
      runPs(path.join(ROOT_DIR, 'tools/local-indexer/kill_ingest.ps1'));
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ killing: true }));
      return;
    }
    if (pathname === '/api/proc-stats'){
      var pidTxt = readPid();
      if (!pidTxt) { res.writeHead(200, { 'content-type':'application/json' }); res.end(JSON.stringify({ pid:null })); return; }
      var pid = parseInt(pidTxt,10);
      getProcStats(pid).then(function(info){
        res.writeHead(200, {
          'content-type':'application/json',
          'cache-control':'no-store, no-cache, must-revalidate',
          'pragma': 'no-cache',
          'expires': '0'
        });
        res.end(JSON.stringify({ pid: pid, cpu: info.cpu, memMB: info.memMB }));
      }).catch(function(){ res.writeHead(200, { 'content-type':'application/json' }); res.end(JSON.stringify({ pid: pid })); });
      return;
    }
  if (pathname === '/api/stream'){
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      // send initial state
  try { res.write('event: status\n'); res.write('data: '+JSON.stringify(readStatus())+'\n\n'); } catch (e) {}
  try { res.write('event: history\n'); res.write('data: '+JSON.stringify(readHistory())+'\n\n'); } catch (e) {}

      const watchers = [];
      try {
        watchers.push(fs.watch(STATUS_PATH, { persistent: false }, function(){ try { res.write('event: status\n'); res.write('data: '+JSON.stringify(readStatus())+'\n\n'); } catch (e) {} }));
      } catch (e) {}
      try {
        watchers.push(fs.watch(HISTORY_PATH, { persistent: false }, function(){ try { res.write('event: history\n'); res.write('data: '+JSON.stringify(readHistory())+'\n\n'); } catch (e) {} }));
      } catch (e) {}
      const heartbeat = setInterval(function(){ try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
      req.on('close', function(){ try { watchers.forEach(function(w){ if (w && w.close) w.close(); }); } catch (e) {} try { clearInterval(heartbeat); } catch (e) {} });
      return;
    }
  if (pathname === '/' || pathname === '/index.html'){
      var s2 = readStatus();
      res.writeHead(200, {
    'content-type':'text/html; charset=utf-8',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
        'cache-control':'no-store, no-cache, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0'
      });
      res.end(html(s2));
      return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (e){
    res.writeHead(500); res.end('error');
  }
});

server.listen(PORT, function(){
  console.log('Local indexer status: http://localhost:'+PORT);
  srvLog('listening on '+PORT+' pid='+process.pid);
});

// Basic hardening/logging
process.on('uncaughtException', function(err){ srvErr('uncaughtException: '+(err && err.stack || err)); });
process.on('unhandledRejection', function(reason){ srvErr('unhandledRejection: '+(reason && reason.stack || reason)); });
try { server.on('error', function(err){ srvErr('server error: '+(err && err.stack || err)); }); } catch(e){}
try { server.keepAliveTimeout = 60000; server.headersTimeout = 65000; } catch(e){}

function runPs(scriptPath){
  try {
    const ps = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', `& '${scriptPath.replace(/'/g, "''")}'`], { stdio: 'ignore', detached: true });
    ps.unref();
  } catch (e) {}
}

function tailFile(file, n){
  return new Promise(function(resolve){
    try {
      if (!fs.existsSync(file)) return resolve('');
      const stat = fs.statSync(file);
      const maxRead = 1024 * 1024; // 1MB
      const start = stat.size > maxRead ? stat.size - maxRead : 0;
      const rs = fs.createReadStream(file, { start, end: stat.size });
      let data='';
      rs.on('data', chunk=> data += chunk.toString('utf8'));
      rs.on('end', ()=>{
        const lines = data.split(/\r?\n/);
        resolve(lines.slice(-n).join('\n'));
      });
      rs.on('error', ()=> resolve(''));
    } catch { resolve(''); }
  });
}

function getProcStats(pid){
  return new Promise(function(resolve, reject){
    const ps = spawn('powershell.exe', ['-NoProfile','-Command', `try { Get-Process -Id ${pid} | Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress } catch { '{}' }`]);
    let out='';
    ps.stdout.on('data', d=> out += d.toString());
    ps.on('close', ()=>{
      try {
        const obj = JSON.parse(out||'{}');
        const ws = obj.WorkingSet64 || obj.workingSet64 || 0;
        const cpu = obj.CPU || obj.cpu || 0;
        resolve({ cpu: Number(cpu)||0, memMB: ws ? (ws/1024/1024) : 0 });
      } catch { reject(new Error('parse')); }
    });
    ps.on('error', ()=> reject(new Error('spawn')));
  });
}

function startIngestDetached(){
  try {
    // Ensure directories
    try { fs.mkdirSync(path.resolve(ROOT_DIR, 'data'), { recursive: true }); } catch {}
    try { fs.mkdirSync(path.resolve(ROOT_DIR, 'scratch'), { recursive: true }); } catch {}
    const nodeExe = process.execPath || 'node';
    const script = path.join(ROOT_DIR, 'tools/local-indexer/ingest_raw.js');
    const outPath = LOG_OUT_PATH; const errPath = LOG_ERR_PATH;
    const outFd = fs.openSync(outPath, 'a');
    const errFd = fs.openSync(errPath, 'a');
    const child = spawn(nodeExe, [script], {
      cwd: ROOT_DIR,
      detached: true,
      stdio: ['ignore', outFd, errFd],
      env: (function(){
        const env = Object.assign({}, process.env);
        // Ensure sane defaults for paths when launched outside VS Code
        env.LOCAL_DB_PATH = env.LOCAL_DB_PATH || DB_PATH;
        env.STATUS_PATH = env.STATUS_PATH || STATUS_PATH;
        env.HISTORY_PATH = env.HISTORY_PATH || HISTORY_PATH;
        env.CONTROL_PATH = env.CONTROL_PATH || CONTROL_PATH;
        env.PID_PATH = env.PID_PATH || PID_PATH;
        // Engine & ingest defaults (mirror start_ingest.ps1)
        env.DB_ENGINE = env.DB_ENGINE && !/^true$/i.test(String(env.DB_ENGINE)) ? env.DB_ENGINE : 'better-sqlite3';
        env.RPC_URL = (env.RPC_URL && /^https?:\/\//i.test(env.RPC_URL) && !/^true$/i.test(String(env.RPC_URL))) ? env.RPC_URL : 'https://rpc.pyropechain.com';
        env.CHAIN_ID = env.CHAIN_ID || '695569';
        env.WORLD_ADDRESS = env.WORLD_ADDRESS && !/^true$/i.test(String(env.WORLD_ADDRESS)) ? env.WORLD_ADDRESS : '0x7085f3e652987f656fB8dEE5aA6592197Bb75de8';
        env.FROM_BLOCK = env.FROM_BLOCK || '7288348';
        env.CONFIRM_DEPTH = env.CONFIRM_DEPTH || '8';
        env.WINDOW_BLOCKS = env.WINDOW_BLOCKS || '20000';
        env.SEGMENT_BLOCKS = env.SEGMENT_BLOCKS || '1200';
        return env;
      })()
    });
    child.unref();
    return true;
  } catch (e) {
    try { fs.appendFileSync(LOG_ERR_PATH, String(e.stack||e)+'\n'); } catch (e2) {}
    return false;
  }
}
