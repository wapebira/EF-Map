import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { track } from '../../utils/usage';
import './HelpPanel.css';

interface HelpPanelProps {
  accentIsBlue: boolean; // for potential future logic; CSS variable handles colors now
  supportExpandRequestId?: number; // increments when external support button clicked
  supportContent?: React.ReactNode; // injected content for support section (user supplied)
}

interface SectionDef {
  id: string;
  title: string;
  body?: React.ReactNode;
  subsections?: { id: string; title: string; content: React.ReactNode }[];
}

// Base help sections (support section appended dynamically so it can always remain last)
const baseSections: SectionDef[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: (
      <div>
  <p>EF-map lets you explore the star map, evaluate regions, analyze gate vs ship traversal, and plan efficient routes. Use the left panel to toggle major visualization features and the routing / optimization modules to compute paths.</p>
  <p>Headings below expand to reveal detailed help. Each heading and nested subsection can be clicked to toggle visibility. You can leave this panel open while interacting with the map. Keyboard: Focus a section header (Tab) then press Enter or Space to toggle it (same for subsections).</p>
    <p style={{ marginTop:'10px', fontSize:'13px' }}>Public aggregate feature usage metrics (anonymous) are available on the <a href="/stats" target="_blank" rel="noopener noreferrer" style={{ textDecoration:'underline' }}>Usage Stats</a> page (opens in a new tab).</p>
      </div>
    ),
  },
  {
    id: 'usage-stats',
    title: 'Usage Stats (Anonymous)',
    subsections: [
      {
        id: 'usage-purpose',
        title: 'What It Is',
        content: (
          <p>The Usage Stats page (/stats) shows anonymous aggregate counters and timing averages gathered since deployment. It helps prioritize roadmap work (e.g. which routing modes or optimizer features are actually used) and track performance over time.</p>
        )
      },
      {
        id: 'usage-privacy',
        title: 'Privacy & Data Collected',
        content: (
          <div>
            <p><strong>No personal, account, IP, session, or identifier data</strong> is collected. Events are simple counter or summed-duration increments (e.g. “p2p_route”, milliseconds spent in cinematic mode). There is no per-user profiling or storage of raw event streams—only aggregated totals and sum/count pairs.</p>
            <ul style={{ paddingLeft: '18px', margin: '6px 0' }}>
              <li>Counts: routes computed, baselines, optimizations, shares created/resolved, feature toggles (waypoints, avoid, planet filter, return-to-start), theme selections, cinematic usage.</li>
              <li>Timings (averages derive from sum & count): P2P route duration, baseline generation, optimization session, session length, time spent in cinematic mode.</li>
              <li>Daily rollups: simple per-day snapshots (last 7 days table) to track trends—still aggregate only.</li>
            </ul>
            <p>If a metric is unused it simply stays at 0. No hidden fields exist beyond what is displayed.</p>
          </div>
        )
      },
      {
        id: 'usage-key-metrics',
        title: 'Key Metrics Explained',
        content: (
          <div>
            <p>The stats page now provides per‑metric hover tooltips (desktop: hover, mobile: long‑press/focus) so this panel keeps only a concise overview:</p>
            <ul style={{ paddingLeft: '18px', margin: '6px 0' }}>
              <li><strong>Volume & Adoption:</strong> Route, baseline, optimization, share, copy, donation counts.</li>
              <li><strong>Performance:</strong> Aggregated ms for P2P routing, baseline build, optimization time.</li>
              <li><strong>Engagement:</strong> Session length, cinematic enters/time & share (% of session in cinematic).</li>
              <li><strong>Feature Usage:</strong> Waypoints, avoid, return‑to‑start, planet legend bins, workers used, UI scale buckets.</li>
              <li><strong>Distributions:</strong> Hops, savings (LY), planet bins active, workers, UI scale — used for shape, not identity.</li>
            </ul>
            <p>Use the tooltips for exact definitions & formulas (e.g. copy rate, savings buckets). All remain anonymous aggregate counters or sum/count pairs only.</p>
          </div>
        )
      },
      {
        id: 'usage-history',
        title: 'Historical Rollups',
        content: (
          <p>Daily rollups store one aggregate JSON per day (no user granularity). The stats page shows a 7‑day table for trend scanning. Older days may be pruned or condensed in the future if size becomes a concern.</p>
        )
      }
    ]
  },
  {
    id: 'share-route',
    title: 'Share Route (Short Link)',
    subsections: [
      {
        id: 'share-what',
        title: 'What it does',
        content: (
          <p>Generates a short shareable link that recreates your current planned route (or other encoded map state) when someone opens it. The link fragment contains a short ID (e.g. <span className="code-inline">#s=abc123xyz</span>) which is resolved via a tiny serverless lookup into the original compressed route string.</p>
        ),
      },
      {
        id: 'share-how',
        title: 'How it works (under the hood)',
        content: (
          <div>
            <p>The app encodes the current route state into a compact text payload (prefix <span className="code-inline">r1|</span> for versioning + compressed/base64 content). That payload alone is stored in a lightweight key/value blob store under a random 8–10 character ID. The short link you copy never includes the full data—only the ID.</p>
            <ul style={{paddingLeft:'18px',margin:'6px 0'}}>
              <li><strong>Stored:</strong> The exact route payload string (systems sequence + relevant params).</li>
              <li><strong>Not stored:</strong> Your IP, browser fingerprint, account info (there is no account), other UI state, or past history.</li>
              <li><strong>Randomness:</strong> IDs are cryptographically random; guessing someone else&apos;s active route is impractical.</li>
              <li><strong>Versioning:</strong> The <span className="code-inline">r1|</span> prefix allows future format upgrades without breaking old links.</li>
            </ul>
          </div>
        ),
      },
      {
        id: 'share-privacy',
        title: 'Privacy & Security',
        content: (
          <div>
            <p>Only the minimal route payload you explicitly choose to share is sent to the serverless function. No personal or background data is attached. The payload contains system identifiers and routing parameters — nothing about you as a user.</p>
            <p>Anyone with the resulting short link can load that same route (similar to an unlisted document link). If a route is sensitive, treat the link like a secret and share it only with trusted parties.</p>
            <p>Links are currently persistent; there is no in-app deletion UI yet. If removal becomes necessary a server-side purge tool can be introduced in a later release (planned if demand arises).</p>
          </div>
        ),
      },
      {
        id: 'share-limitations',
        title: 'Limitations & Edge Cases',
        content: (
          <ul style={{paddingLeft:'18px',margin:'6px 0'}}>
            <li>If the share service is temporarily unreachable you&apos;ll fall back to copying a longer full-data URL instead.</li>
            <li>Old short links may display a warning if a future format (<span className="code-inline">r2|</span>, etc.) introduces incompatible changes; the app will attempt graceful migration.</li>
            <li>If you modify the route after creating a link, generate a new link—existing links are immutable snapshots.</li>
            <li>Links generated before a schema/feature change may auto-upgrade or fall back to the long fragment representation; data is still preserved when possible.</li>
          </ul>
        ),
      },
      {
        id: 'share-troubleshooting',
        title: 'Troubleshooting',
        content: (
          <div>
            <p>If you see a 500 error in the console while sharing, the app should automatically copy the full (long) URL instead of a short link. You can still send that; it encodes the same data directly in the fragment.</p>
            <p>If a short link loads to an empty map, the underlying payload may have been pruned or corrupted. Ask the sender to recreate and resend.</p>
          </div>
        ),
      },
    ],
  },
  {
    id: 'region-highlight',
    title: 'Highlight Region',
    subsections: [
      {
        id: 'region-basics',
        title: 'What it does',
        content: (
          <p>Highlights all systems (and gates) within the region of the currently selected system. This helps you visually isolate a region&apos;s topology. Selecting a different system re-centers the highlight. Turn off to revert to global coloring.</p>
        ),
      },
      {
        id: 'region-with-dpc',
        title: 'Interaction with Display Planet Counts',
        content: (
          <p>When planet counts are ON, only the highlighted region gets the planet-count color gradient; other regions desaturate to a neutral white so you can focus on intra-region variance. Turn region highlight OFF to view the planet gradient globally.</p>
        ),
      },
      {
        id: 'region-stats-window',
        title: 'Region Stats Window',
        content: (
          <div>
            <p>When you click a system (or a region name in the Compare Regions table) a compact Region Stats window can appear showing a snapshot of metrics for that single region: system counts, gated vs isolated distribution, connectivity %, representative distance aggregates, jump estimates, planet totals and averages, and station presence. Tooltips on most labels provide precise definitions or formulas—hover (desktop) or long‑press/focus (touch) for details.</p>
            <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
              <li><strong>Purpose:</strong> Quick at‑a‑glance health & structure summary of the current highlighted region without leaving the map context.</li>
              <li><strong>Auto‑update:</strong> Selecting a system in a different region (or choosing a region via the comparison table) refreshes the snapshot instantly.</li>
              <li><strong>Complement to Highlight:</strong> Region highlight gives spatial outline; the stats window supplies quantitative context.</li>
              <li><strong>Low overhead:</strong> Values come from a cached computation—opening it repeatedly is inexpensive.</li>
            </ul>
            <p style={{ marginTop:'6px' }}>Use Region Stats for a focused inspection; use Compare Regions (below) when you want to rank or scan multiple regions across the same metrics.</p>
          </div>
        )
      },
    ],
  },
  {
    id: 'display-planet-counts',
    title: 'Display Planet Counts (DPC)',
    subsections: [
      {
        id: 'dpc-purpose',
        title: 'Purpose',
        content: (
    <p>Colors stars by planet count using a multi-hue gradient (low = red/orange → high = green). Use this to locate planet-rich clusters or sparse areas. A legend with five dynamic planet-count ranges (bins) appears below the panels when active; each bin has a checkbox so you can selectively emphasize only the ranges you care about (e.g., show just high-density systems).</p>
        ),
      },
      {
        id: 'dpc-filters',
        title: 'Legend Range Filters',
        content: (
          <div>
            <p>The legend splits the current min→max planet counts among visible systems into five equally sized numeric ranges (rounded). All five are enabled by default. Unchecking a range causes systems whose planet counts fall inside that range to revert to the neutral white base color (they are de-emphasized, not hidden). This lets you, for example, isolate only the highest-density systems.</p>
            <ul style={{ paddingLeft: '18px', margin: '6px 0' }}>
              <li>All bins checked: full gradient across all systems (original behavior).</li>
              <li>Some bins unchecked: only checked ranges retain their gradient color.</li>
              <li>All bins unchecked: every star is white (legend still visible so you can re-enable bins quickly).</li>
              <li>Toggling DPC off and back on resets all bins to checked.</li>
      <li>Re-enabling a bin instantly restores its colors—no recalculation needed.</li>
            </ul>
            <p style={{ marginTop: '6px' }}><strong>Region Highlight synergy:</strong> When Highlight Region is also ON, the gradient (respecting the enabled bins) is applied only inside the highlighted region; systems outside the region remain white regardless of bin state. Disabled bins stay white everywhere.</p>
          </div>
        ),
      },
      {
        id: 'dpc-with-region',
        title: 'Interaction with Highlight Region',
        content: (
    <p>When both Region Highlight and Display Planet Counts are ON, the gradient (respecting enabled bins) applies only inside the highlighted region; systems outside appear neutral white.</p>
        ),
      },
    ],
  },
  {
    id: 'show-distance',
    title: 'Show Distance',
    subsections: [
      {
        id: 'distance-hover',
        title: 'Hover distances',
        content: (
          <p>Displays the straight-line (3D) distance from the currently selected system to the system under your cursor, appended to the hover label. Useful for quick range estimates before planning ship vs gate traversal.</p>
        ),
      },
      {
        id: 'distance-usage',
        title: 'Usage tips',
        content: (
          <p>Select a system (click) then move the cursor around to gauge distances. Combine with Highlight Region to understand internal span of a region.</p>
        ),
      },
    ],
  },
  {
    id: 'p2p-routing',
    title: 'Point-to-Point Routing',
    subsections: [
      {
        id: 'p2p-algorithms',
        title: 'Algorithms (A* vs Dijkstra)',
        content: (
          <div>
            <p><span className="code-inline">A*</span> uses a heuristic to more quickly converge on the target. <span className="code-inline">Dijkstra</span> explores uniformly and can be slower on large graphs.</p>
            <p><strong>Quick / Basic (A*):</strong> Gives you a solid route fast—ideal for short trips, experimentation, or when you just need a workable path immediately.</p>
            <p><strong>Advanced / Thorough (Dijkstra):</strong> Systematically expands every cheaper partial path without directional bias. That exhaustive ordering often surfaces a route with lower total lightyears (fuel) and/or fewer or shorter ship jumps than the quicker A* result—most noticeable on longer or branching routes.</p>
            <p><strong>Trade‑off:</strong> Dijkstra takes longer (the “wandering” is deliberate exploration) but can yield meaningful fuel savings. Mental model: A* says “head roughly that way and refine”; Dijkstra says “exhaustively check by true cost so nothing cheaper is skipped.” Use A* for speed; switch to Dijkstra when squeezing out minimum fuel matters.</p>
          </div>
        ),
      },
      {
        id: 'p2p-map-interactions',
        title: 'Fast Map Interactions',
        content: (
          <div>
            <p><strong>Left‑click</strong> a star to set the <em>From</em> system (and the Scout Optimizer start). <strong>Right‑click</strong> a star to open a small contextual menu with these actions:</p>
            <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
              <li><strong>Set Destination:</strong> Fills the <em>To</em> field. Automatically opens the P2P panel if a From already exists.</li>
              <li><strong>Add Waypoint:</strong> Appends the system to the Waypoints list (max 10). If no destination is set yet, the <em>first waypoint temporarily acts as the destination</em> until you explicitly set one.</li>
              <li><strong>Avoid System:</strong> Adds the system to the Avoid list so routing will not pass through it (unless it is a required endpoint of a segment).</li>
            </ul>
            <p>The menu closes on left‑click elsewhere. Duplicate adds are ignored silently. A system cannot simultaneously be in Waypoints and Avoid; adding it to one removes it from the other.</p>
          </div>
        )
      },
      {
        id: 'p2p-metrics',
        title: 'Optimize for Fuel vs Jumps',
        content: (
          <p>Fuel minimization prioritizes total distance (useful where range costs matter). Jumps minimization reduces hop count (useful for time-sensitive travel). The chosen metric affects the search cost function.</p>
        ),
      },
      {
        id: 'p2p-max-jump',
        title: 'Max Jump Distance',
        content: (
          <p>Sets the maximum ship jump LY distance allowed between non-gate-connected systems. Raise it to permit long-range ship shortcuts; lower it to force gate-only traversal where possible.</p>
        ),
      },
      {
        id: 'p2p-waypoints',
        title: 'Waypoints & Segment Chaining',
        content: (
          <div>
            <p>Waypoints let you force the route to visit specific systems in sequence. Each <em>segment</em> (From → W1, W1 → W2, … → Destination) is solved independently; the final path is a concatenation with duplicate junction systems removed.</p>
            <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
              <li><strong>Order:</strong> By default the order you add them is preserved.</li>
              <li><strong>Optimize order (experimental):</strong> Optional checkbox runs a simple nearest‑neighbor heuristic to reorder for shorter travel. This is a heuristic, not guaranteed optimal (future improvements may upgrade this).</li>
              <li><strong>Limit:</strong> Up to 10 waypoints.</li>
              <li><strong>Temporary destination:</strong> If no explicit Destination is set, the first waypoint is treated as the target so you can stage multi‑leg planning incrementally.</li>
              <li><strong>Removal:</strong> Click the ✕ next to a waypoint in the panel to remove it.</li>
            </ul>
          </div>
        )
      },
      {
        id: 'p2p-avoid',
        title: 'Avoid Systems',
        content: (
          <div>
            <p>Systems in the Avoid list are excluded from pathfinding expansions to steer the route around risky or undesirable space. They are still allowed if they are an explicit segment endpoint (From, a Waypoint, or Destination) so you cannot soft‑lock the route.</p>
            <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
              <li>Right‑click → Avoid System to add; ✕ in the panel to remove.</li>
              <li>Adding a system to Avoid removes it from Waypoints if present (and vice‑versa).</li>
              <li>Ignored silently if already avoided.</li>
            </ul>
          </div>
        )
      },
      {
        id: 'p2p-progress',
        title: 'Progress Indicators',
        content: (
          <p>Explored/frontier counts and elapsed ms show algorithm search breadth and pacing. If a search seems stuck, ensure the max jump distance isn&apos;t too restrictive.</p>
        ),
      },
      {
        id: 'p2p-cancel-reset',
        title: 'Stopping & Resetting',
        content: (
          <div>
            <p><strong>Stop</strong> immediately cancels the current segment (or multi‑segment chain) and halts further processing. The progress message updates to “Cancelled”.</p>
            <p><strong>Reset</strong> clears current route results, Scout results, search box, all Waypoints, all Avoid Systems, and the waypoint order optimization toggle. Destination is preserved (so you can refine quickly) unless you manually change it.</p>
          </div>
        )
      },
          {
            id: 'p2p-route-notes-export',
            title: 'Route Notes Export',
            content: (
              <div>
                <p>The Copy buttons generate paged in‑game notes sized to stay under the character cap. Two optional inclusions:</p>
                <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
                  <li><strong>Include Legend:</strong> Adds the legend line explaining symbols on every page.</li>
                  <li><strong>Include Route Statistics:</strong> Adds a one‑line stats summary (Gate, Ship, Total Distance, Ship Distance) on the <em>first page only</em>.</li>
                </ul>
                <p><strong>Legend format:</strong><br/>
                  <code>Gate: (x)→ SmartGate: []→ Jump: &lt;distance&gt;→ | * = single-planet system with no stargates</code></p>
                <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
                  <li><strong>(x)→</strong> A run of x consecutive stargate hops between the two shown systems.</li>
                  <li><strong>[]→ SmartGate</strong> Placeholder for future player‑made smart gate links (handled like normal gates when data present).</li>
                  <li><strong>&lt;distance&gt;→</strong> A direct ship jump (distance in LY, 2 decimals).</li>
                  <li><strong>*</strong> System has exactly one planet and no stargates (isolation marker).</li>
                </ul>
                <p style={{marginTop:'6px'}}><strong>Example snippet:</strong><br/>
                  <span style={{color:'var(--accent)'}}>&lt;A1-XYZ&gt;</span> (3)→ <span style={{color:'var(--accent)'}}>&lt;B2-QP9&gt;</span> 2.57→ <span style={{color:'var(--accent)'}}>&lt;C9-LMN*&gt;</span> (2)→ <span style={{color:'var(--accent)'}}>&lt;D4-RST&gt;</span>
                </p>
              </div>
            )
          },
          {
            id: 'p2p-import',
            title: 'Loading Shared Routes',
            content: (
              <div>
                <p>Opening a short link (or full encoded URL) auto-populates the route fields and draws its path. Waypoints / Avoid sets are restored if present. You can immediately copy notes or adjust parameters and re-run.</p>
              </div>
            )
          },
    ],
  },
  {
    id: 'scout-optimizer',
    title: 'Scout Optimizer',
    subsections: [
      {
        id: 'scout-overview',
        title: 'Purpose',
        content: (
          <p>Generates an initial baseline macro route across a collected system set, then continuously improves it via localized segment reversals and 2-opt, using multiple web workers for parallel diversification.</p>
        ),
      },
      {
        id: 'scout-collection',
        title: 'System Collection',
        content: (
          <p>Define a start system plus either a radius or entire region. Optionally restrict to gate-reachable systems to avoid isolated outliers requiring long ship jumps.</p>
        ),
      },
          {
            id: 'scout-planet-filter',
            title: 'Planet Count Filter',
            content: (
              <div>
                <p>Optionally restrict the collected system set to only those whose planet counts fall inside the currently enabled planet legend bins. This uses the same five dynamic ranges as Display Planet Counts. Changing bins or toggling the filter invalidates any existing route because the optimization search space changes.</p>
                <ul style={{paddingLeft:'18px',margin:'6px 0'}}>
                  <li><strong>Focus:</strong> Target high-value (e.g. high-planet) systems for shorter or richer routes.</li>
                  <li><strong>Adaptive bins:</strong> If global min/max shifts (different region), ranges recompute automatically.</li>
                  <li><strong>Tip:</strong> Start unfiltered to gauge density; then enable filter to refine.</li>
                </ul>
              </div>
            )
          },
      {
        id: 'scout-ship-gate',
        title: 'Ship vs Gate Trade Rule',
        content: (
            <div>
              <p>The optimizer prioritizes minimizing ship jumps (count & distance) lexicographically before total distance. Parameters control when a shorter ship jump may replace a long gate chain: maximum ship range capability, a trade distance threshold, and minimum gate hops to save.</p>
              <p><strong>UI Mapping:</strong> Max Ship Jump Range sets the absolute allowed ship jump length. Ship LY (trade distance) + Min Gate Hops define when a ship jump can substitute a longer gate chain. After changing these significantly, re-run baseline (or restart optimization) for consistent metrics.</p>
            </div>
        ),
      },
      {
        id: 'scout-workers',
        title: 'Parallel Workers & Stall Handling',
        content: (
          <p>Each worker iteratively mutates and refines the current champion. A global monitor detects per-worker or global stalls (no improvement within timeout) and triggers diversified restarts to escape local minima.</p>
        ),
      },
          {
            id: 'scout-logs',
            title: 'Activity & Worker Logs',
            content: (
              <div>
                <p>Two tabs surface progress: <strong>Activity</strong> (collection counts, baseline metrics, improvements, invalidations, stalls) and <strong>Workers</strong> (per-thread messages, stall restarts, non-improvement iterations). Auto-scroll pauses if you scroll up; scroll back to the bottom to resume. Use Clear to reset the visible tab.</p>
              </div>
            )
          },
      {
        id: 'scout-output',
        title: 'Route Metrics & Notes',
        content: (
          <p>Displays baseline distance, current champion distance, improvement %, ship jump count & distance, and expanded gate hop length. Generated route notes segment gate runs and ship jumps with symbols for convenient in-game note pasting.</p>
        ),
      },
      {
        id: 'scout-best-practices',
        title: 'Best Practices',
        content: (
          <p>Start with modest radius/region sizes. Tune ship trade parameters after baseline to adjust gate vs ship balance, then re-run baseline if the system set or return toggle changes. Use more workers for larger sets; diminishing returns may appear after CPU saturation.</p>
        ),
      },
          {
            id: 'scout-troubleshooting',
            title: 'Troubleshooting & Errors',
            content: (
              <ul style={{paddingLeft:'18px',margin:'6px 0'}}>
                <li><strong>Baseline error (min ship range):</strong> If a baseline cannot connect all systems with your ship range, a required minimum is shown—raise range then re-run.</li>
                <li><strong>Route invalidated:</strong> Changes to start system, radius/region toggle, gate-reachable filter, planet filter toggle, or planet bins trigger an invalidation notice.</li>
                <li><strong>Stalls:</strong> Workers auto-diversify after timeout; increase stall timeout for large sets to reduce churn.</li>
                <li><strong>No improvement:</strong> Increase workers, reduce system scope, or apply planet filtering to accelerate refinement.</li>
              </ul>
            )
          },
          {
            id: 'scout-route-notes-export',
            title: 'Route Notes Export',
            content: (
              <div>
                <p>Exports the optimized (expanded) route in paged note form. Options:</p>
                <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
                  <li><strong>Include Legend:</strong> Adds legend line on each page.</li>
                  <li><strong>Include Route Statistics:</strong> Adds stats summary only on the first page.</li>
                </ul>
                <p><strong>Legend:</strong> <code>Gate: (x)→ SmartGate: []→ Jump: &lt;distance&gt;→ | * = single-planet system with no stargates</code></p>
                <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
                  <li><strong>(x)→</strong> x consecutive gate hops collapsed.</li>
                  <li><strong>[]→</strong> Smart gate link (future dataset).</li>
                  <li><strong>&lt;distance&gt;→</strong> Direct ship jump distance (LY, 2 decimals).</li>
                  <li><strong>*</strong> Single‑planet isolated system.</li>
                </ul>
                <p style={{marginTop:'6px'}}><strong>Example:</strong><br/>
                  <span style={{color:'var(--accent)'}}>&lt;OH1-20R&gt;</span> 2.61→ <span style={{color:'var(--accent)'}}>&lt;IJH-191&gt;</span> (4)→ <span style={{color:'var(--accent)'}}>&lt;UHR-QP2*&gt;</span> 3.88→ <span style={{color:'var(--accent)'}}>&lt;E82-GD2&gt;</span>
                </p>
              </div>
            )
          },
    ],
  },
      {
        id: 'reachability',
        title: 'Reachability (Jump Range)',
        subsections: [
          {
            id: 'reach-overview',
            title: 'Overview & Workflow',
            content: (
              <div>
                <p>Analyze which systems are gate/ship reachable from a chosen <em>Origin</em> within a maximum jump distance. Enter an origin system, set a <em>Max Jump Range</em> (LY), then click <strong>Compute</strong> (or enable <strong>Auto</strong>) to evaluate.</p>
                <ul style={{ paddingLeft: '18px', margin: '6px 0' }}>
                  <li><strong>Origin System:</strong> Autocomplete; changes trigger recompute when Auto is ON.</li>
                  <li><strong>Max Jump Range:</strong> Direct distance ceiling for individual ship jumps used in reachability logic & bubble radius.</li>
                  <li><strong>Compute:</strong> Manual run (disabled if incomplete or already computing).</li>
                  <li><strong>Stats Line:</strong> Shows reachable vs total systems and time (ms).</li>
                </ul>
              </div>
            )
          },
          {
            id: 'reach-checkboxes',
            title: 'Checkboxes & Interaction',
            content: (
              <div>
                <ul style={{ paddingLeft: '18px', margin: '6px 0' }}>
                  <li><strong>Auto:</strong> Debounced recompute (≈280ms) whenever Origin or Range changes. Off = only manual Compute.</li>
                  <li><strong>Highlight unreachable:</strong> Colors systems outside the reachable gate/ship graph red; others retain base/other mode colors. (Toggle tracked independently of bubble.)</li>
                  <li><strong>Show bubble:</strong> Displays a smooth animated sphere centered on the selected/highlighted system sized to the Max Jump Range (pure geometric radius; not path graph aware). Camera may reframe after large range changes.</li>
                  <li><strong>Highlight in-range:</strong> When the bubble is ON, colors all systems whose straight-line distance from the bubble center ≤ range in the accent color. This can visually contrast raw distance coverage vs graph reachability.</li>
                </ul>
              </div>
            )
          },
          {
            id: 'reach-precedence',
            title: 'Color Precedence Rules',
            content: (
              <div>
                <ul style={{ paddingLeft: '18px', margin: '6px 0' }}>
                  <li><strong>In‑range vs Unreachable:</strong> In‑range accent overrides unreachable red if a system is both within geometric range yet unreachable via gates/ship jumps under the current graph constraints.</li>
                  <li><strong>In‑range + Other Modes:</strong> When <em>Highlight in-range</em> AND <em>Show bubble</em> are active, in‑range accent colors take precedence over Region Highlight & Display Planet Counts modes (those modes are visually suspended while this pairing is active).</li>
                  <li><strong>Unreachable Highlight alone:</strong> Without in‑range highlighting the unreachable red overlay coexists with Region / Planet coloring for reachable systems.</li>
                  <li><strong>Turning Off In‑range:</strong> Restores prior base / Region / Planet colors; unreachable red is then re-applied if its checkbox remains on.</li>
                </ul>
              </div>
            )
          },
          {
            id: 'reach-metrics',
            title: 'Metrics Captured (Anonymous)',
            content: (
              <div>
                <p>The stats page tracks: tab opens, compute runs, Auto on/off, Unreachable highlight on/off, Bubble show/hide, In‑range highlight on/off, and range bucket distribution. Use these to gauge feature adoption & typical planning ranges.</p>
              </div>
            )
          }
        ]
      },
  {
    id: 'show-stations',
    title: 'Show Stations',
    subsections: [
      {
        id: 'stations-overview',
        title: 'Overview',
        content: (
          <div>
            <p>Displays an icon above systems that contain stations using the generated station counts dataset. Toggle via the toolbar button (Show Stations). Icons remain minimally sized until you zoom in or focus a system to reduce clutter.</p>
            <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
              <li><strong>Hover & Select:</strong> Hovering the station icon highlights its underlying system; clicking the icon selects that system (same as clicking the star).</li>
              <li><strong>Focus Scaling:</strong> The currently selected (or nearest in view) station gently enlarges to aid targeting; others stay compact.</li>
              <li><strong>Performance:</strong> Lightweight sprite layer; safe to leave enabled—icons auto hide when zoomed far out.</li>
            </ul>
            <p style={{marginTop:'6px'}}><em>Note:</em> If the newer station-enabled database isn't available yet, toggling does nothing until it loads (fails gracefully).</p>
          </div>
        )
      }
    ]
  },
  {
    id: 'compare-regions',
    title: 'Compare Regions',
    subsections: [
      {
        id: 'compare-overview',
        title: 'Overview & Workflow',
        content: (
          <div>
            <p>The Compare Regions panel lets you scan and rank all regions across a shared metrics set (system counts, isolation, connectivity %, distances, jump estimates, planets, stations). It is <strong>resizable</strong>; drag its edges or corners to enlarge for wide multi‑column viewing.</p>
            <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
              <li><strong>Load / Refresh:</strong> Click the button to compute or recompute metrics (cached; incremental refresh is fast).</li>
              <li><strong>Sorting:</strong> Click any header to sort. Clicking again toggles ascending / descending.</li>
              <li><strong>Tooltips:</strong> Hover headers or values for precise definitions (mirrors Region Stats tooltips where applicable).</li>
              <li><strong>Row Highlight:</strong> Click any cell to visually highlight that entire row (helps track the region name when scanning wide tables).</li>
              <li><strong>Select Region:</strong> Click the region name cell to also highlight that region on the map and open/refresh the Region Stats window.</li>
              <li><strong>Responsive Layout:</strong> Panel remembers its last size; reopening restores your preferred dimensions.</li>
            </ul>
            <p style={{ marginTop:'6px' }}>Use this table to identify candidates (e.g., lowest min jump range, highest planet density) then click the name to pivot into focused spatial + detailed stat inspection.</p>
          </div>
        )
      },
      {
        id: 'compare-tips',
        title: 'Practical Tips',
        content: (
          <div>
            <ul style={{ paddingLeft:'18px', margin:'6px 0' }}>
              <li>After sorting by a derived metric (e.g. connectivity %) click the value itself to lock the row highlight, then move horizontally to locate its name without visual drift.</li>
              <li>Combine with planet legend filters to visually corroborate high planet density regions surfaced by the table.</li>
              <li>Resize wider to reduce horizontal scrolling when comparing several related metrics (distance columns).</li>
              <li>Refreshing after data/schema updates ensures new metrics appear without reloading the entire app.</li>
            </ul>
          </div>
        )
      }
    ]
  },
  {
    id: 'cinematic-mode',
    title: 'Cinematic Mode',
    subsections: [
      {
        id: 'cinematic-overview',
        title: 'Overview',
        content: (
          <div>
            <p>Applies a stylized presentation layer for screenshots, streaming, or passive viewing. Stars gain subtle twinkle & palette tinting; bloom, chromatic aberration, vignette, grain, and a configurable nebula-like haze are added. Optional aurora + gradient background, parallax distant stars, dust layers, and occasional ambient events (meteors, flares, ripples, supernova flashes) enhance depth.</p>
            <p>Controls inside the Cinematic panel let you adjust star palette, bloom strength (applies on release), aberration, haze color/intensity/radius, background intensity, aurora visibility & intensity, and pause/resume gentle idle camera drift. Toggling the mode off restores the normal interactive map (routing, region/planet coloring, precise hover behavior).</p>
            <p>Tip: Keep haze modest for readability; use pause before composing a screenshot; disable aurora if palette clarity is needed.</p>
          </div>
        ),
      },
      {
        id: 'cinematic-controls',
        title: 'Quick Controls',
        content: (
          <ul style={{paddingLeft:'18px',margin:'6px 0'}}>
            <li><strong>Pause Cam:</strong> Freezes idle drift (and cluster tour motion) until resumed.</li>
            <li><strong>Labels:</strong> Toggle star name overlays for orientation or annotated captures.</li>
            <li><strong>Auto Cluster Tour:</strong> Automatically glides to random stars; idle drift pauses during approach and hold phases.</li>
          </ul>
        )
      },
      {
        id: 'cinematic-auto-cluster-tour',
        title: 'Auto Cluster Tour',
        content: (
          <div>
            <p>When enabled, the camera periodically picks a random star and glides toward it, framing the star at a reasonable stand-off distance. After a brief hold the view smoothly pans back toward galactic center and idle drift resumes until the next hop. This creates a slow ambient “wandering” showcase without user input.</p>
            <ul style={{ paddingLeft: '18px', margin: '6px 0' }}>
              <li><strong>Timing:</strong> Travel (eased), short hold on the star, then pan to center; next hop scheduled after a cooldown.</li>
              <li><strong>Drift Interaction:</strong> Idle drift pauses during travel / pan phases and resumes afterward.</li>
              <li><strong>Smooth Turning:</strong> Target rotation toward the star is rate-limited for cinematic motion (no instant snaps).</li>
              <li><strong>Disable Anytime:</strong> Uncheck the option to immediately abort the current sequence and return to standard drift.</li>
            </ul>
            <p>If labels are hidden you may only notice subtle parallax; enable labels (Cinematic “Labels” toggle) if you want extra confirmation of which star is being visited.</p>
          </div>
        ),
      },
    ],
  },
];

