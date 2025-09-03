import React, { useMemo, useRef, useState, useEffect } from 'react';

// Simple color palette utilities (derive variants of accent)
export const chartColors = [
  'var(--accent)',
  '#4cc9f0',
  '#f38ba8',
  '#94d82d',
  '#ffb347',
  '#c8b6ff',
  '#00b8a9',
  '#fab387'
];

interface SeriesPoint { x: string; y: number | null; }
interface LineSeries { id: string; label?: string; points: SeriesPoint[]; color?: string; }

interface LineChartProps { width?: number; height?: number; series: LineSeries[]; yLabel?: string; normalize?: boolean; showDots?: boolean; strokeWidth?: number; headroomPct?: number; }

export const LineChart: React.FC<LineChartProps> = ({ width=360, height=160, series, yLabel, normalize=false, showDots=true, strokeWidth=2, headroomPct=0.08 }) => {
  // Symmetric left/right padding; dynamic responsive wrapper will control width externally.
  const padding = { l: 40, r: 40, t: 22, b: 26 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const allX = series[0]?.points.map(p=>p.x) || [];
  const valueMax = useMemo(()=>{
    if(normalize) return 1;
    let m = 0; series.forEach(s=> s.points.forEach(p=>{ if(p.y!==null && p.y>m) m=p.y; }));
    // Add configurable headroom so top-most line doesn't collide with y-axis label or border
    return (m || 1) * (1 + headroomPct);
  }, [series, normalize]);
  const pathFor = (s:LineSeries) => {
    const pts = s.points;
    return pts.map((p,i)=>{
      // Slightly inset first & last points (2px) to guarantee stroke + dot fully visible
  const spanCount = Math.max(pts.length-1,1);
  const inset = 6; // px (wider so stroke + dot remain inside)
      const usableW = innerW - inset*2;
      const adjX = padding.l + inset + (i/spanCount)*usableW;
      const rawY = p.y===null? null : (normalize? (p.y! / (Math.max(...s.points.map(pp=>pp.y||0))||1)) : p.y!);
      const y = rawY===null? null : (padding.t + innerH - (rawY/valueMax)*innerH);
      return (i===0? `M ${adjX} ${y??0}`: (y===null? '': ` L ${adjX} ${y}`));
    }).join('');
  };
  // Y axis ticks (5)
  const ticks = Array.from({length:5}, (_,i)=> i/4);
  return (
    <svg width={width} height={height} role="img" aria-label={yLabel||'chart'}>
      <rect x={0} y={0} width={width} height={height} fill="rgba(255,255,255,0.03)" rx={8} />
      {/* Axes */}
      {ticks.map(t=>{ const y= padding.t + innerH - t*innerH; const val = normalize? (t*100).toFixed(0)+'%' : Math.round(t*valueMax); return (
        <g key={t}>
          <line x1={padding.l} x2={width-padding.r} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <text x={padding.l-6} y={y+4} fontSize={10} textAnchor="end" fill="rgba(255,255,255,0.55)">{val}</text>
        </g>
      ); })}
      {/* X labels */}
  {allX.map((x,i)=>{ const inset=6; const spanCount=Math.max(allX.length-1,1); const usableW= innerW - inset*2; const posX= padding.l + inset + (i/spanCount)*usableW; return (
        <text key={x} x={posX} y={height-6} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.55)">{x.slice(5)}</text>
      ); })}
      {series.map((s,si)=>{
        const color = s.color || chartColors[si % chartColors.length];
  return <path key={s.id} d={pathFor(s)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />;
      })}
  {showDots && series.map((s,si)=>{ const color = s.color || chartColors[si % chartColors.length]; return s.points.map((p,i)=>{ if(p.y===null) return null; const seriesMax = normalize? Math.max(...s.points.map(pp=>pp.y||0))||1 : valueMax; const val = normalize? (p.y! / seriesMax) * valueMax : p.y!; const inset=6; const spanCount=Math.max(s.points.length-1,1); const usableW= innerW - inset*2; const x= padding.l + inset + (i/spanCount)*usableW; const y = padding.t + innerH - (val/valueMax)*innerH; return <circle key={s.id+'_'+i} cx={x} cy={y} r={2.5} fill={color} />; }); })}
      {yLabel && <text x={padding.l} y={14} fontSize={11} fill="rgba(255,255,255,0.75)" fontWeight={600}>{yLabel}</text>}
    </svg>
  );
};

interface BarLineComboProps { width?:number; height?:number; bars:{ x:string; v:number }[]; line?:{ x:string; v:number }[]; label?:string; barColor?:string; lineColor?:string; }
export const BarLineCombo: React.FC<BarLineComboProps> = ({ width=360, height=160, bars, line, label, barColor='var(--accent)', lineColor='#f38ba8' }) => {
  const padding={ l:36,r:8,t:10,b:22 };
  const innerW= width-padding.l-padding.r; const innerH= height-padding.t-padding.b;
  const maxBar = Math.max(1, ...bars.map(b=>b.v));
  const allX = bars.map(b=>b.x);
  const maxLine = line && line.length? Math.max(...line.map(l=>l.v)) : 1;
  return (
    <svg width={width} height={height} role="img" aria-label={label||'chart'}>
      <rect x={0} y={0} width={width} height={height} fill="rgba(255,255,255,0.03)" rx={8} />
      {/* y ticks */}
      {Array.from({length:5},(_,i)=> i/4).map(t=>{ const y= padding.t + innerH - t*innerH; const val=Math.round(t*maxBar); return <g key={t}><line x1={padding.l} x2={width-padding.r} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" /><text x={padding.l-6} y={y+4} fontSize={10} textAnchor="end" fill="rgba(255,255,255,0.55)">{val}</text></g>; })}
      {bars.map((b,i)=>{ const x= padding.l + (i/allX.length)*innerW + 4; const w= innerW/allX.length - 8; const h= (b.v/maxBar)*innerH; const y= padding.t + innerH - h; return <rect key={b.x} x={x} y={y} width={w} height={h} fill={barColor} opacity={0.65} rx={2} />; })}
      {line && line.length>0 && (
        <path d={line.map((l,i)=>{ const x= padding.l + (i/(line.length-1))*innerW; const y= padding.t + innerH - (l.v/maxLine)*innerH; return (i===0? `M ${x} ${y}`: ` L ${x} ${y}`); }).join('')} stroke={lineColor} fill="none" strokeWidth={2} />
      )}
      {line && line.length>0 && line.map((l,i)=>{ const x= padding.l + (i/(line.length-1))*innerW; const y= padding.t + innerH - (l.v/maxLine)*innerH; return <circle key={l.x} cx={x} cy={y} r={2.5} fill={lineColor} />; })}
      {allX.map((x,i)=>{ const posX= padding.l + (i/(Math.max(allX.length-1,1)))*innerW; return <text key={x} x={posX} y={height-6} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.55)">{x.slice(5)}</text>; })}
      {label && <text x={padding.l} y={12} fontSize={11} fill="rgba(255,255,255,0.75)" fontWeight={600}>{label}</text>}
    </svg>
  );
};

interface StackedPercentBarsProps { width?:number; height?:number; buckets: { x:string; buckets:{ label:string; value:number; color?:string }[] }[]; label?:string; }
export const StackedPercentBars: React.FC<StackedPercentBarsProps> = ({ width=360, height=160, buckets, label }) => {
  const padding={ l:36,r:8,t:10,b:22 };
  const innerW= width-padding.l-padding.r; const innerH= height-padding.t-padding.b;
  return (
    <svg width={width} height={height} role="img" aria-label={label||'distribution'}>
      <rect x={0} y={0} width={width} height={height} fill="rgba(255,255,255,0.03)" rx={8} />
      {Array.from({length:5},(_,i)=> i/4).map(t=>{ const y= padding.t + innerH - t*innerH; return <line key={t} x1={padding.l} x2={width-padding.r} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />; })}
      {buckets.map((day,i)=>{ const total= day.buckets.reduce((a,b)=>a+b.value,0)||1; let acc=0; const x= padding.l + (i/buckets.length)*innerW + 4; const barW= innerW/buckets.length - 8; return (
        <g key={day.x}>
          {day.buckets.map((b,bi)=>{ const h= (b.value/total)*innerH; const y= padding.t + innerH - acc - h; acc += h; const color = b.color || chartColors[(bi)%chartColors.length]; return <rect key={b.label} x={x} y={y} width={barW} height={h} fill={color} opacity={0.8} />; })}
        </g>
      ); })}
      {buckets.map((d,i)=>{ const posX= padding.l + (i/(Math.max(buckets.length-1,1)))*innerW; return <text key={d.x} x={posX} y={height-6} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.55)">{d.x.slice(5)}</text>; })}
      {label && <text x={padding.l} y={12} fontSize={11} fill="rgba(255,255,255,0.75)" fontWeight={600}>{label}</text>}
    </svg>
  );
};

// Helper legend component
export const ChartLegend: React.FC<{ items:{ label:string; color:string }[] }> = ({ items }) => (
  <div style={{ display:'flex', flexWrap:'wrap', gap:10, fontSize:11, marginTop:6 }}>
    {items.map(i=> <span key={i.label} style={{ display:'inline-flex', alignItems:'center', gap:4 }}><span style={{ width:10, height:10, background:i.color, borderRadius:2 }} />{i.label}</span>)}
  </div>
);

// Utility to map daily snapshots to simple arrays
export interface DailySnapshot { date: string; counters: Record<string,number>; sums: Record<string,number>; }

export function deriveAvg(sumKey:string, countKey:string, s:DailySnapshot){ const sum = s.sums[sumKey]; const c = s.sums[countKey]; if(!sum || !c) return null; return sum / c; }

export default {};

// Responsive wrapper: auto-measures container width and renders LineChart full-width.
export const ResponsiveLineChart: React.FC<Omit<LineChartProps,'width'>> = (props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [w,setW] = useState<number>(600);
  useEffect(()=>{
    if(!ref.current) return;
    const ro = new ResizeObserver(entries=>{
      for(const e of entries){
        const cw = e.contentRect.width;
        if(cw && Math.abs(cw - w) > 4){ // slight hysteresis
          setW(cw);
        }
      }
    });
    ro.observe(ref.current);
    return ()=> ro.disconnect();
  },[w]);
  return <div ref={ref} style={{ width:'100%' }}><LineChart width={w} {...props} /></div>;
};
