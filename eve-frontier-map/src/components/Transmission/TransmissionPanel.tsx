import React, { useEffect, useRef, useState } from 'react';
import './TransmissionPanel.css';
import { track } from '../../utils/usage';
import { setTransmissionSeen, getPrefs, setTransmissionAudioMuted, setTransmissionAudioVolume } from '../../utils/prefs';

interface TransmissionPanelProps {
  onClose: () => void;
  onRoute: () => void;
  backgroundUrl?: string;
  stagingSystem: string;
  discordUrl: string;
  referralCode: string;
  tribeName: string;
  term: string;
  widthPx?: number;
  onReplayRegistered?: () => void;
  replayMode?: boolean;
}

// Larger pool of possible echo lines (mix of serious + light)
const ECHO_POOL:string[] = [
  '...still receiving? Good. Most sever link at first silence.',
  'If the map feels sparse that means you\u2019re early, not lost.',
  'Hazard note: an empty system only promises it was empty once.',
  'Navigation tip: boredom breeds sloppy d-scans. Rotate vigilance.',
  'If local spikes from zero to five: you didn\u2019t find a party, you became it.',
  'Fuel is cheaper than a public kill report. Over-prepare.',
  'Ping if you thread past the trade choke—we rotate scouts through near-misses.',
  'Silence is data. Write it down before memory edits it.',
  'Asteroid glow variance > rumor. Prospect with instruments, not hope.',
  'Your ship is a consumable; your map updates aren\u2019t. Prioritize accordingly.',
  'If you feel alone you\u2019re doing frontier correctly.',
  'Someone out there is faster; compensate by being more patient.',
  'Gate camps farm impatience. Don\u2019t be high-yield.',
  'Every detour you log saves a future hull. Earn quiet gratitude.',
  'Exploit window: before the guides get written.'
];

const INTRO_LINES = (o:{tribe:string; staging:string; discord:string; code:string; term:string}) => [
  '—— BEGIN BURST ——',
  `Neural handshake accepted. You\u2019re a fresh hull with a jump drive and nowhere sane to go.`,
  'Out there: tutorial grads piling gates, pirates farming impatience.',
  'Out here: open lanes, unburned anomalies, ore that hasn\u2019t been strip-mined twice today.',
  `We\u2019re ${o.tribe}. No doctrine. Just people pushing further.`,
  `Lock ${o.staging} as destination. Put distance between you and the noise.`,
  `Comms node: ${o.discord}`,
  `Referral code: ${o.code}`,
  'Hold channel open for more. Closing is allowed; deserting is routine.',
  '—— ECHO CHANNEL ARMED ——'
];

const TYPING_INTERVAL = 18;
const MASTER_GAIN = 0.5; // overall attenuation (50%)

