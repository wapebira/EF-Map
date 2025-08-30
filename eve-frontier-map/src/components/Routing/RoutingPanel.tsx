import React, { useState } from 'react';
import P2PRouting from '../P2PRouting/P2PRouting';
import ScoutOptimizer from '../ScoutOptimizer/ScoutOptimizer';

interface RoutingPanelProps {
  onCalculateRoute: any;
  onStopCalculation?: () => void;
  isCalculating: boolean;
  routeResult: { path: string[] | null; error?: string } | null;
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
}

const RoutingPanel: React.FC<RoutingPanelProps> = (props) => {
  const [tab, setTab] = useState<'p2p'|'scout'>('p2p');
  return (
    <div>
      <div className="ef-tabs" role="tablist">
        <button className={`ef-tab-btn ${tab==='p2p'?'active':''}`} role="tab" aria-selected={tab==='p2p'} onClick={()=> setTab('p2p')}>Point to Point</button>
        <button className={`ef-tab-btn ${tab==='scout'?'active':''}`} role="tab" aria-selected={tab==='scout'} onClick={()=> setTab('scout')}>Scout Optimizer</button>
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
        />
      )}
    </div>
  );
};

export default RoutingPanel;