const HelpPanel: React.FC<HelpPanelProps> = ({ accentIsBlue, supportExpandRequestId = 0, supportContent }) => {
  const [open, setOpen] = useState(false);
  const openedTrackedRef = useRef(false);
  // Start with all sections collapsed by default (no auto-open Overview)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedSub, setExpandedSub] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Smooth expand/collapse height measurement for main sections
  const bodyRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const sectionHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const subsectionContentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollIntoViewSmooth = (el: HTMLElement | null) => {
    if(!el || !scrollRef.current) return;
    const container = scrollRef.current;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if(elTop < viewTop || elBottom > viewBottom - 40){
      container.scrollTo({ top: elTop - 8, behavior: 'smooth' });
    }
  };

  const toggleSection = useCallback((id: string) => {
    setExpanded(prev => {
      const opening = !prev[id];
      const next = { ...prev, [id]: opening };
      // Delay scroll until after state applied & height measured
      requestAnimationFrame(()=>{ if(opening) scrollIntoViewSmooth(sectionHeaderRefs.current[id]); });
      return next;
    });
  }, []);

  const toggleSub = useCallback((id: string) => {
    setExpandedSub(prev => {
      const opening = !prev[id];
      const next = { ...prev, [id]: opening };
      // Smooth height animation for subsection
      const el = subsectionContentRefs.current[id];
      if(el){
        if(opening){
          el.style.display = 'block';
          el.style.maxHeight = '0px';
          el.style.opacity = '0';
          const target = el.scrollHeight;
          requestAnimationFrame(()=>{
            el.style.maxHeight = target + 'px';
            el.style.opacity = '1';
          });
          // After transition, cleanup explicit maxHeight for responsive content changes
          setTimeout(()=>{ if(el.classList.contains('open')) el.style.maxHeight = 'none'; }, 450);
          // Scroll into view
          requestAnimationFrame(()=> scrollIntoViewSmooth(el));
        } else {
          const currentHeight = el.scrollHeight;
          el.style.maxHeight = currentHeight + 'px';
          requestAnimationFrame(()=>{
            el.style.maxHeight = '0px';
            el.style.opacity = '0';
          });
          setTimeout(()=>{ if(!el.classList.contains('open')) el.style.display=''; }, 400);
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    // Recalculate heights for all open sections (prevents cut-off when subsections expand)
  Object.entries(bodyRefs.current).forEach(([id, el]) => {
      if (!el) return;
      const isOpen = expanded[id];
      if (isOpen) {
        const inner = el.querySelector('.accordion-body-inner') as HTMLDivElement | null;
        // Temporarily reset to auto to measure full height after nested changes
        el.style.maxHeight = 'none';
        const innerHeight = inner ? inner.scrollHeight : el.scrollHeight;
        el.style.maxHeight = innerHeight + 32 + 'px'; // padding buffer
        el.classList.add('open');
      } else {
        el.style.maxHeight = '0px';
        el.classList.remove('open');
      }
    });
  }, [expanded, expandedSub]);

  // Expose open state via root class for layout shifts of top-right toolbar
  useEffect(()=>{
    const root = document.documentElement;
    if(open){
      root.classList.add('help-open');
    } else {
      root.classList.remove('help-open');
    }
    return ()=>{ root.classList.remove('help-open'); };
  }, [open]);

  // Measure panel width when open to drive toolbar shift distance
  useEffect(()=>{
    if(!open) { document.documentElement.style.removeProperty('--help-panel-width'); return; }
    const setWidth = () => {
      const panel = document.getElementById('help-panel');
      if(panel){
        document.documentElement.style.setProperty('--help-panel-width', panel.offsetWidth + 'px');
      }
      // Also record toggle button width so shifting toolbar accounts for it when panel is open
      const toggle = document.querySelector('.help-toggle-button') as HTMLElement | null;
      if(toggle){
        document.documentElement.style.setProperty('--help-toggle-width', toggle.offsetWidth + 'px');
      }
    };
    setWidth();
    window.addEventListener('resize', setWidth);
    return ()=> window.removeEventListener('resize', setWidth);
  }, [open]);

  // Align help header bottom border with bottom of first toolbar button (consistent horizontal line)
  useLayoutEffect(()=>{
    if(!open) return;
    const header = document.querySelector('.help-panel-header') as HTMLElement | null;
    const firstBtn = document.querySelector('.ef-top-toolbar .ef-support-btn') as HTMLElement | null;
    if(!header || !firstBtn) return;
    const adjust = ()=>{
      // Reset any prior override
      header.style.paddingBottom = '';
      const btnRect = firstBtn.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
  const EXTRA_OFFSET = 13; // total downward shift (was 12, lowered 1px more per request)
  const delta = (btnRect.bottom + EXTRA_OFFSET) - headerRect.bottom;
      if(Math.abs(delta) > 0.5){
        const padBottom = parseFloat(getComputedStyle(header).paddingBottom||'0');
        header.style.paddingBottom = Math.max(0, padBottom + delta) + 'px';
      }
    };
    adjust();
    window.addEventListener('resize', adjust);
    window.addEventListener('ui-scale-change', adjust as any);
    return ()=>{ window.removeEventListener('resize', adjust); window.removeEventListener('ui-scale-change', adjust as any); };
  }, [open]);

  // Derive final sections list with Support section appended last (always)
  const sections: SectionDef[] = useMemo(()=> {
    return [
      ...baseSections,
      {
        id: 'support-project',
        title: 'Support This Project',
        body: (
          <div>
            {supportContent || (
              <div style={{ opacity:.75 }}>
                <p><em>Support content pending.</em> This placeholder will be replaced with project support details once provided.</p>
              </div>
            )}
          </div>
        )
      }
    ];
  }, [supportContent]);

  // When the external Support button is clicked, force open panel + expand support section
  useEffect(()=>{
    if(!supportExpandRequestId) return; // ignore initial 0
    setOpen(prevOpen => {
      if(prevOpen){
        // Close panel on second click
        return false;
      } else {
        // Open & expand support section
        setExpanded(prev => ({ ...prev, 'support-project': true }));
        setTimeout(()=>{ scrollIntoViewSmooth(sectionHeaderRefs.current['support-project']); }, 60);
        return true;
      }
    });
  }, [supportExpandRequestId]);

  return (
    <>
      <button
        className="help-toggle-button"
        aria-expanded={open}
        aria-controls="help-panel"
        onClick={() => setOpen(o => {
          const next = !o; if(next && !openedTrackedRef.current){ openedTrackedRef.current = true; try { track({ type:'help_open' }); } catch {} }
          return next;
        })}
      >
        {open ? 'Close Help' : 'Help'}
      </button>
      {open && (
        <div className="help-panel-container" id="help-panel" role="complementary" aria-label="Application help panel">
          <div className="help-panel-header">
            <h2>Help & Guide</h2>
            <button className="help-close-btn" aria-label="Close help" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="help-scroll" ref={scrollRef}>
            {sections.map(section => {
              const isOpen = !!expanded[section.id];
              return (
        <div key={section.id} className="accordion-section">
                  <div
                    className={`accordion-header ${isOpen ? 'open' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleSection(section.id)}
                    onKeyDown={(e) => { if(e.key==='Enter' || e.key===' ') { e.preventDefault(); toggleSection(section.id);} }}
          ref={el=>{ sectionHeaderRefs.current[section.id]=el; }}
                  >
                    <span className="chevron">▶</span>
                    <span>{section.title}</span>
                  </div>
                  <div
                    className="accordion-body"
                    ref={el => { bodyRefs.current[section.id] = el; }}
                  >
                    <div className="accordion-body-inner">
                      {section.body}
                      {section.subsections && section.subsections.map(sub => {
                        const subOpen = !!expandedSub[sub.id];
                        return (
                          <div key={sub.id} className="subsection">
                            <div
                              className="subsection-title"
                              role="button"
                              tabIndex={0}
                              aria-expanded={subOpen}
                              onClick={() => toggleSub(sub.id)}
                              onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); toggleSub(sub.id);} }}
                            >
                              <span className="chevron" style={{ transform: subOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease' }}>▶</span>
                              {sub.title}
                            </div>
                            <div
                              ref={el => {
                                subsectionContentRefs.current[sub.id] = el;
                                if (el && subOpen) {
                                  el.style.maxHeight = 'none';
                                  el.style.opacity = '1';
                                }
                              }}
                              className={`subsection-content ${subOpen ? 'open' : ''}`}
                            >
                              {sub.content}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="help-footer">
            <div>Accent: {accentIsBlue ? 'Blue' : 'Orange'} | Panel stays interactive alongside the map.</div>
          </div>
        </div>
      )}
    </>
  );
};

export default HelpPanel;
