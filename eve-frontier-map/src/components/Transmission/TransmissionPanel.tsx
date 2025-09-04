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
  // replayMode: when true we ALWAYS run full intro (audio + typing) even if previously seen.
  replayMode?: boolean;
}

// Larger pool of possible echo lines (mix of serious + light)
const ECHO_POOL:string[] = [
  // Core original set
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
  'Exploit window: before the guides get written.',
  // Recruitment / referral nudges
  'Referral code still un-entered? Whisper “${REF_CODE}” to the void. Sometimes the void gives back.',
  'Leaderboard rumor: pilots who paste ${REF_CODE} into sign-up menus jump 7% further (citation: none).',
  'Broadcast etiquette: subtle recruitment beats spam. This message is neither. Use ${REF_CODE}.',
  // CCP personalities
  'CCPJotunn survival record: 04:59. Stopwatch still warm. Send him a clock emoji—tactically.',
  'CCPJotunn tried a “come kill me” and galaxy answered “ok”. Four minutes, fifty‑nine seconds of legend.',
  'If you last longer than CCPJotunn in hostile space today, brag responsibly.',
  'CCPOverload is Scottish. This scientifically increases server stability and soup quality.',
  'CCPOverload accent adds +5% warp alignment speed (placebo tier).',
  // Tribes / factions humor
  'Reapers claim elite status; killboard shows elite rookie recycling. Adjust awe downward.',
  'Reapers shot me twice. Statistical sample agrees: not actually gods.',
  'Reapers doctrine: “If it moves and is new, delete it.” Inspirational stuff.',
  'EXTI accepts everyone. Democratic rock reduction collective. Their ore piles vote unanimously.',
  'Field report: Diddy McCoy replied to a tactical ping with nine GIFs and zero verbs.',
  'Several pilots enabled "hide media" after Diddy McCoy achieved 300% GIF saturation in one thread.',
  'Diddy McCoy communication pattern detected: image, image, image, faint hope of a noun, image.',
  'Rumor: Diddy McCoys keyboard only has arrow keys and a GIF macro bar.',
  'Analytics: blocking Diddy McCoy reduces ambient channel motion by 47%. Science still verifying.',
  'Join EXTI if you want to mine, chat about mining, or schedule future mining while mining.',
  'X tactical briefings: which rock is handsomest today.',
  'Saints: respectable hull poppers. Shots traded. Salutes exchanged. Keep flying, Saints.',
  'Saints once volleyed my scout, then sent fuel money. Mixed feelings. Mostly respect.',
  'ProtoDroid will hack your ship open if you lock yourself out. Invoice arrives before air returns.',
  'Lost your access codes? ProtoDroid can help. You can afford the fee, probably.',
  'Diddy McCoy only speaks GIF. Linguists baffled. Diplomats exhausted.',
  'AWAR: American timezone density wave. Friendly. Mildly obsessed with claiming Scottish ancestry.',
  'Every AWAR pilot: “I have a Scottish great‑something.” Statistical improbability accepted politely.',
  // Channels / help
  'Need map help? In-game channel EF-MAP. Type, ask, resist apologizing for basic questions.',
  'WSTART channel: ambient newcomers hum. Drop intel crumbs; they grow routes.',
  'EF-MAP answers “Why is my route weird?” WSTART answers “Am I alone?”',
  // Flavor / universe ambience
  'An empty D-scan is a lullaby AND an alarm bell. Interpret creatively.',
  'Bookmark gas. Future you might be poor, bored, or both.',
  'Jump fuel math error? That’s how ghost beacons are born.',
  'Mining alone? Align something. Future you will sign a thank-you note.',
  'If your probe spread looks like spilled cereal, recalibrate.',
  'Space boredom stage 3: naming rocks. Stage 4: arguing with them.',
  'Route planner says “7 jumps”; your panic says “17”. Believe the planner.',
  'Clutter your overview with purpose, not procrastination.',
  'The universe won’t congratulate you for scanning that ghost site. I will: nice work.',
  'Amateurs spam warp. Professionals coast patience.',
  // Over-the-top recruitment satire
  'JOIN WOLF: unlimited existential dread, occasional loot, 100% fewer gate taxes (not legally binding).',
  'Propaganda voice: “Only with us will you transcend.” Reality voice: bring snacks and curiosity.',
  'Mandatory daily chant banned. We replaced it with optional silence.',
  'Advance your career: cartographer, anomaly looter, rock whisperer. Or idle. We notice neither.',
  // Meta humor
  'If this window is still open, curiosity > impulse closure. That’s scout DNA.',
  'Echo channel algorithm: shuffled lines + mild concern for your attention span.',
  'Somewhere a Reaper is refreshing killboard stats instead of scouting. Use that window.',
  'If an echo line repeats, blame quantum narrative drift. Or my shuffle.',
  // Light taunts / playful
  'Reapers, if you’re reading this, recruit an industrialist. Your hangars look hungry.',
  'Dear EXTI: diversify. Even your drones are bored.',
  'EXTI orientation packet reportedly just a sticky note: "Mine. Ask later."',
  'EXTI rookies mining AFK to afford ships they will never undock. Bold long-term strategy.',
  'Analyst note: EXTI referral codes experiencing “transient quantum desynchronization.” Sure they are.',
  'EXTI logistics claims the ore is for everyone. Accountants quietly nod and lock another vault.',
  'EXTI fleet doctrine: six barges, one hauler, zero clue who9s in charge.',
  'Insider ping: EXTI promoted a rookie for correctly spelling “isogen.” Meritocracy alive.',
  'Saints, keep the respectful volleys coming. Sharpened iron, etc.',
  'ProtoDroid, stop rooting around my nav buffers. They tickle.',
  'Diddy: send a non-GIF once. For science.',
  'AWAR pilots, submit genealogy proofs in triplicate before next clan claim.',
  // Referral playful pushes
  'Referral whispers echo farther. ${REF_CODE} into the dark and maybe the dark funds your hull.',
  'Statistically someone reading this still hasn’t used ${REF_CODE}. Astronomical oversight.',
  // Situational / utility
  'If route fuel math feels tight: add a detour now, not stranded later.',
  'Rotate d-scan angles. Straight lines breed complacency.',
  'Never warp gate-to-gate sleepy. Predators love autopilot souls.',
  'An aligned exit vector is free insurance. Align while you read this line.',
  'Cache a safe spot mid-pipe. Future pursuit might thank you.',
  // Shorties / breathers
  'Silence isn’t empty.',
  'You are earlier than you feel.',
  'Intel ages fast; notes age slow.',
  'Refuel before “maybe later”.',
  'Your boredom feeds hunters.',
  'Patience mines safer ore.',
  // Closing style variety
  'Ping when you arrive. Or don’t. The map will know.',
  'If you read all these lines you’re already learning: persistence.',
  'Still here? You’ll make it out here.',
  // New personalities & lore additions
  'Michael JD: CEO in real life AND in-game. Someone stage an intervention.',
  'Reapers HR department (Michael JD) still reviewing my “stop shooting newbies” memo.',
  'Michael JD and Diddy McCoy: dynamic duo or hostage situation? Jury out.',
  'Okky the master web artisan is “optimizing” this very second. Delivery ETA: eventually.',
  'If a feature takes ages to appear, assume Okky is polishing pixels with a jeweler’s loupe.',
  'Marcus Caswell emits pure Bitter Vet ions. Stand too close: skill queue regrets increase.',
  'Marcus Caswell reminder: nostalgia isn’t a fitting module.',
  'DaemonXel flies with a flat cap. Aerodynamics: irrelevant. Style: maximal.',
  'Flat caps in a vacuum are the new meta. DaemonXel proved it.',
  'Rezvani still answering rookie questions #4387. Has anyone checked if he sleeps?',
  'If Rezvani replies before you finish typing, accept the blessing and continue.',
  'Vulture’s Byron jump-started this map. Salute the quiet coders before the loud brawlers.',
  'Byron fact: wrote code while others debated logo shade #3 vs #4.',
  'CCPlease hunters seeking “fair fights”: adorable. Bring asymmetry and fireworks.',
  'Fair fights are museum pieces. We curate improvised outcomes.',
  'Content curators requesting parity again. Suggest escalation instead.',
  'If your battle felt balanced you misallocated potential chaos.',
  'Rumor: Rezvani paid in secret loyalty points. Evidence: none. Output: heroic.',
  'Michael JD quarterly review: needs improvement in “letting rookies live 10 minutes”.',
  // Michael JD new playful lines (mom jokes avoided / kept light & lore-friendly)
  'Rumor: Michael JD spotted docking at GTV5. Probably just optimizing tax strategy. Probably.',
  'Station buzz: someone saw Michael JD near the red sector promenade at GTV5. Corporate reconnaissance, surely.',
  'Encrypted memo: "Tell Michael JD his mom waved from GTV5 concourse." Transmission ends abruptly.',
  'Local chatter: Michael JD filing a petition to rename a deck at GTV5 after his mom. Ambitious branding move.',
  'Market feed blip: GTV5 cafe now selling "JD Special". Contents classified. Flavor reportedly unstoppable.',
  'DaemonXel flat cap telemetry suggests +2% targeting swagger.',
  'Okky sprint update: “refactoring the refactor”. Send snacks.',
  'Marcus Caswell has a story beginning with “Back when modules were heavier…”',
  'Byron debug mantra: “Reproduce, reduce, remove.” Works on bugs AND toxic gate camps.',
  'If EF-MAP answers you first it was probably Rezvani. If second, still Rezvani with cooldown.',
];

