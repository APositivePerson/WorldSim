import assert from 'node:assert/strict';
import {ElevationMap,captureDepth} from '../scene/physics/LocalSensor';
import {planPath,planDestination,segmentFree,DESTINATIONS,planningObstacles,free} from '../scene/BankLayout';
import {Navigator} from '../scene/physics/Navigator';
// Sensor fixture: two box surfaces on the same ray, no semantic labels.
const model={ngeom:2,geom_type:[6,6],geom_bodyid:[0,0],geom_contype:[1,1],geom_conaffinity:[1,1],geom_size:[.5,.1,.1,.5,.1,.1]};
const identity=[1,0,0,0,1,0,0,0,1];
const engine:any={model,data:{qpos:[0,-2.8,1],geom_xpos:[0,-1.3,.1,0,-.3,.1],geom_xmat:[...identity,...identity]},isHumanBody:()=>false};
const map=new ElevationMap();
assert.equal(captureDepth(engine,0).rays.filter(r=>r.hit).length,0,'behind is unseen');
const scan=captureDepth(engine,Math.PI);
assert(scan.rays.some(r=>r.hit&&scan.origin.z+r.dz*r.distance<=.22),'20 cm obstacle appears in head depth');
map.update(scan);assert(map.obstacles.length>0);
assert(map.elevation.some(c=>c.maxZ<=.21),'low obstacle has measured height');
model.geom_size[2]=1;engine.data.geom_xpos[2]=1;
const occlusion=new ElevationMap();occlusion.update(captureDepth(engine,Math.PI));
assert(occlusion.obstacles.every(o=>o.y<-.9),'tall first surface occludes the object behind');
model.geom_size[2]=.1;engine.data.geom_xpos[2]=.1;model.geom_contype[1]=0;model.geom_conaffinity[1]=0;
const navigationMap=new ElevationMap();navigationMap.update(captureDepth(engine,Math.PI));
const path=planPath(DESTINATIONS.entrance,DESTINATIONS.help_desk,navigationMap.obstacles);
assert(path.length>1);let prev=DESTINATIONS.entrance;
for(const p of path){assert(segmentFree(prev,p,navigationMap.obstacles));prev={...prev,...p};}
model.geom_contype.fill(0);model.geom_conaffinity.fill(0);
navigationMap.update(captureDepth(engine,Math.PI));assert.equal(navigationMap.obstacles.length,0,'free observation clears removed obstacle');
assert.throws(()=>planPath(DESTINATIONS.entrance,DESTINATIONS.help_desk,[{x:0,y:-1.3,w:9,d:.2}]),'blocked corridor has no route');
console.log('PASS limited view, first-hit occlusion, sensed detour, clearing and blocked route');
// State-machine integration: full visible barrier, no geometry registry in Navigator.
engine.model.geom_size=[5,.1,1,5,.1,.1];engine.data.geom_xpos[2]=1;engine.model.geom_contype=[1,0];
let stopped=0;
const controller:any={engine,executeAction:()=>true,locomotion:{mode:'stand',yaw:Math.PI,settled:true,
 stop:()=>stopped++,go:()=>{}}};
const nav=new Navigator(controller);assert(nav.go('help_desk'));
for(let i=0;i<20;i++)nav.update(.25);
assert.equal(nav.obstaclePhase,'waiting');assert(stopped>0);assert.equal(nav.status,'running');
engine.model.geom_contype[0]=0;
for(let i=0;i<20;i++)nav.update(.25);
assert.equal(nav.obstaclePhase,'none');assert(nav.replans>0,'resumes from sensed clearance alone');
const blocked=new Navigator(controller);assert(blocked.go('help_desk'));
blocked.update(.25);assert.equal(blocked.obstaclePhase,'none');
engine.model.geom_contype[0]=1; // Appears after navigation has already started.
for(let i=0;i<500;i++)blocked.update(.25);
assert.equal(blocked.status,'failed');
assert.equal(blocked.failureCode,'blocked_timeout');
assert(blocked.getState().unavailable_targets.includes('help_desk'));
assert(blocked.planningAttempts>1);
engine.model.geom_contype[0]=0;
for(let i=0;i<20;i++)blocked.update(.25);
assert.equal(blocked.status,'failed','clearance is new evidence, never retroactive action success');
assert(blocked.getState().retryable_targets.includes('help_desk'));
assert(!blocked.getState().unavailable_targets.includes('help_desk'));
console.log('PASS bounded blocked wait, sensor-driven resumption and failure escalation');
// Preserve the existing decision rule while exposing its quantization effect.
const lowFrame={origin:{x:0,y:-1.3,z:.1},yaw:Math.PI,range:3,
 rays:[{dx:0,dy:0,dz:-1,distance:.05,hit:true}]};
