import React, { useState, useCallback, useRef, useEffect } from 'react';
import './HelpPanel.css';

interface HelpPanelProps {
  accentIsBlue: boolean; // for potential future logic; CSS variable handles colors now
}

interface SectionDef {
  id: string;
  title: string;
  body?: React.ReactNode;
  subsections?: { id: string; title: string; content: React.ReactNode }[];
}

const sections: SectionDef[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: (
      <div>
        <p>EF-map lets you explore the star map, evaluate regions, analyze gate vs ship traversal, and plan efficient routes. Use the left panel to toggle major visualization features and the routing / optimization modules to compute paths.</p>
        <p>Headings below expand to reveal detailed help. Each heading and nested subsection can be clicked to toggle visibility. You can leave this panel open while interacting with the map.</p>
      </div>
    ),
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
          <p>Colors stars by their planet count on a green-scale gradient (low = red/orange toward high = green). Use this to locate planet-rich clusters or sparse areas. A legend appears below the panels when active.</p>
        ),
      },
      {
        id: 'dpc-with-region',
        title: 'Interaction with Highlight Region',
        content: (
          <p>With both enabled, the highlighted region preserves the gradient while non-highlighted regions revert to neutral coloring to reduce noise.</p>
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
          <p><span className="code-inline">A*</span> uses a heuristic to more quickly converge on the target. <span className="code-inline">Dijkstra</span> explores uniformly and can be slower on large graphs. Choose A* for most cases unless validating path optimality under unusual constraints.</p>
        ),
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
        id: 'p2p-progress',
        title: 'Progress Indicators',
        content: (
          <p>Explored/frontier counts and elapsed ms show algorithm search breadth and pacing. If a search seems stuck, ensure the max jump distance isn&apos;t too restrictive.</p>
        ),
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
        id: 'scout-ship-gate',
        title: 'Ship vs Gate Trade Rule',
        content: (
          <p>The optimizer prioritizes minimizing ship jumps (count & distance) lexicographically before total distance. Parameters control when a shorter ship jump may replace a long gate chain: maximum ship range capability, a trade distance threshold, and minimum gate hops to save.</p>
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
    ],
  },
];

const HelpPanel: React.FC<HelpPanelProps> = ({ accentIsBlue }) => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ overview: true });
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
    };
    setWidth();
    window.addEventListener('resize', setWidth);
    return ()=> window.removeEventListener('resize', setWidth);
  }, [open]);

  return (
    <>
      <button
        className="help-toggle-button"
        aria-expanded={open}
        aria-controls="help-panel"
        onClick={() => setOpen(o => !o)}
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