const INTRO_LINES = (o:{tribe:string; staging:string; discord:string; code:string; term:string}) => [
  '—— BEGIN BURST ——',
  'Signal acquisition… narrow-beam… static… whatever. I\u2019m broadcasting anyway.',
  'If you can read this you probably just crawled out of the tutorial cradle with a jump drive and zero plan.',
  'Behind you: clustering rookies, gate camps farming impatience, recycled ore veins getting their third strip today.',
  'Ahead: unsurveyed pockets, fat anomalies, belts that still smell like geology instead of industry.',
  `I\u2019m with ${o.tribe}. No doctrine. No motivational holos. Just stubborn Riders pushing further.`,
  `Primary rendezvous: set destination ${o.staging}. That vector gets you off the noise lanes.`,
  'It is a haul. You WILL burn fuel. Refuel smart; panic warps cost more than isotopes.',
  'Expect stretches of absolutely nothing. That\u2019s normal. Nothing means you\u2019re early, not lost.',
  'Your ship is consumable. Your map intel isn\u2019t. Trade hull confidence for better notes.',
  `Web map tool you\u2019re in: I built it so fresh hulls could plot the jump corridor out here without begging corp chat.`,
  'Need app help (search quirks, routing oddities)? In-game channel: EF-MAP (type it exactly with the hyphen).',
  'Want live chatter / immediate orientation pings? Join channel WSTART (caps). If it\u2019s quiet, log observations anyway.',
  `Discord uplink: ${o.discord}`,
  `Referral tag (paste somewhere respectable): ${o.code}`,
  'When you arrive: fewer eyes, fatter rocks, slower hunters. Different game. Still deadly—just honest about it.',
  'If this beam feels one-way, good. Broadcast discipline keeps predators lazy.',
  'Leave the window open. Echo channel will drip more fragments while I range scan. Close it if you hate flavor text.',
  'Plot route, prep fuel, and move. History doesn\u2019t bookmark systems that waited.',
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
  // Debug logging now disabled by default; set window.__EF_TX_DEBUG = true in console to re-enable granular traces
  try { if((window as any).__EF_TX_DEBUG === true) console.debug('[tx]', type, extra); } catch {}
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
  // Echo delta typing: store immutable base text + new line delta so we never retrace prior characters
  const echoBaseTextRef = useRef<string>('');
  const echoDeltaRef = useRef<string>('');
  const echoDeltaIndexRef = useRef<number>(0);
  // Detect React 18 StrictMode dev double-mount (mount -> unmount -> mount sequence in quick succession).
  const lastMountTimeRef = useRef<number>(0);
  const strictDoubleMountRef = useRef<boolean>(false);
  const finalizeIntroOnceRef = useRef<boolean>(false); // ensure intro_complete side effects run only once

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Helper to (re)construct randomized phases
  const reshuffleEchoes = () => {
    const code = referralCode || '';
    const shuffled = [...ECHO_POOL]
      .map(l=> code? l.replace(/\$\{REF_CODE\}/g, code) : l)
      .sort(()=>0.5-Math.random());
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
  // Simplify replay semantics: if parent passes replayMode=true we force full intro regardless of hard/prefs seen flags.
  try { userReplay = !!replayMode; } catch {}
  // Attempt early restore of persisted state (covers accidental remount / HMR without forcing intro re-run).
  let restoredPersisted = false;
  try {
    if(!userReplay){
      const persist = (window as any).__efTxPersist;
      if(persist && typeof persist === 'object' && typeof persist.text === 'string' && persist.introComplete){
        restoredPersisted = true; // we'll apply after mount effect state setters
      }
    }
  } catch {}
  const alreadySeen = userReplay ? false : (restoredPersisted || hardSeen || !!prefs.transmissionSeen || (():boolean=>{ try { return (window as any).__efTxIntroComplete === true; } catch { return false; } })());
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
  // Legacy global flags no longer used – clear any stale values defensively.
  try { (window as any).__efUserReplay = false; (window as any).__efUserReplayTS = 0; } catch {}
  if(userReplay){
    // Explicit replay resets global completion marker so intro will run fresh.
    try { (window as any).__efTxIntroComplete = false; } catch {}
  }

  if(alreadySeen && !userReplay){
    // Echo-only mode (no intro, no audio).
    // Attempt to restore prior echo state (dev StrictMode remount or accidental re-render) from window singleton.
    try {
      const persisted = (window as any).__efTxEchoState;
      if(persisted && typeof persisted === 'object' && typeof persisted.text === 'string' && persisted.text.includes('ECHO CHANNEL ARMED')){
        fullTextRef.current = persisted.text;
        setDisplayText(persisted.text);
        setDoneIntro(true);
        setTyping(false);
        echoQueueRef.current = persisted.queue && Array.isArray(persisted.queue) && persisted.queue.length ? persisted.queue : [];
        const remaining = typeof persisted.nextDue === 'number' ? (persisted.nextDue - Date.now()) : NaN;
        if(!isNaN(remaining) && remaining > 200){
          // schedule echo with remaining delay
          scheduleNextEcho(remaining);
          logEvent('echo_state_restored', { remaining });
        } else {
          // schedule immediate (with small debounce) to keep cadence
          scheduleNextEcho(800 + Math.random()*400);
          logEvent('echo_state_restored_immediate');
        }
      } else {
        fullTextRef.current = '—— ECHO CHANNEL ARMED ——';
        setDisplayText(fullTextRef.current);
        setDoneIntro(true);
        setTyping(false);
        reshuffleEchoes();
        scheduleNextEcho();
        logEvent('echo_only_start', { reason: hardSeen? 'hard_seen' : 'prefs_seen' });
      }
    } catch {
      fullTextRef.current = '—— ECHO CHANNEL ARMED ——';
      setDisplayText(fullTextRef.current);
      setDoneIntro(true);
      setTyping(false);
      reshuffleEchoes();
      scheduleNextEcho();
      logEvent('echo_only_start', { reason: hardSeen? 'hard_seen' : 'prefs_seen' });
    }
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
      // Persist echo state (if intro completed) for accidental remount continuity (StrictMode / HMR)
      try {
        if(doneIntroRef.current){
          (window as any).__efTxEchoState = { text: fullTextRef.current, queue: echoQueueRef.current.slice(), nextDue: echoTimerNextDueRef.current || Date.now() + 30000 };
          (window as any).__efTxPersist = { text: fullTextRef.current, introComplete: true, queue: echoQueueRef.current.slice(), nextDue: echoTimerNextDueRef.current || Date.now() + 30000 };
          logEvent('echo_state_persisted');
        }
      } catch {}
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
          try { (window as any).__efTxIntroComplete = true; (window as any).__efTxPersist = { text: fullTextRef.current, introComplete:true, queue: echoQueueRef.current.slice(), nextDue: Date.now() + 20000 }; } catch {}
          try { track({ type:'transmission_complete' }); } catch {};
          // Graceful ambient termination: fade out instead of hard cut (don\u2019t sever mid-cycle)
          if(ambientRef.current){
            try {
              const a = ambientRef.current; a.loop = false; // let current play-through end if near end
              const startVol = a.volume;
              const fadeMs = 900; const steps = 9; const stepDur = fadeMs/steps;
              let i=0;
              const fade = () => {
                if(!a) return;
                i++; const ratio = 1 - (i/steps);
                a.volume = mutedRef.current?0: Math.max(0, startVol * ratio);
                if(i < steps){ setTimeout(fade, stepDur); } else { try { a.pause(); a.currentTime = 0; } catch {} }
              };
              fade();
            } catch {}
          }
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

  const echoTimerNextDueRef = useRef<number|undefined>(undefined);
  const scheduleNextEcho = (explicitDelay?: number) => {
    if(!show) return;
    if(echoTypingRef.current){ logEvent('echo_schedule_skipped_typing'); return; }
    if(echoTimerRef.current){ clearTimeout(echoTimerRef.current); echoTimerRef.current=null; }
  const delay = typeof explicitDelay === 'number' ? explicitDelay : (10000 + Math.random()*15000); // 10s to 25s or restored remaining
    echoTimerNextDueRef.current = Date.now() + delay;
    echoTimerRef.current = setTimeout(()=>{ appendNextEcho(); }, delay);
    logEvent('echo_scheduled', { delay });
  };

  const appendNextEcho = () => {
    if(echoTypingRef.current){ logEvent('echo_append_ignored', { reason:'typing' }); return; }
    if(echoTimerRef.current){ clearTimeout(echoTimerRef.current); echoTimerRef.current=null; }
    if(!echoQueueRef.current.length){ reshuffleEchoes(); }
    const line = echoQueueRef.current.shift();
    if(!line){ scheduleNextEcho(); return; }
    // Prevent accidental duplication: if the last line already ends with this exact line, reschedule instead of appending.
    const existingTail = fullTextRef.current.split('\n').slice(-1)[0];
    if(existingTail === line){
      logEvent('echo_duplicate_line_skipped');
      scheduleNextEcho();
      return;
    }
  const prefix = fullTextRef.current.endsWith('\n')? '' : '\n';
  const base = fullTextRef.current; // snapshot BEFORE append
  const delta = prefix + line;
  fullTextRef.current = base + delta; // canonical full text (for persistence)
  echoBaseTextRef.current = base;
  echoDeltaRef.current = delta;
  echoDeltaIndexRef.current = 0;
  echoTypingRef.current = true;
  setTyping(true);
  startTypingEchoDelta();
  logEvent('echo_append', { line });
  // Persist immediately so even if HMR/remount during typing we resume safely.
  try { (window as any).__efTxEchoState = { text: fullTextRef.current, queue: echoQueueRef.current.slice(), nextDue: (echoTimerNextDueRef.current||0) }; } catch {}
  };

  // Delta echo typing: only append new chars after base snapshot; never rewrites existing portion
  const startTypingEchoDelta = () => {
    logEvent('echo_typing_start');
    const step = () => {
      if(!typingRef.current || !echoTypingRef.current) return;
      const target = echoDeltaRef.current.length;
      if(echoDeltaIndexRef.current >= target){
        setDisplayText(echoBaseTextRef.current + echoDeltaRef.current);
        setTyping(false);
        echoTypingRef.current = false;
        logEvent('echo_typing_complete');
        try { (window as any).__efTxPersist = { text: fullTextRef.current, introComplete:true, queue: echoQueueRef.current.slice(), nextDue: Date.now() + 30000 }; } catch {}
        scheduleNextEcho();
        return;
      }
      const advance = fast ? target - echoDeltaIndexRef.current : 1;
      echoDeltaIndexRef.current = Math.min(target, echoDeltaIndexRef.current + advance);
      const partial = echoDeltaRef.current.slice(0, echoDeltaIndexRef.current);
      setDisplayText(echoBaseTextRef.current + partial);
      const lastChar = partial[partial.length-1];
      const delay = fast ? 0 : (lastChar==='\n' ? 170 : TYPING_INTERVAL + Math.random()*40);
      setTimeout(step, delay);
    };
    setTimeout(step, 120);
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