const lowMap=new ElevationMap();lowMap.update(lowFrame);
assert.equal(lowMap.elevation[0].maxObservedZ,.05);
assert.equal(lowMap.elevation[0].maxZ,.1);
assert.equal(lowMap.obstacles.length,1,'5 cm can become a blocking 10 cm voxel');
const lowNav=new Navigator(controller,()=>lowFrame);assert(lowNav.go('help_desk'));
for(let i=0;i<3;i++)lowNav.update(.25);
const trigger=lowNav.events.find(e=>e.kind==='stop')!;
const changed=lowNav.events.find(e=>e.kind==='replan')!;
assert(trigger&&changed,'records the observed stop and resulting replan separately');
assert.equal(trigger.source,'depth_elevation');
assert.equal(trigger.blockingCells[0].maxObservedZ,.05);
assert.equal(trigger.blockingCells[0].maxZ,.1);
assert.equal(trigger.contacts.length,0,'a map-triggered stop does not require a collision');
assert(changed.newPath.length>0);assert.notDeepEqual(changed.oldPath,changed.newPath);
const frozen=JSON.stringify(trigger);
lowNav.localMap.update({...lowFrame,rays:[{dx:0,dy:0,dz:-1,distance:3,hit:false}]});
assert.equal(JSON.stringify(trigger),frozen,'history remains a snapshot when the map changes');
assert(nav.events.some(e=>e.kind==='no_route'));
assert(blocked.events.length<=80,'diagnostic history is bounded');
console.log('PASS raw/quantized heights, stop/replan causes, route snapshots and bounded history');
const endpointCells=[{x:-.5,y:-1,w:.16,d:.16},{x:-.6,y:-1,w:.16,d:.16},{x:0,y:-1.3,w:.16,d:.16}];
const start=DESTINATIONS.entrance,goal=DESTINATIONS.help_desk;
assert(free(goal,endpointCells));
assert(!free(goal,endpointCells.map(o=>({...o,w:o.w+.24,d:o.d+.24}))),'reproduces old endpoint rejection');
const safePadding=planningObstacles(endpointCells,start,goal);
assert(free(goal,safePadding));
let last=start;
for(const point of planPath(start,goal,safePadding)){assert(segmentFree(last,point,safePadding));last={...start,...point};}
const blockedGoal=[{x:goal.x,y:goal.y,w:.16,d:.16}];
assert.throws(()=>planPath(start,goal,planningObstacles(blockedGoal,start,goal)),'never relax base clearance');
console.log('PASS extra margin preserves valid endpoints without allowing blocked goals');
const shifted=new ElevationMap();
const oldRay={origin:{x:.051,y:0,z:.2},yaw:Math.PI,range:3,rays:[{dx:0,dy:1,dz:0,distance:2,hit:true}]};
shifted.update(oldRay);assert.equal(shifted.elevation[0].x,.1);
const currentRay={...oldRay,origin:{x:0,y:0,z:.2},rays:[{dx:0,dy:1,dz:0,distance:3,hit:false}],
 grid:{hMin:0,hStep:3,hCount:1,vMin:0,vStep:5,vCount:1}};
const lineOnly=new ElevationMap();lineOnly.update(oldRay);lineOnly.update({...currentRay,grid:undefined});
assert.equal(lineOnly.voxelCount,1,'reproduces ghost voxel after a small viewpoint change');
shifted.update(currentRay);assert.equal(shifted.voxelCount,0,'new pixel evidence clears the old in-view point');
shifted.update(oldRay);shifted.update({...currentRay,rays:[{dx:0,dy:1,dz:0,distance:1,hit:true}]});
assert(shifted.elevation.some(c=>c.y===2),'a nearer surface must not clear occluded old points');
console.log('PASS viewpoint-shift cleanup with occlusion preservation');
// The observed ticket front at y=-1.98 rounds to -2.0. Its conservative voxel
// excludes the exact destination by 1 cm, even though the arrival region is free.
const ticketMap=[{x:-3.6,y:-2,w:.16,d:.16}],ticket=DESTINATIONS.ticket_machine;
assert(!free(ticket,ticketMap));
const ticketStart={x:-.516,y:-.788},ticketRoute=planDestination(ticketStart,ticket,ticketMap);
let ticketPrevious=ticketStart;
for(const p of ticketRoute){assert(segmentFree(ticketPrevious,p,ticketMap));ticketPrevious=p;}
assert(Math.hypot(ticketPrevious.x-ticket.x,ticketPrevious.y-ticket.y)<.061);
assert.throws(()=>planDestination(ticketStart,ticket,[{x:ticket.x,y:ticket.y,w:1,d:1}]));
console.log('PASS quantized destination selects a safe point within unchanged arrival tolerance');
const measuredFront=new ElevationMap();
measuredFront.update({origin:{x:-3.6,y:-2.98,z:1},yaw:Math.PI,range:3,rays:[{dx:0,dy:1,dz:0,distance:1,hit:true}]});
assert.equal(measuredFront.elevation[0].y,-2,'display grid retains quantized coordinates');
assert.equal(measuredFront.obstacles[0].y,-1.98,'planning uses the actual observed horizontal surface');
assert(Math.abs(measuredFront.obstacles[0].d-.16)<1e-12,'original surface uncertainty padding is preserved');
assert(free({x:-3.6,y:-2.507},measuredFront.obstacles));
assert(!free({x:-3.6,y:-2.48},measuredFront.obstacles),'does not shrink body clearance or surface uncertainty');
console.log('PASS surface bounds remove rounding inflation while retaining clearance and height quantization');
const actualGoal=DESTINATIONS.help_desk;
const finalEngine:any={data:{qpos:[0,-2.8,1],time:0},model:{},isHumanBody:()=>false};
const finalController:any={engine:finalEngine,executeAction:()=>true,locomotion:{mode:'stand',yaw:actualGoal.yaw,settled:true,go:()=>true,stop:()=>{}}};
const arrival=new Navigator(finalController,()=>({origin:{x:0,y:0,z:1},yaw:0,range:3,rays:[]}));
assert(arrival.go('help_desk'));
arrival.path=[{x:actualGoal.x+.06,y:actualGoal.y}];
finalEngine.data.qpos=[actualGoal.x+.1,actualGoal.y,1];
arrival.update(.25);arrival.update(.25);
assert.equal(arrival.failureCode,'unstable_arrival','near an alternate endpoint is not enough: actual named goal must remain within 8 cm');
console.log('PASS arrival region preserves measured error against the original named destination');