const TransmissionPanel: React.FC<TransmissionPanelProps> = ({ onClose, onRoute, backgroundUrl, stagingSystem, discordUrl, referralCode, tribeName, term, widthPx, replayMode }) => {
  const fullTextRef = useRef('');
  const [displayText, setDisplayText] = useState('');
  const charIndexRef = useRef(0);
  const [typing, setTyping] = useState(true);
  const [doneIntro, setDoneIntro] = useState(false); // true once intro (including ARMED line) fully typed
  const [fast, setFast] = useState(false);
  const [show, setShow] = useState(true);
  const prefs = getPrefs() as any;
  const [muted, setMuted] = useState<boolean>(()=> !!prefs.transmissionAudioMuted);
  // Fallback default lowered to 0.25 (matches new prefs default) if no stored preference.
  const [volume, setVolume] = useState<number>(()=> typeof prefs.transmissionAudioVolume==='number'? prefs.transmissionAudioVolume:0.25);
  const ambientRef = useRef<HTMLAudioElement|null>(null);
  const glitchBuffersRef = useRef<HTMLAudioElement[]>([]);
  const glitchTimeoutRef = useRef<any>(null);
  const majorGlitchTimeoutRef = useRef<any>(null);
  const phaseTimerRef = useRef<any>(null);
  const [majorGlitchKey, setMajorGlitchKey] = useState(0);
  const textRef = useRef<HTMLPreElement|null>(null);
  // Guard: track whether this mounted instance is in intro mode (immutable after first determination)
  const introModeRef = useRef<boolean>(false);
  // Simple diagnostic event log (bounded) exposed on window for debugging spontaneous restarts
  const logEvent = (type:string, extra:Record<string,any>={}) => {
    try {
      const w = window as any;
      if(!w.__efTxLog) w.__efTxLog = [];
      const arr:any[] = w.__efTxLog;
      if(arr.length > 400) arr.splice(0, arr.length-400); // keep last 400
      const entry = { t: Date.now(), type, ...extra } as any;
      // Attach a short stack for critical events to help trace unintended replays
      if(type === 'intro_init' || type === 'replay_trigger' || type === 'unexpected_intro_reinit_attempt' || type==='illegal_intro_restart'){
        try { entry.stack = (new Error().stack||'').split('\n').slice(1,6); } catch {}
      }
      arr.push(entry);
      // Also echo to console for immediate visibility (prefixed)
      try { if((window as any).__EF_TX_DEBUG!==false) console.debug('[tx]', type, extra); } catch {}
    } catch {}
  };

  // Refs to reflect live state inside loops without re-registering timers
  const typingRef = useRef(typing); useEffect(()=>{ typingRef.current = typing; },[typing]);
  const mutedRef = useRef(muted); useEffect(()=>{ mutedRef.current = muted; },[muted]);
  const doneIntroRef = useRef(doneIntro); useEffect(()=>{ doneIntroRef.current = doneIntro; },[doneIntro]);
  const echoQueueRef = useRef<string[]>([]); // shuffled remaining lines
  const echoTimerRef = useRef<any>(null);
  const echoTypingRef = useRef<boolean>(false); // true while an echo is being typed
  const hasIntroInitializedRef = useRef<boolean>(false); // guard intro init
  // Detect React 18 StrictMode dev double-mount (mount -> unmount -> mount sequence in quick succession).
  const lastMountTimeRef = useRef<number>(0);
  const strictDoubleMountRef = useRef<boolean>(false);
  const finalizeIntroOnceRef = useRef<boolean>(false); // ensure intro_complete side effects run only once

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Helper to (re)construct randomized phases
  const reshuffleEchoes = () => {
    const shuffled = [...ECHO_POOL].sort(()=>0.5-Math.random());
    echoQueueRef.current = shuffled;
  };
  const initIntro = () => {
    if(hasIntroInitializedRef.current){
      // Suppress noise if this is the intentional React StrictMode development double-mount.
      if(!strictDoubleMountRef.current){
        logEvent('unexpected_intro_reinit_attempt');
      } else {
        logEvent('strictmode_intro_reinit');
      }
      return;
    }
    hasIntroInitializedRef.current = true;
    const intro = INTRO_LINES({ tribe:tribeName, staging:stagingSystem, discord:discordUrl, code:referralCode, term });
    fullTextRef.current = intro.join('\n');
    charIndexRef.current = 0;
    setDoneIntro(false);
    logEvent('intro_init');
    // NOTE: we now delay writing transmissionSeenHard until intro fully completes to avoid dev StrictMode second mount skipping intro.
  };

  // Initialize phases + audio once
  useEffect(()=>{
  // Stop any lingering previous transmission audio (dev HMR or replay race)
  try { (window as any).__efStopTxAudio && (window as any).__efStopTxAudio(); } catch {}
  // Hard + session guards
  let hardSeen = false;
  try { hardSeen = (window as any).localStorage.getItem('transmissionSeenHard') === '1'; } catch {}
  // pageLoadDone no longer needed; replay freshness gating via timestamp
  // Simplified: no sentinel/allow gates; rely solely on hardSeen + explicit fresh replay flag.
  // Replay freshness: require timestamp within 2s of mount to treat as intentional replay.
  let userReplay = false;
  try {
    const flag = (window as any).__efUserReplay === true && replayMode;
    const ts = (window as any).__efUserReplayTS;
  userReplay = !!flag && typeof ts === 'number' && (Date.now() - ts) < 5000; // 5s freshness window for replay
    if(flag && !userReplay){
      // Stale replay flag leaked across remount; clear it.
      (window as any).__efUserReplay = false; (window as any).__efUserReplayTS = 0;
    }
  } catch {}
  const alreadySeen = (hardSeen || !!prefs.transmissionSeen) && !userReplay;
  // Determine intro mode only once per mount
  introModeRef.current = !alreadySeen; // true if we will run intro on this mount
  const now = Date.now();
  if(lastMountTimeRef.current && now - lastMountTimeRef.current < 120){
    // Likely dev strict mode double mount cycle
    strictDoubleMountRef.current = true;
  }
  lastMountTimeRef.current = now;
  logEvent('mount', { replayMode: userReplay, alreadySeen, introMode:introModeRef.current, strictDouble: strictDoubleMountRef.current });
  try { (window as any).__efTxFirstPageLoadDone = true; } catch {}
  // Consume one-shot replay flag so accidental remounts cannot reuse it.
  if(userReplay){ try { (window as any).__efUserReplay = false; (window as any).__efUserReplayTS = 0; } catch {} }
  if(alreadySeen){
    // Echo-only mode (no intro, no audio) – show armed line once.
    fullTextRef.current = '—— ECHO CHANNEL ARMED ——';
    setDisplayText(fullTextRef.current);
    setDoneIntro(true);
    setTyping(false);
    reshuffleEchoes();
    scheduleNextEcho();
  logEvent('echo_only_start', { reason: hardSeen? 'hard_seen' : 'prefs_seen' });
  } else {
    initIntro();
    reshuffleEchoes();
  }
    try { track({ type:'transmission_show' }); } catch {}
    // Audio init
    try {
      if(introModeRef.current){ // Only load audio if we will actually play intro
        const amb = new Audio('/audio/transmission/transmission_ambient.mp3'); amb.loop = true; amb.volume = muted?0:volume*MASTER_GAIN; ambientRef.current = amb;
        const g1 = new Audio('/audio/transmission/glitch1.mp3'); const g2 = new Audio('/audio/transmission/glitch2.mp3'); const g3 = new Audio('/audio/transmission/glitch3.mp3');
        [g1,g2,g3].forEach(a=>{ a.preload='auto'; a.volume = muted?0:Math.min(1, volume*0.6*MASTER_GAIN); });
        glitchBuffersRef.current = [g1,g2,g3];
      }
    } catch {/* ignore */}

    if(reducedMotion){
      const introAll = fullTextRef.current; setDisplayText(introAll); setDoneIntro(true); setTyping(false); setTransmissionSeen(); scheduleNextEcho(); try { track({ type:'transmission_complete' }); } catch {}; return;
    }
    if(introModeRef.current){
      startTypingLoop();
    }
    // Diagnostics helpers
    try {
      (window as any).__efTxGetLog = () => (window as any).__efTxLog ? [...(window as any).__efTxLog] : [];
      (window as any).__efTxDump = () => { const log = (window as any).__efTxLog||[]; console.table(log); return log; };
    } catch {}
    // Start glitch schedulers
    if(introModeRef.current){
      scheduleGlitch();
      scheduleMajorGlitch();
    }
    // Expose global helpers for debugging & future cleanup
    (window as any).__efStopTxAudio = () => {
      if(ambientRef.current){ try { ambientRef.current.pause(); ambientRef.current.currentTime = 0; } catch {} }
      glitchBuffersRef.current.forEach(a=>{ try { a.pause(); a.currentTime = 0; } catch {} });
    };
    (window as any).__efTxActive = () => ({
      ambient: ambientRef.current? { vol: ambientRef.current.volume, muted: ambientRef.current.muted, paused: ambientRef.current.paused, t: ambientRef.current.currentTime }: null,
      glitches: glitchBuffersRef.current.map(g=>({ vol:g.volume, muted:g.muted, paused:g.paused, t:g.currentTime, src: g.src.split('/').pop() }))
    });

    return ()=>{
      if(glitchTimeoutRef.current) clearTimeout(glitchTimeoutRef.current);
      if(majorGlitchTimeoutRef.current) clearTimeout(majorGlitchTimeoutRef.current);
  if(phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
  if(echoTimerRef.current) clearTimeout(echoTimerRef.current);
      // Teardown audio fully to avoid layering on remount (HMR / navigation)
      (window as any).__efStopTxAudio && (window as any).__efStopTxAudio();
      // Release sources (avoid holding references)
      glitchBuffersRef.current = [];
      ambientRef.current = null;
      logEvent('unmount');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety override: if intro somehow starts again after being seen, convert to echo-only immediately.
  useEffect(()=>{
    try {
      const hard = (window as any).localStorage.getItem('transmissionSeenHard')==='1';
      if(hard && introModeRef.current && !replayMode){
        introModeRef.current = false;
        setTyping(false);
        setDoneIntro(true);
        if(!fullTextRef.current.includes('ECHO CHANNEL ARMED')){
          fullTextRef.current = '—— ECHO CHANNEL ARMED ——';
          setDisplayText(fullTextRef.current);
        }
        if(!echoTimerRef.current && !echoTypingRef.current){
          reshuffleEchoes();
          scheduleNextEcho();
        }
        logEvent('override_intro_abort', { hard });
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayText]);

  const startTypingLoop = () => {
    setTyping(true);
  if(introModeRef.current && !doneIntroRef.current && ambientRef.current && !mutedRef.current){
      ambientRef.current.currentTime = 0; ambientRef.current.volume = volume*MASTER_GAIN;
      ambientRef.current.play().then(()=>{ try { track({ type:'transmission_audio_play' }); } catch {}; }).catch(()=>{
        // Retry after short delay (autoplay blocked until user interacts)
        setTimeout(()=>{ try { ambientRef.current && ambientRef.current.play().catch(()=>{}); } catch {} }, 1000);
      });
    }
    charIndexRef.current = displayText.length; // resume from current length (0 on fresh)
    const tick = () => {
      if(!typingRef.current) return;
      const targetLen = fullTextRef.current.length;
      if(charIndexRef.current >= targetLen){
        // Phase finished
        setTyping(false);
        if(!doneIntroRef.current && !finalizeIntroOnceRef.current){
          finalizeIntroOnceRef.current = true; // idempotent guard
          setDoneIntro(true);
          setTransmissionSeen();
          try { (window as any).localStorage.setItem('transmissionSeenHard','1'); } catch {}
          try { track({ type:'transmission_complete' }); } catch {};
          if(ambientRef.current){ try { ambientRef.current.pause(); ambientRef.current.currentTime = 0; } catch {} }
          scheduleNextEcho();
          logEvent('intro_complete');
          introModeRef.current = false;
        } else if(!doneIntroRef.current && finalizeIntroOnceRef.current){
          // Edge: we reached finalize path again (dev strict effects); just ensure ambient stopped + schedule echo once.
          if(ambientRef.current){ try { ambientRef.current.pause(); ambientRef.current.currentTime = 0; } catch {} }
        }
        return;
      }
      const advance = fast ? 24 : 1; // much faster when fast-forwarding
      charIndexRef.current = Math.min(targetLen, charIndexRef.current + advance);
      const nextSlice = fullTextRef.current.slice(0, charIndexRef.current);
      setDisplayText(nextSlice);
      const lastChar = nextSlice[charIndexRef.current-1];
      const delay = fast ? 0 : (lastChar==='\n' ? 170 : TYPING_INTERVAL + Math.random()*40);
      setTimeout(tick, delay);
    };
    setTimeout(tick, 350);
  };

  const scheduleGlitch = () => {
    const run = () => {
      const baseDelay = 1100 + Math.random()*2000;
      glitchTimeoutRef.current = setTimeout(()=>{
        // Apply visual glitch even if done (per requirement), but audio only while typing
        if(fullTextRef.current.length){
          setDisplayText(prev => {
            if(!prev) return prev;
            const chars = prev.split('');
            const count = Math.min(3, 1+Math.floor(Math.random()*3));
            for(let m=0;m<count;m++){
              const idx = Math.floor(Math.random()*chars.length);
              if(chars[idx]==='\n') continue;
              const noise = ['#','%','@','*','/','\\','?','Ω','§'];
              chars[idx] = noise[Math.floor(Math.random()*noise.length)];
            }
            const glitched = chars.join('');
            setTimeout(()=>{ setDisplayText(cur => cur===glitched ? prev : cur); }, 80+Math.random()*40);
            // audio burst only while actively typing during intro
            if(introModeRef.current && typingRef.current && !mutedRef.current && glitchBuffersRef.current.length){
              const pick = glitchBuffersRef.current[Math.floor(Math.random()*glitchBuffersRef.current.length)];
              try { pick.currentTime = 0; pick.play().catch(()=>{}); } catch {}
            }
            return glitched;
          });
        }
        run();
      }, baseDelay);
    };
    run();
  };

  const scheduleMajorGlitch = () => {
    const loop = () => {
      const delay = 6000 + Math.random()*5000;
      majorGlitchTimeoutRef.current = setTimeout(()=>{ triggerMajorGlitch(); loop(); }, delay);
    };
    loop();
  };

  const triggerMajorGlitch = () => {
  // Visual major glitch continues after completion; audio + tracking only during intro typing
  if(introModeRef.current && typingRef.current){ try { track({ type:'transmission_major_glitch' }); } catch {} }
    setMajorGlitchKey(k=>k+1);
    const current = displayText;
    if(!current) return;
    const symbols = '!@#$%^&*()_+{}<>?/[]≈§∆Ω▒▓░█';
    const scrambled = current.split('').map(c=> c==='\n'? '\n' : symbols[Math.floor(Math.random()*symbols.length)]).join('');
    setDisplayText(scrambled);
    if(introModeRef.current && typingRef.current && !mutedRef.current && glitchBuffersRef.current.length){
      const picks = [...glitchBuffersRef.current].sort(()=>0.5-Math.random()).slice(0,2);
      picks.forEach(p=>{ try { p.currentTime=0; p.play().catch(()=>{}); } catch {} });
    }
    setTimeout(()=>{ setDisplayText(current); if(textRef.current){ textRef.current.classList.add('tx-text-glitch'); setTimeout(()=> textRef.current && textRef.current.classList.remove('tx-text-glitch'), 220); } }, 140);
  };

  const scheduleNextEcho = () => {
    if(!show) return;
    if(echoTypingRef.current){ logEvent('echo_schedule_skipped_typing'); return; }
    if(echoTimerRef.current){ clearTimeout(echoTimerRef.current); echoTimerRef.current=null; }
    const delay = 15000 + Math.random()*30000; // 15s to 45s
    echoTimerRef.current = setTimeout(()=>{ appendNextEcho(); }, delay);
    logEvent('echo_scheduled', { delay });
  };

  const appendNextEcho = () => {
  if(echoTypingRef.current){ logEvent('echo_append_ignored', { reason:'typing' }); return; }
    if(echoTimerRef.current){ clearTimeout(echoTimerRef.current); echoTimerRef.current=null; }
    if(!echoQueueRef.current.length){ reshuffleEchoes(); }
    const line = echoQueueRef.current.shift();
    if(!line){ scheduleNextEcho(); return; }
    const prefix = fullTextRef.current.endsWith('\n')? '' : '\n';
    fullTextRef.current = fullTextRef.current + prefix + line;
    charIndexRef.current = displayText.length;
    setTyping(true);
    echoTypingRef.current = true;
    startTypingEchoSegment();
    logEvent('echo_append', { line });
  };

  const startTypingEchoSegment = () => {
    const tick = () => {
      if(!typingRef.current) return;
      const targetLen = fullTextRef.current.length;
      if(charIndexRef.current >= targetLen){
        setTyping(false);
        echoTypingRef.current = false;
        logEvent('echo_typing_complete');
        scheduleNextEcho();
        return;
      }
      const advance = fast ? 24 : 1;
      charIndexRef.current = Math.min(targetLen, charIndexRef.current + advance);
      setDisplayText(fullTextRef.current.slice(0, charIndexRef.current));
      const lastChar = fullTextRef.current[charIndexRef.current-1];
      const delay = fast ? 0 : (lastChar==='\n' ? 170 : TYPING_INTERVAL + Math.random()*40);
      setTimeout(tick, delay);
    };
    setTimeout(tick, 200);
    logEvent('echo_typing_start');
  };

  const handleSkip = () => {
    if(!fast){ setFast(true); try { track({ type:'transmission_skip' }); } catch {} }
    // If still in intro, accelerate and also cut ambient immediately.
    if(!doneIntroRef.current){
      if(ambientRef.current){ try { ambientRef.current.pause(); ambientRef.current.currentTime = 0; } catch {} }
      logEvent('skip_fastforward');
    } else if(!typingRef.current && doneIntroRef.current){
      // (Should not normally show button post-intro, but defensive): trigger immediate echo.
      if(echoTimerRef.current){ clearTimeout(echoTimerRef.current); echoTimerRef.current=null; }
      appendNextEcho();
    }
  };

  // Illegal restart detector: if intro finished & we later detect typing from index 0 with BEGIN BURST prefix, log
  useEffect(()=>{
    const check = () => {
      try {
        if(doneIntroRef.current && !introModeRef.current){
          // If for some reason introMode flips back or text resets, catch early
          if(displayText.startsWith('—— BEGIN BURST ——') && charIndexRef.current < 10){
            logEvent('illegal_intro_restart', { charIndex: charIndexRef.current, introMode:introModeRef.current, doneIntro:doneIntroRef.current });
          }
        }
      } catch {}
      setTimeout(check, 2000);
    };
    setTimeout(check, 2000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = () => {
    setShow(false);
    onClose();
  try { track({ type:'transmission_dismiss' }); } catch {}
    setTransmissionSeen();
  };

  const toggleMute = () => {
    const nv = !muted; setMuted(nv); setTransmissionAudioMuted(nv);
    try { track({ type: nv? 'transmission_audio_mute':'transmission_audio_unmute' }); } catch {}
    if(ambientRef.current){
      ambientRef.current.muted = nv;
  ambientRef.current.volume = nv?0:volume*MASTER_GAIN;
      if(!nv && typingRef.current){ ambientRef.current.currentTime=0; ambientRef.current.play().then(()=>{ try { track({ type:'transmission_audio_play' }); } catch {}; }).catch(()=>{}); } else { ambientRef.current.pause(); }
    }
  glitchBuffersRef.current.forEach(a=>{ a.muted = nv; a.volume = nv?0:Math.min(1, volume*0.6*MASTER_GAIN); });
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)/100;
    setVolume(v);
    setTransmissionAudioVolume(v);
    if(v === 0){
      if(!muted){ setMuted(true); setTransmissionAudioMuted(true); }
      if(ambientRef.current){ ambientRef.current.muted = true; ambientRef.current.volume = 0; ambientRef.current.pause(); }
      glitchBuffersRef.current.forEach(a=>{ a.muted = true; a.volume = 0; });
    } else {
      if(muted){ setMuted(false); setTransmissionAudioMuted(false); }
  if(ambientRef.current){ ambientRef.current.muted = false; ambientRef.current.volume = v*MASTER_GAIN; if(typingRef.current){ ambientRef.current.play().catch(()=>{}); } }
  glitchBuffersRef.current.forEach(a=>{ a.muted = false; a.volume = Math.min(1, v*0.6*MASTER_GAIN); });
    }
  };

  // Sync volumes anytime state changes (defensive against missed handlers)
  useEffect(()=>{
  if(ambientRef.current){ ambientRef.current.muted = muted; ambientRef.current.volume = muted?0:volume*MASTER_GAIN; }
  glitchBuffersRef.current.forEach(a=>{ a.muted = muted; a.volume = muted?0:Math.min(1, volume*0.6*MASTER_GAIN); });
  }, [muted, volume]);

  // Debug helper for manual inspection in console
  useEffect(()=>{
    (window as any).__efTxAudioDebug = () => ({
      muted,
      volume,
      ambient: ambientRef.current ? { volume: ambientRef.current.volume, paused: ambientRef.current.paused } : null,
      glitches: glitchBuffersRef.current.map(g=>({ src: g.src.split('/').pop(), volume: g.volume, paused: g.paused }))
    });
  }, [muted, volume]);

  const handleDiscord = () => { try { track({ type:'transmission_link_click' }); } catch {}; };
  const handleRoute = () => { try { track({ type:'transmission_route_click' }); } catch {}; onRoute(); };

  // Auto-scroll to bottom when new text is appended
  useEffect(()=>{
    if(textRef.current){
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [displayText]);

  if(!show) return null;

  return (
    <div className="transmission-wrapper" role="dialog" aria-label="Incoming transmission" aria-live="polite" style={widthPx?{width: widthPx+'px', maxWidth: widthPx+'px'}:undefined}>
      <div className="transmission-bg" style={backgroundUrl?{ backgroundImage:`url(${backgroundUrl})`}:{}} />
      <div className="transmission-overlay" />
      <div className="transmission-content">
        <div className="transmission-header">
          <div className="signal"><span className="dot" /><span className="dot" /><span className="dot" /></div>
          <div className="title">Incoming Transmission</div>
          <div className="spacer" />
          {replayMode && <div className="tx-replay-badge" aria-label="Replay">Replay</div>}
          <button className="tx-btn subtle" onClick={toggleMute} aria-label={muted? 'Unmute transmission audio':'Mute transmission audio'} style={{marginRight:4}}>{muted? 'Unmute':'Mute'}</button>
          <input type="range" min={0} max={100} step={1} value={Math.round(volume*100)} aria-label="Transmission volume" onChange={handleVolumeChange} style={{width:90, marginRight:4}} />
          {typing && !doneIntro && <button className="tx-btn subtle" onClick={handleSkip} aria-label="Fast forward transmission">Fast&nbsp;Forward</button>}
          <button className="tx-btn close" onClick={handleDismiss} aria-label="Dismiss transmission" style={{marginLeft:'auto'}}>✕</button>
        </div>
  <pre ref={textRef} className="transmission-text" style={{overflowY:'auto'}}>{displayText}{typing && !reducedMotion && <span className="cursor" />}</pre>
        <div className="transmission-actions">
          <button className="tx-btn primary" onClick={handleRoute} aria-label="Plot route to staging system">Plot Route to {stagingSystem}</button>
          <a className="tx-btn link" href={discordUrl} target="_blank" rel="noopener noreferrer" onClick={handleDiscord} aria-label="Open Discord link">Join {tribeName} Discord</a>
          <div className="ref-code" aria-label="Referral code">Ref: <strong>{referralCode}</strong></div>
        </div>
        <div className="transmission-footer">Dismiss anytime. Replay from pill.</div>
      </div>
      <div key={majorGlitchKey} className="tx-major-glitch" />
    </div>
  );
};

export default TransmissionPanel;
