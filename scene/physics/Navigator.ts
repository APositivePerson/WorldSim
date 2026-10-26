import {CLEARANCE,DESTINATIONS,OBSTACLES,blockingAlong,planDestination,segmentFree,type Point} from '../BankLayout';
import {wrap} from './Balance';
import type {BankController} from './BankController';
import {ElevationMap,captureDepth,type ElevationCell} from './LocalSensor';
export type NavigationEvent={id:number;time:number;kind:string;reason:string;source:string;position:Point;
  oldPath:Point[];newPath:Point[];cells:ElevationCell[];blockingCells:ElevationCell[];staticBlockers:string[];
  contacts:string[];replans:number};
export class Navigator {
  status='idle';target:string|null=null;location='entrance';error='';path:Point[]=[];
  private index=0;private elapsed=0;private timeout=0;private stable=0;
  obstaclePhase:'none'|'braking'|'waiting'='none';
  obstacleSource='';private obstacleTime=0;
  readonly localMap=new ElevationMap();replans=0;private scanTime=0;private retryTime=0;private hazard=false;
  readonly events:NavigationEvent[]=[];private eventId=0;
  planningAttempts=0;failureCode='';lastPlanningError='';private recoveryScan=0;
  private failedTargets=new Map<string,{reason:string;canRetry:boolean;checkedAt:number;mapAtFailure:string;lastCheckError:string}>();
  private mapSignature(){return this.localMap.obstacles.map(c=>`${c.x.toFixed(1)},${c.y.toFixed(1)},${c.maxZ.toFixed(1)}`).sort().join(';');}
  private fail(code:string,message:string){
    this.status='failed';this.failureCode=code;this.error=message;
    if(this.target)this.failedTargets.set(this.target,{reason:code,canRetry:false,checkedAt:Number(this.controller.engine.data.time??0),mapAtFailure:this.mapSignature(),lastCheckError:message});
    this.record('failed',message);this.controller.locomotion.stop();
  }
  private observeRecovery(dt:number){
    if(!this.failedTargets.size)return;
    this.recoveryScan+=dt;if(this.recoveryScan<2)return;this.recoveryScan=0;
    const e=this.controller.engine,d=e.data;this.localMap.update(this.sensor());
    for(const [target,recovery] of this.failedTargets){
      const wasRetryable=recovery.canRetry;
      recovery.checkedAt=Number(d.time??0);recovery.canRetry=false;recovery.lastCheckError='';
      // Replan exhaustion needs a changed map, not another identical automatic attempt.
      if(this.controller.locomotion.mode==='fallen'){recovery.lastCheckError='人物已跌倒，需要外部帮助或重置';continue;}
      if(recovery.reason!=='blocked_timeout'&&recovery.reason!=='replan_limit'){recovery.lastCheckError='该失败需要外部帮助，不能自动重复执行';continue;}
      if(recovery.reason==='replan_limit'&&recovery.mapAtFailure===this.mapSignature()){recovery.lastCheckError='重规划预算用尽且地图尚未变化';continue;}
      try{
        const start={x:d.qpos[0],y:d.qpos[1]},goal=DESTINATIONS[target];
        planDestination(start,goal,this.localMap.obstacles);recovery.canRetry=true;
        if(!wasRetryable)this.record('available',`重新观测并规划确认 ${target} 恢复可达；此前动作仍为失败，等待大脑决策`);
      }catch(error){recovery.lastCheckError=String(error);}
    }
  }
  remainingPath(){return this.path.slice(this.index).map(p=>({x:p.x,y:p.y}));}
  private record(kind:string,reason:string,oldPath=this.remainingPath(),newPath:Point[]=[]){
    const e=this.controller.engine,d=e.data,position={x:Number(d.qpos[0]),y:Number(d.qpos[1])};
    const cells=this.localMap.elevation,waypoint=oldPath[0],contacts=new Set<string>();
    // Contacts are supporting evidence only; they do not trigger replanning.
    const buffer=(d.ncon??0)>0?d.contact:null;
    try{for(let i=0;i<(d.ncon??0);i++){
      const c=buffer?.get(i);if(!c)continue;
      try{
        const a=e.model.geom_bodyid[c.geom1],b=e.model.geom_bodyid[c.geom2];
        if(e.isHumanBody(a)===e.isHumanBody(b))continue;
        const other=e.isHumanBody(a)?c.geom2:c.geom1;
        if(e.model.geom_type[other]===0)continue; // exclude the supporting ground plane
        contacts.add(e.mj.mj_id2name(e.model,5,other)||`geom_${other}`);
      }finally{c.delete();}
    }}finally{buffer?.delete();}
    this.events.push({id:++this.eventId,time:Number(d.time??this.elapsed),kind,reason,source:this.obstacleSource,
      position,oldPath:oldPath.map(p=>({...p})),newPath:newPath.map(p=>({...p})),cells,
      blockingCells:waypoint?blockingAlong(position,waypoint,this.localMap.obstacles):[],
      staticBlockers:waypoint?blockingAlong(position,waypoint,OBSTACLES).map(o=>o.name):[],
      contacts:[...contacts],replans:this.replans});
    if(this.events.length>80)this.events.shift();
  }
  constructor(readonly controller:BankController,readonly sensor=()=>captureDepth(controller.engine,controller.locomotion.yaw)){}
  checkObstacle(){
    if(this.status!=='running'||!this.path[this.index])return false;
    const d=this.controller.engine.data;
    return !segmentFree({x:d.qpos[0],y:d.qpos[1]},this.path[this.index],this.localMap.obstacles);
  }
  reportVisualObstacle(){
    if(this.obstaclePhase!=='none'||!this.checkObstacle())return false;
    this.hold('vision');return true;
  }
  private hold(source:string){
    this.obstaclePhase='braking';this.obstacleSource=source;this.obstacleTime=0;this.stable=0;this.retryTime=0;
    this.record('stop',source==='vision'?'视觉怀疑受阻，局部地图确认当前路段不可通行':'深度高程地图确认当前路段进入障碍安全范围');
    this.controller.locomotion.stop();
  }
  go(target:string){
    this.events.length=0;this.planningAttempts=0;this.failureCode='';this.lastPlanningError='';
    this.target=target;
    const goal=DESTINATIONS[target];if(!goal){this.error='未知地点';this.status='failed';return false;}
    if(this.controller.locomotion.mode==='fallen'){this.fail('fallen','人物已跌倒，请重新加载场景');return false;}
    const d=this.controller.engine.data;
    try{this.path=planDestination({x:d.qpos[0],y:d.qpos[1]},goal,this.localMap.obstacles);}catch(e){this.lastPlanningError=String(e);this.fail('blocked_timeout',`当前地图没有可用路线：${String(e)}`);return false;}
    this.target=target;this.location='moving';this.status='running';this.error='';this.index=0;this.elapsed=0;this.stable=0;
    this.obstaclePhase='none';this.obstacleSource='';this.obstacleTime=0;this.replans=0;this.hazard=false;
    let distance=0,last={x:d.qpos[0],y:d.qpos[1]};for(const p of this.path){distance+=Math.hypot(p.x-last.x,p.y-last.y);last=p;}
    this.timeout=distance*150+this.path.length*240+180;
    this.record('start','开始导航；规划使用已知家具与已观测地图',[],this.remainingPath());
    this.controller.executeAction({action:'reset_pose',duration:1});this.next();return true;
  }
  private next(){const p=this.path[this.index],d=this.controller.engine.data;
    const yaw=this.index===this.path.length-1?DESTINATIONS[this.target!].yaw:Math.atan2(this.path[this.index+1].x-p.x,-(this.path[this.index+1].y-p.y));
    // Tighten the landing reference beside furniture, keeping the actual
    // body within the existing clearance even with a few mm of stance sway.
    const clearance=Math.min(...[...OBSTACLES,...this.localMap.obstacles].map(o=>Math.max(Math.abs(p.x-o.x)-o.w/2-CLEARANCE,Math.abs(p.y-o.y)-o.d/2-CLEARANCE)));
    this.controller.locomotion.go({...p,yaw,tolerance:Math.max(.008,Math.min(.07,(clearance-.08)*.5))});
  }
  stop(){if(this.status==='running'){this.controller.locomotion.stop();this.status='interrupted';this.error='导航被打断';this.location='moving';}}
  update(dt:number){
    if(this.status!=='running'){this.observeRecovery(dt);return;}this.elapsed+=dt;
    const loco=this.controller.locomotion,d=this.controller.engine.data;
    if(loco.mode==='fallen'||this.elapsed>this.timeout){this.fail(loco.mode==='fallen'?'fallen':'navigation_timeout',loco.mode==='fallen'?'行走跌倒，请重新加载':'物理行走超时');return;}
    this.scanTime+=dt;
    if(this.scanTime>=.25){this.scanTime=0;this.localMap.update(this.sensor());this.hazard=this.checkObstacle();}
    const hazard=this.hazard;
    const waypoint=this.path[this.index];
    const heading=waypoint?Math.atan2(waypoint.x-d.qpos[0],-(waypoint.y-d.qpos[1])):loco.yaw;
    // Let an in-place turn finish before judging a partially seen forward route.
    if(this.obstaclePhase==='none'&&hazard&&Math.abs(wrap(heading-loco.yaw))<.25)this.hold('depth_elevation');
    if(this.obstaclePhase!=='none'){
      this.obstacleTime+=dt;
      this.stable=loco.settled?this.stable+dt:0;
      if(this.stable>=.3){
        this.obstaclePhase='waiting';
        this.retryTime-=dt;
        if(this.retryTime<=0){
          this.retryTime=2;
          this.planningAttempts++;
          try{
            // Plan with extra margin beyond the stop-check footprint, so gait sway
            // and quantized surface updates do not repeatedly invalidate a tangent route.
            const start={x:d.qpos[0],y:d.qpos[1]},goal=DESTINATIONS[this.target!];
            const route=planDestination(start,goal,this.localMap.obstacles);
            if(this.replans>=12)throw Error('重规划次数超过限制');
            const oldPath=this.remainingPath();
            this.path=route;this.index=0;this.replans++;
            this.record('replan','找到新路线；保留43厘米身体安全距离，额外余量最多12厘米，起终点附近按空间收缩',oldPath,route);
            this.timeout=Math.max(this.timeout,this.elapsed+route.length*300+1000);
            this.obstaclePhase='none';this.obstacleTime=0;this.stable=0;this.hazard=false;this.next();
          }catch(error){this.lastPlanningError=String(error);this.record('no_route',`本次规划未成功，停下继续观测：${String(error)}`);}
        }
      }
      if(this.obstacleTime>120)this.fail(this.replans>=12?'replan_limit':'blocked_timeout','前方障碍持续存在，已停止行走，请求帮助');
      return;
    }
    const p=this.path[this.index];
    if(loco.settled&&Math.hypot(d.qpos[0]-p.x,d.qpos[1]-p.y)<.08){this.stable+=dt;}else this.stable=0;
    if(this.stable<.3)return;this.stable=0;
    if(++this.index<this.path.length)this.next();
    else {
      const goal=DESTINATIONS[this.target!];
      if(Math.hypot(d.qpos[0]-goal.x,d.qpos[1]-goal.y)>=.08||Math.abs(wrap(loco.yaw-goal.yaw))>.12){this.fail('unstable_arrival','到达后位置或朝向未稳定');return;}
      this.status='completed';this.location=this.target!;
      this.failedTargets.delete(this.target!);
      this.record('arrived','位置与朝向稳定，导航完成');
    }
  }
  getState(){const d=this.controller.engine.data,p=this.target?DESTINATIONS[this.target]:null;return {status:this.status,target:this.target,location:this.location,error:this.error,path:this.path,replans:this.replans,
    planningAttempts:this.planningAttempts,failureCode:this.failureCode,lastPlanningError:this.lastPlanningError,blockedTime:this.obstacleTime,
    unavailable_targets:[...this.failedTargets].filter(([,r])=>!r.canRetry).map(([target])=>target),
    retryable_targets:[...this.failedTargets].filter(([,r])=>r.canRetry).map(([target])=>target),
    recovery:[...this.failedTargets].map(([target,r])=>({target,reason:r.reason,canRetry:r.canRetry,checkedAt:r.checkedAt,lastCheckError:r.lastCheckError})),
    observedCells:this.localMap.elevation.length,observedVoxels:this.localMap.voxelCount,obstaclePhase:this.obstaclePhase,obstacleSource:this.obstacleSource,distance:p?Math.hypot(d.qpos[0]-p.x,d.qpos[1]-p.y):0};}
}
