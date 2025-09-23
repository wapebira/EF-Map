import React, { useState } from 'react';
import { track } from '../../utils/usage';
import P2PRouting from '../P2PRouting/P2PRouting';
import ScoutOptimizer from '../ScoutOptimizer/ScoutOptimizer';
import ReachabilitySection from './ReachabilitySection';

interface RoutingPanelProps {
  onCalculateRoute: (
    from: string,
    to: string,
    jumpDist: number,
    optimize: 'fuel' | 'jumps' | 'explore',
    algorithm: 'astar' | 'dijkstra',
    overheadPct?: number,
    exploreCorridorPct?: number,
    exploreProgressBiasPct?: number,
    smartGateMode?: 'none' | 'public' | 'authorized',
  ) => void;
  onStopCalculation?: () => void;
  isCalculating: boolean;
  routeResult: { path: string[] | null; error?: string; minRequiredShipRange?: number; meta?: { baselineCost?: number; finalCost?: number; baselineNodes?: number; finalNodes?: number } } | null;
  mapData: any;
  systemNames: string[];
  progress?: { explored: number; frontier: number; elapsedMs: number; message: string } | null;
  routeCalcTimeMs?: number | null;
  resetToken?: number;
  selectedSystemName?: string;
  selectedDestinationSystemName?: string;
  waypoints?: string[];
  avoidSystems?: string[];
  onRemoveWaypoint?: (name: string)=>void;
  onRemoveAvoidSystem?: (name: string)=>void;
  waypointOptimize?: boolean;
  onWaypointOptimizeChange?: (v:boolean)=>void;
  returnToStart: boolean;
  onReturnToStartChange:(v:boolean)=>void;
  scoutInvalidateToken?: number;
  importedScoutPath?: string[] | null;
  scoutResetToken?: number;
  onBaselineRoute?:(path:string[])=>void;
  onOptimizedRoute?:(path:string[])=>void;
  onScoutClearRoute?:()=>void;
  initialJumpDistance?: number;
  initialOptimizeFor?: 'fuel' | 'jumps' | 'explore';
  initialAlgorithm?: 'astar' | 'dijkstra';
  onRoutingParamChange?:(jump:number,opt:'fuel'|'jumps'|'explore',algo:'astar'|'dijkstra')=>void;
  // Smart Gate route notes helper map (fromSystemId-toSystemId -> itemId)
  smartGateItemByPair?: Record<string, number> | null;
  usedSmartGatePairs?: Set<string> | null;
  isLoggedIn?: boolean;
  // Planet legend filtering props
  planetBinsActive?: boolean[];
  minPlanets?: number;
  maxPlanets?: number;
  reachabilityProps?: {
    originSystemName?: string;
    range: number;
    auto: boolean;
    dim: boolean;
    bubble: boolean;
  inRange: boolean;
    stats: { reachable:number; total:number; ms:number }|null;
    disabled: string | null;
    computing: boolean;
    onCompute:(origin:string, range:number)=>void;
    onRangeChange:(r:number)=>void;
    onOriginChange:(o:string)=>void;
    onAutoChange:(v:boolean)=>void;
    onDimChange:(v:boolean)=>void;
    onBubbleChange:(v:boolean)=>void;
  onInRangeChange:(v:boolean)=>void;
  };
}

const RoutingPanel: React.FC<RoutingPanelProps> = (props) => {
  const [tab, setTab] = useState<'p2p'|'scout'|'reach'>('p2p');
  return (
    <div>
      <div className="ef-tabs" role="tablist">
        <button className={`ef-tab-btn ${tab==='p2p'?'active':''}`} role="tab" aria-selected={tab==='p2p'} onClick={()=> setTab('p2p')}>Point to Point</button>
        <button className={`ef-tab-btn ${tab==='scout'?'active':''}`} role="tab" aria-selected={tab==='scout'} onClick={()=> setTab('scout')}>Scout Optimizer</button>
  <button className={`ef-tab-btn ${tab==='reach'?'active':''}`} role="tab" aria-selected={tab==='reach'} onClick={()=> { setTab('reach'); try { track({ type:'reachability_tab_open' }); } catch {} }}>Reachability</button>
      </div>
      {tab==='p2p' && (
        <P2PRouting
          open={true}
          onToggle={()=>{}}
          embedded
          onCalculateRoute={props.onCalculateRoute}
          onStopCalculation={props.onStopCalculation}
          isCalculating={props.isCalculating}
          routeResult={props.routeResult}
          mapData={props.mapData}
          systemNames={props.systemNames}
          smartGateItemByPair={props.smartGateItemByPair||null}
          usedSmartGatePairs={props.usedSmartGatePairs||null}
          isLoggedIn={!!props.isLoggedIn}
          progress={props.progress}
          routeCalcTimeMs={props.routeCalcTimeMs}
          resetToken={props.resetToken}
          selectedSystemName={props.selectedSystemName}
          selectedDestinationSystemName={props.selectedDestinationSystemName}
          waypoints={props.waypoints}
          avoidSystems={props.avoidSystems}
          onRemoveWaypoint={props.onRemoveWaypoint}
          onRemoveAvoidSystem={props.onRemoveAvoidSystem}
          waypointOptimize={props.waypointOptimize}
          onWaypointOptimizeChange={props.onWaypointOptimizeChange}
          initialJumpDistance={props.initialJumpDistance}
          initialOptimizeFor={props.initialOptimizeFor}
          initialAlgorithm={props.initialAlgorithm}
          onParamChange={props.onRoutingParamChange}
        />
      )}
      {tab==='scout' && (
        <ScoutOptimizer
          open={true}
          onToggle={()=>{}}
          embedded
          mapData={props.mapData}
          systemNames={props.systemNames}
          returnToStart={props.returnToStart}
          onReturnToStartChange={props.onReturnToStartChange}
          invalidateToken={props.scoutInvalidateToken}
          importedRoutePath={props.importedScoutPath}
          resetToken={props.scoutResetToken}
          selectedSystemName={props.selectedSystemName}
          onBaselineRoute={props.onBaselineRoute}
          onOptimizedRoute={props.onOptimizedRoute}
          onClearRoute={props.onScoutClearRoute}
          planetBinsActive={props.planetBinsActive}
          minPlanets={props.minPlanets}
          maxPlanets={props.maxPlanets}
        />
      )}
      {tab==='reach' && props.reachabilityProps && (
        <ReachabilitySection
          originSystemName={props.reachabilityProps.originSystemName}
          systemNames={props.systemNames}
          onCompute={props.reachabilityProps.onCompute}
          onRangeChange={props.reachabilityProps.onRangeChange}
          onOriginChange={props.reachabilityProps.onOriginChange}
          range={props.reachabilityProps.range}
          auto={props.reachabilityProps.auto}
          onAutoChange={props.reachabilityProps.onAutoChange}
          dim={props.reachabilityProps.dim}
          onDimChange={props.reachabilityProps.onDimChange}
          bubble={props.reachabilityProps.bubble}
          onBubbleChange={props.reachabilityProps.onBubbleChange}
          inRange={props.reachabilityProps.inRange}
          onInRangeChange={props.reachabilityProps.onInRangeChange}
          lastStats={props.reachabilityProps.stats}
          disabledReason={props.reachabilityProps.disabled}
          computing={props.reachabilityProps.computing}
        />
      )}
    </div>
  );
};

export default RoutingPanel;
