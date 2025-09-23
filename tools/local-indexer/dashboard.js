;(function(){
  const fmt = {
    num(n){ try { return Number(n).toLocaleString(); } catch { return String(n) } },
    // Duration: show hours, minutes, seconds (e.g., 1h 2m 5s, 3m 10s, 25s)
    dur(sec){
      sec = Math.max(0, Math.round(sec));
      const h = Math.floor(sec/3600);
      const m = Math.floor((sec%3600)/60);
      const s = sec%60;
      if (h>0) return `${h}h ${m}m ${s}s`;
      if (m>0) return `${m}m ${s}s`;
      return `${s}s`;
    },
  };

  async function fetchJson(u){ const r = await fetch(u, { cache:'no-store' }); if(!r.ok) throw new Error('bad'); return r.json(); }

  function el(tag, props={}, ...children){ const n=document.createElement(tag); for(const k in props){ if(k==='style') Object.assign(n.style, props[k]); else if(k==='className') n.className=props[k]; else n.setAttribute(k, props[k]); } children.flat().forEach(c=>{ if(c==null) return; if(typeof c==='string'||typeof c==='number') n.appendChild(document.createTextNode(String(c))); else n.appendChild(c); }); return n; }

  function gauge(value, label){
    const pct = Math.max(0, Math.min(100, Math.round(value||0)));
    // Invert mapping so higher is greener
    const color = pct<60? '#ef4444' : pct<85? '#f59e0b' : '#10b981';
    const ring = el('div', { style:{ width:'64px', height:'64px', flex:'0 0 auto', aspectRatio:'1 / 1', borderRadius:'50%', position:'relative', color,
      background:`conic-gradient(currentColor ${pct*3.6}deg, var(--border) 0deg)` } },
      el('div', { style:{ position:'absolute', inset:'4px', borderRadius:'50%', background:'var(--card)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:'600' } }, pct+'%')
    );
    const right = el('div', {},
      el('div', { className:'muted', style:{ fontSize:'12px', textTransform:'uppercase' } }, label),
      el('div', { style:{ fontSize:'14px', fontWeight:'600' } }, pct+'%')
    );
    return el('div', { className:'gauge', style:{ display:'flex', alignItems:'center', gap:'8px' } }, ring, right);
  }

  async function renderErc1155(){
    try{
      const d = await fetchJson('/api/erc1155');
      if (!nodes.erc1155Wrap) return;
      const total = Number(d?.total||0), done = Number(d?.done||0);
      const pct = total>0 ? Math.max(0, Math.min(100, (done/total)*100)) : 0;
      if (nodes.erc1155Wrap.barFill) nodes.erc1155Wrap.barFill.style.width = pct.toFixed(1)+'%';
      if (nodes.erc1155Wrap.pct) setText(nodes.erc1155Wrap.pct, (total>0 || d?.state) ? pct.toFixed(1)+'%' : '-');
      const rps = d?.rps!=null ? (d.rps+' rows/s') : '-';
      const eta = d?.etaMs!=null ? (d.etaMs<60000 ? Math.round(d.etaMs/1000)+'s' : (d.etaMs/3600000).toFixed(2)+'h') : '-';
      if (nodes.erc1155Wrap.info) setText(nodes.erc1155Wrap.info, `State: ${d?.state||'-'} · rows ${fmt.num(done)} / ${fmt.num(total)} · ${rps} · ETA ${eta}`);
    } catch {}
  }

  function kpi(label, value, sub, danger){
    return el('div', { className:'card' },
      el('div', { className:'kpi' },
        el('div', { className:'label' }, label),
        el('div', { className:'value', style:{ color: danger? '#dc2626':'var(--text)' } }, value)
      ),
      sub ? el('div', { className:'muted', style:{ marginTop:'4px', fontSize:'12px' } }, sub) : null
    );
  }

  function progressBar(pct){ return el('div', { className:'bar' }, el('div', { style:{ width: Math.max(0, Math.min(100, pct))+'%' } })); }

  function areaChart(data, key){
    const w=600, h=200, pad=24; const xs=pad, xe=w-pad, ys=10, ye=h-20;
    const arr = Array.isArray(data)? data : [];
    const yvals = arr.map(d=>Number(d[key]||0));
    const ymin=0, ymax=Math.max(10, ...yvals);
    const x = (i)=> xs + (i*(xe-xs))/Math.max(1, arr.length-1);
    const y = (v)=> ye - (v*(ye-ys))/Math.max(1, (ymax-ymin));
    const pts = arr.map((d,i)=> `${x(i)},${y(Number(d[key]||0))}`).join(' ');
    const pathD = `M ${xs},${ye} L ${pts} L ${xe},${ye} Z`;
    const svg = el('svg', { width: '100%', height: h, viewBox:`0 0 ${w} ${h}` },
      el('rect', { x:0, y:0, width:w, height:h, fill:'transparent' }),
      el('path', { d:pathD, fill:'var(--accent)', 'fill-opacity':'0.18', stroke:'var(--accent)', 'stroke-width':'1' })
    );
    return svg;
  }

  function lineChart(data, key){
    const w=400, h=200, pad=24; const xs=pad, xe=w-pad, ys=10, ye=h-20;
    const arr = Array.isArray(data)? data : [];
    const yvals = arr.map(d=>Number(d[key]||0));
    const ymin=0, ymax=Math.max(3, ...yvals);
    const x = (i)=> xs + (i*(xe-xs))/Math.max(1, arr.length-1);
    const y = (v)=> ye - (v*(ye-ys))/Math.max(1, (ymax-ymin));
    const d = arr.map((p,i)=> `${i===0?'M':'L'} ${x(i)} ${y(Number(p[key]||0))}`).join(' ');
    const svg = el('svg', { width: '100%', height: h, viewBox:`0 0 ${w} ${h}` },
      el('path', { d, fill:'none', stroke:'var(--accent)', 'stroke-width':'2' })
    );
    return svg;
  }

  function miniSparkline(data, key, opts={}){
    const w = opts.width || 80, h = opts.height || 24, padX = 2, padY = 2;
    const xs = padX, xe = w - padX, ys = padY, ye = h - padY;
    const arr = Array.isArray(data)? data : [];
    const yvals = arr.map(d=>Number(d[key]||0));
    const ymin= Math.min(...yvals, 0), ymax=Math.max(1, ...yvals);
    const x = (i)=> xs + (i*(xe-xs))/Math.max(1, arr.length-1);
    const y = (v)=> ye - ((v - ymin)*(ye-ys))/Math.max(1, (ymax-ymin));
    const d = arr.map((p,i)=> `${i===0?'M':'L'} ${x(i)} ${y(Number(p[key]||0))}`).join(' ');
    const svg = el('svg', { width: w, height: h, viewBox:`0 0 ${w} ${h}` },
      el('path', { d, fill:'none', stroke:'var(--accent)', 'stroke-width':'1.5' })
    );
    return svg;
  }

  // Change-highlight helper (outside render for reuse)
  function setText(node, text){
    const next = String(text==null? '': text);
    const prev = node.__val;
    if (prev !== next){
      node.textContent = next;
      node.__val = next;
      node.classList.remove('changed');
      void node.offsetWidth; // restart animation
      node.classList.add('changed');
    }
  }

  let built = false;
  let nodes = {};
  let prev = { chainHead:null, indexedHead:null, errorsPerMin:null };

  function build(){
    const root = document.getElementById('root'); root.innerHTML='';
    const wrap = el('div', { className:'container' });
    const row = el('div', { className:'row' });
    wrap.appendChild(row);

    nodes.hdrSubtitle = el('div', { className:'muted', style:{ marginTop:'4px' } }, '');
    const hdr = el('div', { className:'grid12' },
      el('div', { className:'card', style:{ display:'flex', alignItems:'center', justifyContent:'space-between' } },
        el('div', {},
          el('div', { className:'title' }, 'Indexer Dashboard'),
          nodes.hdrSubtitle
        ),
        el('div', { style:{ display:'flex', alignItems:'center', gap:'12px' } },
          nodes.modePill = el('span', { className:'pill live', style:{ flex:'0 0 auto' } }, 'Live'),
          nodes.healthWrap = el('div', { style:{ flex:'0 0 auto' } }, gauge(100, 'Overall Health')),
          nodes.stale = el('span', { className:'muted' }, '')
        )
      )
    );
    row.appendChild(hdr);

    function kpiShell(label, withSpark){
      const v = el('div', { className:'value' }, '');
      const delta = el('span', { className:'delta', title:'Change since last update' }, '');
      const valueWrap = el('div', { className:'kpiValueWrap' }, v, delta);
      const sub = el('div', { className:'muted', style:{ marginTop:'4px', fontSize:'12px' } }, '');
      const top = el('div', { className:'kpi' }, el('div', { className:'label' }, label), valueWrap);
      const card = el('div', { className:'card' }, top);
      if (withSpark){
        const spark = el('div', { style:{ marginTop:'6px' } });
        card.appendChild(spark);
        return { card, v, delta, sub, spark };
      }
      card.appendChild(sub);
      return { card, v, delta, sub };
    }
    const k1 = kpiShell('Chain Head');
    const k2 = kpiShell('Indexed Head', true);
    const k3 = kpiShell('Catch-up ETA');
    const k4 = kpiShell('Errors / min');
    nodes.kChain = k1; nodes.kIndex = k2; nodes.kEta = k3; nodes.kErr = k4;
    row.appendChild(el('div', { className:'grid3' }, k1.card));
    row.appendChild(el('div', { className:'grid3' }, k2.card));
    row.appendChild(el('div', { className:'grid3' }, k3.card));
    row.appendChild(el('div', { className:'grid3' }, k4.card));

  // Decode KPIs row: Lag, ETA, Throughput
  const dk1 = kpiShell('Decode Lag (blocks)');
  const dk2 = kpiShell('Decode ETA');
  const dk3 = kpiShell('Decode Throughput');
  nodes.kDecLag = dk1; nodes.kDecEta = dk2; nodes.kDecTput = dk3;
  row.appendChild(el('div', { className:'grid3' }, dk1.card));
  row.appendChild(el('div', { className:'grid3' }, dk2.card));
  row.appendChild(el('div', { className:'grid3' }, dk3.card));

  nodes.tputWrap = el('div', { className:'card' }, el('div', { className:'title' }, 'Throughput (blocks/min)'), el('div', { className:'sub' }, 'Last 60 seconds'));
  nodes.tputTable = el('div', { className:'muted', style:{ marginTop:'8px', fontSize:'12px' } }, '');
  nodes.tputWrap.appendChild(nodes.tputTable);
    nodes.errWrap = el('div', { className:'card' }, el('div', { className:'title' }, 'Errors per minute'), el('div', { className:'sub' }, 'Last 60 seconds'));
    row.appendChild(el('div', { className:'grid8' }, nodes.tputWrap));
    row.appendChild(el('div', { className:'grid4' }, nodes.errWrap));

    nodes.shardWrap = el('div', { className:'card' }, el('div', { className:'title' }, 'Worker Shards'), el('div', { className:'sub' }, 'Range assignment & progress'));
    row.appendChild(el('div', { className:'grid8' }, nodes.shardWrap));

    nodes.queueWrap = el('div', { className:'card' }, el('div', { className:'title' }, 'Queues / Process'), el('div', { className:'sub' }, 'In-flight work & liveness'));
    row.appendChild(el('div', { className:'grid4' }, nodes.queueWrap));
    // Ingest process status + control
    nodes.procWrap = (function(){
      const status = el('div', { className:'muted', style:{ fontSize:'12px' } }, 'checking…');
  const btn = el('button', { style:{ padding:'6px 10px', border:'1px solid var(--border)', background:'var(--card)', color:'#fff', cursor:'pointer', borderRadius:'4px' } }, 'Start ingest');
      btn.onclick = async ()=>{
        btn.disabled = true; btn.textContent = 'Starting…';
        const tryStart = async ()=>{
          // Try main metrics endpoint first
          try {
            const r = await fetch('/api/control/start-ingest', { method:'POST' });
            if (r.ok) return r.json().catch(()=>({status:'started'}));
          } catch {}
          // Fallback to control server (out-of-band)
          try {
            const r2 = await fetch('http://127.0.0.1:8799/start', { method:'POST', mode:'no-cors' });
            // no-cors hides body; assume started if no exception
            return { status:'started' };
          } catch {}
          throw new Error('start failed');
        };
        try {
          const j = await tryStart();
          const used = j && j.used ? ` rpc=${j.used.rpcUrl||'-'} world=${j.used.worldAddress||'-'} chain=${j.used.chainId||'-'}` : '';
          const via = j && j.via ? ` via ${j.via}` : '';
          const txt = j && j.status ? ('status: '+j.status) : 'started';
          status.textContent = txt + via + used + ' · waiting for heartbeat…';
          setTimeout(()=>{ btn.textContent = 'Restart ingest'; btn.disabled = false; }, 4000);
        } catch (e) {
          status.textContent = 'error starting';
          btn.textContent = 'Start ingest'; btn.disabled = false;
        }
      };
  const card = el('div', { className:'card' }, el('div', { className:'title' }, 'Ingest Process'), status, el('div', { style:{ marginTop:'6px' } }, btn));
      return { card, status, btn };
    })();
    row.appendChild(el('div', { className:'grid4' }, nodes.procWrap.card));

    nodes.alertsWrap = el('div', { className:'card' }, el('div', { className:'title' }, 'Recent Alerts'), el('div', { className:'sub' }, 'Newest first'));
    row.appendChild(el('div', { className:'grid8' }, nodes.alertsWrap));

    nodes.decodeWrap = (function(){
      const pct = el('div', { className:'muted' }, '-');
      const bar = progressBar(0);
      const info = el('div', { className:'muted', style:{ fontSize:'12px', marginTop:'6px' } }, '-');
      const card = el('div', { className:'card' }, el('div', { className:'title' }, 'Decode progress'), pct, el('div', { style:{ marginTop:'8px' } }, bar), info);
      return { card, pct, barFill: bar.firstChild, info };
    })();

    nodes.datasetWrap = (function(){
      const info = el('div', { className:'muted', style:{ fontSize:'12px' } }, '');
      const card = el('div', { className:'card' }, el('div', { className:'title' }, 'Decoded dataset'), info);
      return { card, info };
    })();
    nodes.erc20Wrap = (function(){
      const totals = el('div', { className:'muted', style:{ fontSize:'12px' } }, '');
      const list = el('ul', { style:{ listStyle:'none', padding:0, margin:'6px 0 0 0' } });
      const card = el('div', { className:'card' }, el('div', { className:'title' }, 'ERC-20 activity'), totals, list);
      return { card, totals, list };
    })();
    nodes.erc721Wrap = (function(){
      const pct = el('div', { className:'muted' }, '-');
      const bar = progressBar(0);
      const info = el('div', { className:'muted', style:{ fontSize:'12px', marginTop:'6px' } }, '-');
      const card = el('div', { className:'card' }, el('div', { className:'title' }, 'ERC-721 materialization'), pct, el('div', { style:{ marginTop:'8px' } }, bar), info);
      return { card, pct, barFill: bar.firstChild, info };
    })();
    nodes.ecsWrap = (function(){
      const sub = el('div', { className:'sub' }, 'All tables · latest/values/typed');
      const totals = el('div', { className:'muted', style:{ fontSize:'12px', margin:'4px 0' } }, '-');
      const list = el('div', { className:'scroll' }, 'Loading…');
      const card = el('div', { className:'card' }, el('div', { className:'title' }, 'MUD / ECS Snapshot'), sub, totals, list);
      // _key used to avoid DOM churn when data didn't change
      return { card, totals, list, _key: null };
    })();
  row.appendChild(el('div', { className:'grid3' }, nodes.decodeWrap.card));
  row.appendChild(el('div', { className:'grid3' }, nodes.datasetWrap.card));
  row.appendChild(el('div', { className:'grid3' }, nodes.erc20Wrap.card));
  row.appendChild(el('div', { className:'grid3' }, nodes.erc721Wrap.card));
  nodes.erc1155Wrap = (function(){
    const pct = el('div', { className:'muted' }, '-');
    const bar = progressBar(0);
    const info = el('div', { className:'muted', style:{ fontSize:'12px', marginTop:'6px' } }, '-');
    const card = el('div', { className:'card' }, el('div', { className:'title' }, 'ERC-1155 materialization'), pct, el('div', { style:{ marginTop:'8px' } }, bar), info);
    return { card, pct, barFill: bar.firstChild, info };
  })();
  row.appendChild(el('div', { className:'grid3' }, nodes.erc1155Wrap.card));

    // MUD SetRecord progress card
    nodes.mudWrap = (function(){
      const pct = el('div', { className:'muted' }, '-');
      const bar = progressBar(0);
      const info = el('div', { className:'muted', style:{ fontSize:'12px', marginTop:'6px' } }, '-');
      const card = el('div', { className:'card' }, el('div', { className:'title' }, 'MUD SetRecord'), pct, el('div', { style:{ marginTop:'8px' } }, bar), info);
      return { card, pct, barFill: bar.firstChild, info };
    })();
    row.appendChild(el('div', { className:'grid3' }, nodes.mudWrap.card));

    // MUD table stats card (scrollable area with larger footprint)
    nodes.mudStats = (function(){
      const title = el('div', { className:'title' }, 'MUD Tables (by rows)');
      const sub = el('div', { className:'sub' }, 'Derived from SetRecord');
      const body = el('div', { className:'scroll' }, 'Loading…');
      const card = el('div', { className:'card' }, title, sub,
        el('div', { className:'muted', style:{ fontSize:'12px', margin:'6px 0' } }, 'Scroll to view all tables'),
        body
      );
      return { card, body };
    })();
  // Make these full-width for better readability (stacked rows)
  row.appendChild(el('div', { className:'grid12' }, nodes.mudStats.card));
  row.appendChild(el('div', { className:'grid12' }, nodes.ecsWrap.card));

    // Typed decoding backlog (tables with values but 0 typed rows)
    nodes.needsWrap = (function(){
      const sub = el('div', { className:'sub' }, 'Tables with latest/values but 0 typed rows');
      const totals = el('div', { className:'muted', style:{ fontSize:'12px', margin:'4px 0' } }, '-');
      const body = el('div', { className:'scroll' }, 'Loading…');
      const card = el('div', { className:'card' }, el('div', { className:'title' }, 'Typed decoding backlog'), sub, totals, body);
      return { card, totals, body, _key: null };
    })();
    row.appendChild(el('div', { className:'grid12' }, nodes.needsWrap.card));

    nodes.footerLeft = el('div', {}, '');
    nodes.footerRight = el('div', {}, '');
    const foot = el('div', { className:'grid12' }, el('div', { className:'footer' }, nodes.footerLeft, nodes.footerRight));
    row.appendChild(foot);

    // World API (DLT) section – total rows and per-table counts sourced from /api/worldapi-stats
    nodes.worldApi = (function(){
      const title = el('div', { className:'title' }, 'World API (dlt)');
      const sub = el('div', { className:'sub' }, 'Counts from snapshots');
      const total = el('div', { className:'kpi' }, el('div', { className:'label' }, 'Total World API rows'), el('div', { className:'value' }, 'No data'));
      const list = el('div', { className:'scroll' }, el('div', { className:'muted' }, 'No data'));
      const left = el('div', { className:'card' }, title, sub, total);
      const right = el('div', { className:'card' }, el('div', { className:'title' }, 'World API raw tables (counts)'), list);
      const wrap = el('div', { className:'grid12' }, el('div', { className:'row' }, el('div', { className:'grid4' }, left), el('div', { className:'grid8' }, right)));
      return { wrap, total, list };
    })();
    row.appendChild(nodes.worldApi.wrap);

    root.appendChild(wrap);
    built = true;
  }

  function update(summary, tput, errs, alerts, lagSeries, decode){
    const s = summary || { chainName:'Local Indexer', rpcUrl:'', mode:'Live', chainHead:null, indexedHead:0, blocksPerMin:0, errorsPerMin:0, reorgDepth:0, queueDepth:0, start:Date.now(), etaSec:0 };
    const lag = (s.chainHead!=null? s.chainHead : s.indexedHead) - s.indexedHead;

  const fresh = (s.statusFreshSec!=null)? (' · status '+(s.statusFreshSec<=15? 'fresh':'stale')+' '+s.statusFreshSec+'s') : '';
  const rpcState = (function(){
    if (!s || !s.rpcUrl || s.rpcSource==='disabled') return 'disabled';
    if (s.rpcError) return 'error';
    if (s.rpcFreshSec==null) return 'stale';
    return s.rpcFreshSec<=90? 'ok' : 'stale';
  })();
  const rpcTxt = 'RPC: '+(s.rpcUrl||'n/a')+' ['+rpcState+ (s.netLatencyMs!=null? (', '+s.netLatencyMs+'ms') : '') + (s.rpcFreshSec!=null? (', '+s.rpcFreshSec+'s') : '') +']'+ (s.rpcSource? (' ('+s.rpcSource+')') : '');
  const worldStr = ' · world ' + (s.worldAddress || 'n/a') + ' · chain ' + (s.chainId || 'n/a');
  setText(nodes.hdrSubtitle, (s.chainName||'Local Frontier')+' · '+rpcTxt + worldStr + fresh);
  nodes.modePill.className = 'pill ' + (s.mode==='Live'?'live':'catch');
    setText(nodes.modePill, s.mode||'Live');
    setText(nodes.stale, summary? '' : 'stale');

  const chainTxt = (s.chainHead!=null? '#'+fmt.num(s.chainHead):'n/a');
  const chainRate = (s.chainBlocksPerMin!=null && !isNaN(s.chainBlocksPerMin)) ? s.chainBlocksPerMin : (s.blocksPerMin||0);
  const chainSub = chainRate + ' blk/min (chain)';
    setText(nodes.kChain.v, chainTxt);
    setText(nodes.kChain.sub, chainSub);
    // chain delta: show rate per minute
    {
      const rate = (s.chainBlocksPerMin!=null && !isNaN(s.chainBlocksPerMin)) ? s.chainBlocksPerMin : 0;
      nodes.kChain.delta.className = rate>=0? 'delta up' : 'delta down';
      setText(nodes.kChain.delta, (rate>=0? '+':'') + fmt.num(Math.abs(rate)) + '/min');
    }

  const idxTxt = '#'+fmt.num(s.indexedHead);
    const idxSub = fmt.num(lag)+' blk lag';
    setText(nodes.kIndex.v, idxTxt);
    setText(nodes.kIndex.sub, idxSub);
    // index delta: show ingest rate per minute
    {
      const rate = (s.blocksPerMin!=null && !isNaN(s.blocksPerMin)) ? s.blocksPerMin : 0;
      nodes.kIndex.delta.className = rate>=0? 'delta up' : 'delta down';
      setText(nodes.kIndex.delta, (rate>=0? '+':'') + fmt.num(Math.abs(rate)) + '/min');
    }
    // mini spark next to Indexed Head (lag preferred; fallback to tput)
    if (nodes.kIndex.spark){
      nodes.kIndex.spark.innerHTML = '';
      const data = (lagSeries && lagSeries.length)? lagSeries : tput;
      const key = (lagSeries && lagSeries.length)? 'lag' : 'blocks';
      nodes.kIndex.spark.appendChild(miniSparkline(data, key, { width: 120, height: 28 }));
    }

  const etaTxt = fmt.dur(Math.max(0, s.etaSec||0));
  const eff = (s.effectiveBlocksPerMin!=null)? s.effectiveBlocksPerMin : Math.max(0, (s.blocksPerMin||0) - (chainRate||0));
    const etaSub = eff>0
      ? (Math.max(0, Math.round(lag/Math.max(1, eff)))+' min at ~'+fmt.num(s.blocksPerMin||0)+' ingest vs '+fmt.num(chainRate||0)+' chain (eff '+fmt.num(eff)+' bpm)')
      : (lag>0 ? 'Waiting for faster ingest…' : 'Up to date');
    setText(nodes.kEta.v, etaTxt);
    setText(nodes.kEta.sub, etaSub);

    setText(nodes.kErr.v, String((s.errorsPerMin||0)));
    setText(nodes.kErr.sub, 'Reorg depth '+(s.reorgDepth||0));

    // Compute health percentage: base 100, subtract penalties
    const health = (function(){
      let h = 100;
      // RPC state
      if (rpcState==='error') h -= 50; else if (rpcState==='stale') h -= 25;
      // Status freshness
      if (s.statusFreshSec!=null){ if (s.statusFreshSec>300) h -= 40; else if (s.statusFreshSec>90) h -= 20; }
      // Ingest activity vs lag
      if ((eff|0)===0 && (s.queueDepth|0)>0) h -= 20;
      // Errors
      if ((s.errorsPerMin|0)>0){ h -= Math.min(40, (s.errorsPerMin|0)*5); }
      return Math.max(0, Math.min(100, Math.round(h)));
    })();
    if (nodes.healthWrap){ nodes.healthWrap.innerHTML=''; nodes.healthWrap.appendChild(gauge(health, 'Overall Health')); }

  // Render charts; if arrays are empty, render a flat zero series to avoid flicker
  nodes.tputWrap.querySelectorAll('svg').forEach(n=>n.remove());
  const tputSafe = (Array.isArray(tput) && tput.length) ? tput : Array.from({length:10}, (_,i)=>({ t:i-9, blocks:0 }));
  nodes.tputWrap.appendChild(areaChart(tputSafe, 'blocks'));
  // Simple table-like summary under chart
  try {
    const last = (tputSafe.slice(-6).map(d=>Number(d.blocks||0)));
    const samples = last.length ? last.join(', ') : '-';
    const eff = (s.effectiveBlocksPerMin!=null)? s.effectiveBlocksPerMin : Math.max(0, (s.blocksPerMin||0) - (chainRate||0));
    const line = `ingest ${fmt.num(s.blocksPerMin||0)} · chain ${fmt.num(chainRate||0)} · eff ${fmt.num(eff)} · samples(last ${last.length}s): ${samples}`;
    if (nodes.tputTable) setText(nodes.tputTable, line);
  } catch {}
  nodes.errWrap.querySelectorAll('svg').forEach(n=>n.remove());
  const errsSafe = (Array.isArray(errs) && errs.length) ? errs : Array.from({length:10}, (_,i)=>({ t:i-9, errors:0 }));
  nodes.errWrap.appendChild(lineChart(errsSafe, 'errors'));

  // Alerts: keep last shown if new list is empty to reduce pop-in/out, tag historical
    const newList = el('ul', { style:{ listStyle:'none', padding:0, margin:0 } }, (alerts||[]).map(a=> {
      const ageSec = Math.max(0, Math.round((Date.now() - (a.ts||Date.now()))/1000));
      const historical = ageSec > 3600; // >1h old
      return el('li', { className:'card', style:{ display:'flex', gap:'8px', alignItems:'flex-start', opacity: historical? 0.6 : 1 } },
        el('span', { style:{ width:'10px', height:'10px', borderRadius:'999px', marginTop:'4px', background: a.level==='error'? '#ef4444' : a.level==='warning'? '#f59e0b' : '#3b82f6' } }),
        el('div', {}, el('div', {}, a.msg||''), el('div', { className:'muted', style:{ fontSize:'12px' } }, new Date(a.ts||Date.now()).toLocaleTimeString() + (historical? ' · historical' : '')))
      );
    }));
    if (newList.childElementCount > 0 || !nodes.alertsWrap.querySelector('ul')){
      nodes.alertsWrap.querySelectorAll('ul').forEach(n=>n.remove());
      nodes.alertsWrap.appendChild(newList);
    }

    const uptimeSec = Math.max(0, ((Date.now() - (s.start||Date.now()))/1000)|0);
    setText(nodes.footerLeft, 'Uptime: ' + fmt.dur(uptimeSec) + ' · Indexed Lag: ' + fmt.num(Math.max(0, lag)) + ' blocks');
    setText(nodes.footerRight, summary ? 'Heartbeat OK' : 'Heartbeat STALE');

    // Update process card liveness from /api/proc
    (async ()=>{
      try{
        const p = await fetch('/api/proc', { cache:'no-store' }).then(r=>r.json());
        if (p && nodes.procWrap){
          const age = p.updatedAgoSec!=null? (p.updatedAgoSec+'s ago') : 'n/a';
          const lag = p.lag!=null? (p.lag+' blk lag') : '';
          const txt = (p.running? 'UP' : 'DOWN') + ' · last update '+age + (lag? (' · '+lag):'');
          setText(nodes.procWrap.status, txt);
          // Button behavior: when running, label is 'Restart ingest'; when down, 'Start ingest'
          nodes.procWrap.btn.textContent = p.running ? 'Restart ingest' : 'Start ingest';
          nodes.procWrap.btn.disabled = !p.allowControl;
        }
      } catch {}
    })();

  // store prevs
  prev = { chainHead: typeof s.chainHead==='number'? s.chainHead : prev.chainHead, indexedHead: typeof s.indexedHead==='number'? s.indexedHead : prev.indexedHead, errorsPerMin: typeof s.errorsPerMin==='number'? s.errorsPerMin : prev.errorsPerMin };

    // Decode progress
    try {
      const d = decode || {};
      const total = Number(d.total||0), done = Number(d.done||0);
      const pct = total>0 ? Math.max(0, Math.min(100, (done/total)*100)) : 0;
      if (nodes.decodeWrap && nodes.decodeWrap.barFill) nodes.decodeWrap.barFill.style.width = pct.toFixed(1)+'%';
      if (nodes.decodeWrap && nodes.decodeWrap.pct) setText(nodes.decodeWrap.pct, total>0 ? pct.toFixed(1)+'%' : '-');
      const rps = d.rps!=null ? (d.rps+' rows/s') : '-';
      const eta = d.etaMs!=null ? (d.etaMs<60000 ? Math.round(d.etaMs/1000)+'s' : (d.etaMs/3600000).toFixed(2)+'h') : '-';
      if (nodes.decodeWrap && nodes.decodeWrap.info) {
        const staleTag = d && d.__stale ? ' · stale' : '';
        setText(nodes.decodeWrap.info, `State: ${d.state||'-'} · rows ${fmt.num(done)} / ${fmt.num(total)} · unknown ${fmt.num(d.unknown||0)} · ${rps} · ETA ${eta}${staleTag}`);
      }

      // New: Decode KPI tiles
      if (nodes.kDecLag && nodes.kDecEta && nodes.kDecTput){
        const lastDecoded = Number(d.lastBlock||0);
        const idxHead = (s && typeof s.indexedHead==='number') ? s.indexedHead : null;
        const dLag = (idxHead!=null && lastDecoded>0) ? Math.max(0, idxHead - lastDecoded) : null;
        const updAgo = (()=>{ try { return d.updatedAt? Math.round((Date.now()-Date.parse(d.updatedAt))/1000) : null; } catch { return null } })();
        // Lag tile
        setText(nodes.kDecLag.v, dLag!=null ? `${fmt.num(dLag)} blk` : '-');
        setText(nodes.kDecLag.sub, (lastDecoded>0? `last #${fmt.num(lastDecoded)}`:'') + (updAgo!=null? ` · ${updAgo}s ago`:'') );
        nodes.kDecLag.delta.className = 'delta up';
        setText(nodes.kDecLag.delta, dLag!=null? (dLag>0? `-${Math.min(dLag,999)} blk`:'0') : '');

        // ETA tile (from decode ETA when provided)
        const etaSec = (d.etaMs!=null) ? Math.max(0, Math.round(Number(d.etaMs)/1000)) : null;
        setText(nodes.kDecEta.v, etaSec!=null ? fmt.dur(etaSec) : '-');
        setText(nodes.kDecEta.sub, d.state? (`State: ${d.state}`):'');
        nodes.kDecEta.delta.className = 'delta up';
        setText(nodes.kDecEta.delta, etaSec!=null? (etaSec>0? `-${Math.min(etaSec,999)}s`:'0') : '');

        // Throughput tile
        const rpsNum = (d.rps!=null) ? Number(d.rps) : null;
        setText(nodes.kDecTput.v, rpsNum!=null ? `${fmt.num(rpsNum)} rows/s` : '-');
        setText(nodes.kDecTput.sub, (total||done) ? `rows ${fmt.num(done)} / ${fmt.num(total||0)}` : '');
        nodes.kDecTput.delta.className = rpsNum!=null && rpsNum>=0 ? 'delta up' : 'delta down';
        setText(nodes.kDecTput.delta, rpsNum!=null ? `+${fmt.num(Math.max(0, Math.round(rpsNum)))}` : '');
      }
    } catch {}
  }

  function render(){
    if (!built) build();
    const main = Promise.all([
      fetchJson('/api/health').catch(()=>null),
      fetchJson('/api/summary').catch(()=>null),
      fetchJson('/api/series/tput').catch(()=>[]),
      fetchJson('/api/series/errors').catch(()=>[]),
      fetchJson('/api/series/lag').catch(()=>[]),
      fetchJson('/api/alerts').catch(()=>[]),
      fetchJson('/api/shards').catch(()=>[]),
      fetchJson('/api/decode').catch(()=>null),
      fetchJson('/api/decoded-dataset').catch(()=>null),
    ]);
    const fallback = Promise.all([
      fetchJson('http://127.0.0.1:8799/health').catch(()=>null),
      fetchJson('http://127.0.0.1:8799/summary').catch(()=>null),
      Promise.resolve([]),
      Promise.resolve([]),
      Promise.resolve([]),
      Promise.resolve([]),
      Promise.resolve([]),
      Promise.resolve(null),
      Promise.resolve(null),
    ]);
    const mainP = main.then(v=>({ v, source:'main' })).catch(()=>({ v:null, source:'main' }));
    const fallbackP = fallback.then(v=>({ v, source:'fallback' })).catch(()=>({ v:null, source:'fallback' }));
    Promise.race([
      mainP,
      // if main lags, fallback may resolve first; we still re-run main next tick
      fallbackP,
    ]).then(({ v, source })=>{
      const [health, summary, tput, errs, lag, alerts, shards, decode] = v || [];
      // If summary missing, reuse last-known metrics to avoid KPI reset flicker
      const stableSummary = summary || window.__lastSummary || null;
      const tputSafe = (Array.isArray(tput) && tput.length) ? tput : (window.__lastTput || []);
      const errsSafe = (Array.isArray(errs) && errs.length) ? errs : (window.__lastErrs || []);
      const lagSafe = (Array.isArray(lag) && lag.length) ? lag : (window.__lastLag || []);
      // Stabilize decode payload with last-good cache
      function isValidDecode(d){
        if (!d || typeof d !== 'object') return false;
        if (Number.isFinite(Number(d.total)) && Number(d.total) > 0) return true;
        if (Number.isFinite(Number(d.done)) && Number(d.done) > 0) return true;
        if (d.state && String(d.state).length) return true;
        if (Number.isFinite(Number(d.lastBlock)) && Number(d.lastBlock) > 0) return true;
        return false;
      }
      let decodeStable = null;
      if (isValidDecode(decode)) {
        decodeStable = { ...decode, __stale: false };
        window.__lastDecode = decodeStable;
      } else if (window.__lastDecode) {
        decodeStable = { ...window.__lastDecode, __stale: true };
      } else {
        decodeStable = null;
      }
      update(stableSummary, tputSafe, errsSafe, alerts, lagSafe, decodeStable);
      if (summary) window.__lastSummary = summary;
      if (Array.isArray(tput)) window.__lastTput = tput;
      if (Array.isArray(errs)) window.__lastErrs = errs;
      if (Array.isArray(lag)) window.__lastLag = lag;
      // If we rendered using fallback (decode may be null), update decode again when main resolves
      if (source === 'fallback') {
        mainP.then(({ v: mv })=>{
          try {
            const decodeFresh = mv && mv[7];
            if (isValidDecode && isValidDecode(decodeFresh)) {
              const ds = { ...decodeFresh, __stale: false };
              window.__lastDecode = ds;
              const s2 = window.__lastSummary || stableSummary;
              const t2 = window.__lastTput || tputSafe;
              const e2 = window.__lastErrs || errsSafe;
              const l2 = window.__lastLag || lagSafe;
              update(s2, t2, e2, alerts, l2, ds);
            }
          } catch {}
        }).catch(()=>{});
      }
    }).catch(()=>{
      // keep last frame; show stale in footer on next successful poll
    });
  }

  // lightweight second poll just for dataset card (so we don’t change update signature broadly)
  async function renderDataset(){
    try{
      const ds = await fetchJson('/api/decoded-dataset');
      if (nodes.datasetWrap && nodes.datasetWrap.info){
        if (!ds || !ds.exists){ nodes.datasetWrap.info.textContent = 'No decoded DB yet'; return; }
        const size = ds.sizeBytes!=null ? (Math.round(ds.sizeBytes/1_048_576)+' MB') : 'n/a';
        const rows = ds.rows!=null ? ds.rows.toLocaleString() : 'n/a';
        nodes.datasetWrap.info.textContent = `Path: ${ds.path} · Size: ${size} · Rows: ${rows}`;
      }
  } catch {}
  }

  async function renderErc20(){
    try{
      const s = await fetchJson('/api/erc20-stats');
      if (!nodes.erc20Wrap) return;
      if (!s || !s.exists){ nodes.erc20Wrap.totals.textContent = 'No data'; nodes.erc20Wrap.list.innerHTML=''; return; }
      const totT = (s.totalTransfers||0).toLocaleString();
      const totA = (s.totalApprovals||0).toLocaleString();
      const recT = (s.recent && s.recent.transfers!=null)? s.recent.transfers.toLocaleString() : 'n/a';
      const recA = (s.recent && s.recent.approvals!=null)? s.recent.approvals.toLocaleString() : 'n/a';
      nodes.erc20Wrap.totals.textContent = `Transfers: ${totT} · Approvals: ${totA} · Recent(${s.recent?.windowBlocks||'10k'} blk): T=${recT} A=${recA}`;
      const top = Array.isArray(s.topTokens)? s.topTokens : [];
      nodes.erc20Wrap.list.innerHTML = '';
      top.forEach((t)=>{
        nodes.erc20Wrap.list.appendChild(el('li', { className:'muted', style:{ fontSize:'12px' } }, `${t.token} · ${Number(t.c||0).toLocaleString()} transfers`));
      });
    } catch {}
  }

  // ERC-721 materialization card updater
  async function renderErc721(){
    try{
      const d = await fetchJson('/api/erc721');
      if (!nodes.erc721Wrap) return;
      const total = Number(d?.total||0), done = Number(d?.done||0);
      const pct = total>0 ? Math.max(0, Math.min(100, (done/total)*100)) : 0;
      if (nodes.erc721Wrap.barFill) nodes.erc721Wrap.barFill.style.width = pct.toFixed(1)+'%';
      // Show 0% when we have a state but total is 0, to make it clear job ran
      if (nodes.erc721Wrap.pct) setText(nodes.erc721Wrap.pct, (total>0 || d?.state) ? pct.toFixed(1)+'%' : '-');
      const rps = d?.rps!=null ? (d.rps+' rows/s') : '-';
      const eta = d?.etaMs!=null ? (d.etaMs<60000 ? Math.round(d.etaMs/1000)+'s' : (d.etaMs/3600000).toFixed(2)+'h') : '-';
      if (nodes.erc721Wrap.info) setText(nodes.erc721Wrap.info, `State: ${d?.state||'-'} · rows ${fmt.num(done)} / ${fmt.num(total)} · ${rps} · ETA ${eta}`);
    } catch {}
  }

  // MUD SetRecord card updater
  async function renderMud(){
    try{
      const d = await fetchJson('/api/mud');
      if (!nodes.mudWrap) return;
      const total = Number(d?.total||0), done = Number(d?.done||0);
      const pct = total>0 ? Math.max(0, Math.min(100, (done/total)*100)) : 0;
      if (nodes.mudWrap.barFill) nodes.mudWrap.barFill.style.width = pct.toFixed(1)+'%';
      if (nodes.mudWrap.pct) setText(nodes.mudWrap.pct, (total>0 || d?.state) ? pct.toFixed(1)+'%' : '-');
      const rps = d?.rps!=null ? (d.rps+' rows/s') : '-';
      const eta = d?.etaMs!=null ? (d.etaMs<60000 ? Math.round(d.etaMs/1000)+'s' : (d.etaMs/3600000).toFixed(2)+'h') : '-';
      if (nodes.mudWrap.info) setText(nodes.mudWrap.info, `State: ${d?.state||'-'} · rows ${fmt.num(done)} / ${fmt.num(total)} · ${rps} · ETA ${eta}`);
    } catch {}
  }

  // MUD table stats updater
  async function renderMudStats(){
    try {
      // Request all rows; server clamps max
      const d = await fetchJson('/api/mud-table-stats?limit=all');
      if (!nodes.mudStats) return;
      if (!d?.exists) { setText(nodes.mudStats.body, 'decoded db missing'); return; }
      if (d.limited) { setText(nodes.mudStats.body, 'limited mode; open with better-sqlite3'); return; }
      if (!d.ready) { setText(nodes.mudStats.body, 'Run derive_mud_tables to populate stats'); return; }
      const top = Array.isArray(d.top) ? d.top : [];
      if (!top.length) { setText(nodes.mudStats.body, 'No tables found'); return; }
      const list = el('div', {});
      for (const r of top){
        const name = (r.namespace && r.name) ? `${r.namespace}/${r.name}` : (r.name || r.namespace || '(unknown)');
        const line = el('div', { className:'kv' },
          el('span', { className:'kv-name' }, name),
          el('span', { className:'kv-val' }, `${fmt.num(r.rows||0)} rows · ${fmt.num(r.unique_keys||0)} keys`)
        );
        list.appendChild(line);
      }
      nodes.mudStats.body.replaceChildren(list);
    } catch (e) {
      if (nodes.mudStats) setText(nodes.mudStats.body, 'error');
    }
  }

  build();
  render();
  setInterval(render, 1000);
  setInterval(renderDataset, 3000);
  setInterval(renderErc20, 5000);
  setInterval(renderErc721, 3000);
  setInterval(renderMud, 3000);
  setInterval(renderMudStats, 5000);
  renderMudStats();
  setInterval(renderErc1155, 3000);

  // Remove duplicate renderNeeds (consolidated below)

  async function renderEcs(){
    try{
      const [s, ecs] = await Promise.all([
        fetchJson('/api/mud-latest').catch(()=>null),
        fetchJson('/api/mud-ecs?limit=all').catch(()=>null)
      ]);
      if (!nodes.ecsWrap) return;
      if (!s?.exists){
        nodes.ecsWrap.totals.textContent = 'No decoded DB yet';
        if (!nodes.ecsWrap.list.hasChildNodes()) nodes.ecsWrap.list.textContent = '';
        return;
      }
      const t = s.totals||{};
      const staleTag = (s.stale||ecs?.stale) ? ' · stale' : '';
      nodes.ecsWrap.totals.textContent = `Latest: ${fmt.num(t.latest||0)} · Values: ${fmt.num((t.values||0))} · Typed: ${fmt.num(t.typed||0)} · Tip block: ${t.tip!=null? ('#'+fmt.num(t.tip)) : 'n/a'}${staleTag}`;
      const items = Array.isArray(ecs?.items)? ecs.items : [];
      if (!items.length){
        // Don't blank existing list; only show message if nothing is rendered yet
        if (!nodes.ecsWrap.list.hasChildNodes()){
          nodes.ecsWrap.list.textContent = ecs && ecs.exists === false
            ? 'ECS endpoint unavailable'
            : 'No ECS tables found (yet)';
        }
        return;
      }
      // Build a stable key to detect changes and avoid unnecessary DOM work
      const key = (()=>{
        try{
          const mini = items.map(w=>[w.namespace,w.name,w.latest|0,w.values|0,(w.typed|0)||0,w.tip|0]);
          return JSON.stringify(mini);
        }catch{ return String(items.length) }
      })();
      if (nodes.ecsWrap._key === key) return; // no visible changes
      const list = el('div', {});
      items.forEach((w)=>{
        const name = `${w.namespace}/${w.name}`;
        const pctValues = w.latest>0 ? Math.round(Math.min(100, (w.values/(w.latest||1))*100)) : 0;
        const pctTyped = w.latest>0 ? Math.round(Math.min(100, (Number(w.typed||0)/(w.latest||1))*100)) : 0;
        list.appendChild(el('div', { className:'kv' },
          el('span', { className:'kv-name' }, name),
          el('span', { className:'kv-val' }, `${fmt.num(w.values||0)} / ${fmt.num(w.latest||0)} (${pctValues}%) · typed ${fmt.num(w.typed||0)} (${pctTyped}%) · tip #${fmt.num(w.tip||0)}`)
        ));
      });
      nodes.ecsWrap.list.replaceChildren(list);
      nodes.ecsWrap._key = key;
    } catch {
      // On error, keep existing content; only show message if empty
      if (nodes.ecsWrap && !nodes.ecsWrap.list.hasChildNodes()) nodes.ecsWrap.list.textContent = 'Error loading ECS tables';
    }
  }
  // Poll less frequently to reduce flicker and DB load
  setInterval(renderEcs, 8000);
  renderEcs();

  // Backlog renderer (single implementation)
  async function renderNeeds(){
    try{
      const d = await fetchJson('/api/mud-needs-decoding?limit=200');
      if (!nodes.needsWrap) return;
      if (!d || d.exists === false){ setText(nodes.needsWrap.totals, 'No decoded DB yet'); nodes.needsWrap.body.textContent=''; return; }
      const items = Array.isArray(d.items)? d.items : [];
      setText(nodes.needsWrap.totals, `Backlog: ${fmt.num(items.length)} table(s)`);
      if (!items.length){ setText(nodes.needsWrap.body, 'All covered by typed tables — nice!'); return; }
      const key = (()=>{ try { return JSON.stringify(items.map(w=>[w.namespace,w.name,w.latest|0,w.values|0,w.tip|0])); } catch { return String(items.length) } })();
      if (nodes.needsWrap._key === key) return;
      const list = el('div', {});
      items.forEach((w)=>{
        const name = `${w.namespace}/${w.name}`;
        const base = Math.max(w.values|0, w.latest|0);
        list.appendChild(el('div', { className:'kv' },
          el('span', { className:'kv-name' }, name),
          el('span', { className:'kv-val' }, `${fmt.num(base)} rows · typed 0 · tip #${fmt.num(w.tip||0)}`)
        ));
      });
      nodes.needsWrap.body.replaceChildren(list);
      nodes.needsWrap._key = key;
    } catch {
      if (nodes.needsWrap && !nodes.needsWrap.body.hasChildNodes()) setText(nodes.needsWrap.body, 'Error loading backlog');
    }
  }
  setInterval(renderNeeds, 10000);
  renderNeeds();

  // World API renderer (polls /api/worldapi-stats)
  async function renderWorldApi(){
    try{
      const d = await fetchJson('/api/worldapi-stats');
      if (!nodes.worldApi) return;
      const counts = d && d.counts ? d.counts : null;
      const totalRows = Number(d && d.totalRows != null ? d.totalRows : 0);
      // Total tile
      const valNode = nodes.worldApi.total.querySelector('.value');
      if (valNode) setText(valNode, counts ? fmt.num(totalRows) : 'No data');
      // List
      const list = el('div', {});
      if (counts && typeof counts==='object' && Object.keys(counts).length){
        Object.entries(counts).sort((a,b)=> (b[1]|0)-(a[1]|0)).forEach(([k,v])=>{
          list.appendChild(el('div', { className:'kv' }, el('span', { className:'kv-name' }, String(k)), el('span', { className:'kv-val' }, fmt.num(v))));
        });
      } else {
        list.appendChild(el('div', { className:'muted' }, 'No data'));
      }
      nodes.worldApi.list.replaceChildren(list);
    } catch {
      // show no data only if empty
      if (nodes.worldApi && !nodes.worldApi.list.hasChildNodes()) nodes.worldApi.list.textContent = 'No data';
    }
  }
  setInterval(renderWorldApi, 10000);
  renderWorldApi();
})();
