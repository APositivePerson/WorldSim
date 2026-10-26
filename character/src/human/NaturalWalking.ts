import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
import { BalanceController, type RootReference } from "./BalanceController";
import { LegIK } from "./LegIK";
import { LocomotionSensors } from "./LocomotionSensors";
import { WholeBodyCoordinator } from "./WholeBodyCoordinator";
import {rollingFoot,rockerPitch} from "./FootRocker";
import type { WalkingCerebellum } from "./WalkingCerebellum";
const clamp = (v:number,limit:number) => Math.max(-limit,Math.min(limit,v));
const smooth = (u:number) => {u=Math.max(0,Math.min(1,u));return u*u*u*(10+u*(-15+6*u));};
export type WalkingObservations = Pick<LocomotionSensors,"feet"|"com"|"velocity"|"capture">;
type Foot = {x:number;y:number};

/** Continuous centroid reference and contact-confirmed alternating footsteps. */
export class NaturalWalking {
  readonly balance: BalanceController;
  readonly ik: LegIK;
  readonly coordinator: WholeBodyCoordinator;
  readonly root: RootReference = {x:0,y:0,z:.925,vx:0,vy:0,vz:0,ax:0,ay:0,az:0,groundWrench:true};
  private feet: Foot[] = [{x:.1,y:0},{x:-.1,y:0}];
  readonly footRoll=[{pitch:0,toe:0,phase:"全掌承重"},{pitch:0,toe:0,phase:"全掌承重"}];
  private swingStart: Foot = {x:0,y:0};
  private swingEnd: Foot = {x:0,y:0};
  private swing = 1;
  private time = 0;
  private duration = .6;
  private launched = false;
  private landingStable = 0;
  private last: Record<string,number> = {};
  private velocities: Record<string,number> = {};
  private accelerations:Record<string,number> = {};
  private counter = 0;
  rollingEnabled=true;
  reactiveEnabled=true;
  private reactiveForStep=true;
  private loadAdjust=[{push:0,transfer:0},{push:0,transfer:0}];
  private loadShift=0;
  private lastLoadSample=-1;
  private expectedLoad:{phase:0|1|2;speed:number;force:number;progress:number;valid:boolean}[]=[];
  private age = 0;
  private settling=false;
  private braking=false;
  private settleTime=0;
  private trajectoryDuration = 0;
  private landingLead = 0;
  private contextSpeed = 0;
  private airborne = false;
  private observedLanding = false;
  private contactStable = 0;
  private centerX = 0;
  private initialX = 0;
  private landingLock:{side:number;from:Foot;to:Foot;time:number}|null=null;
  private gains: {actuator:number;kp:number;bias:number;damping:number}[] = [];
  speed = 0;
  steps = 0;
  phase = "起步";
  walking = false;
  recordingPhase = .2;
  lift = 0;
  readonly landingCorrection = {x:0,y:0};
  constructor(readonly engine:MuJoCoEngine, readonly sensors:WalkingObservations, coordinator?:WholeBodyCoordinator,
    readonly cerebellum?:WalkingCerebellum, private state=()=>engine.data, readonly sensoryFeedback=false) {
    this.balance=new BalanceController(engine,state);this.ik=new LegIK(engine);this.coordinator=coordinator??new WholeBodyCoordinator(engine);
  }
  begin() {
    const d=this.state();
    this.end();
    const scale=Math.max(1,this.engine.totalMass/65.41), m=this.engine.model;
    if(Math.abs(scale-1)>1e-6) for(const j of this.engine.joints) if(/(hip|knee|ankle)/.test(j.name)) {
      const k=j.actuator*10;
      this.gains.push({actuator:j.actuator,kp:m.actuator_gainprm[k],bias:m.actuator_biasprm[k+1],damping:m.actuator_biasprm[k+2]});
      m.actuator_gainprm[k]*=scale;m.actuator_biasprm[k+1]*=scale;m.actuator_biasprm[k+2]*=scale;
    }
    this.loadAdjust=[{push:0,transfer:0},{push:0,transfer:0}];this.loadShift=0;this.lastLoadSample=-1;this.expectedLoad=[];
    this.walking=true;this.time=0;this.age=0;this.speed=0;this.steps=0;this.duration=.6;
    this.launched=false;this.landingStable=0;this.last={};this.velocities={};this.accelerations={};this.counter=0;
    this.footRoll.forEach(foot=>{foot.pitch=0;foot.toe=0;foot.phase="全掌承重";});
    this.landingLock=null;this.braking=false;this.settling=false;this.settleTime=0;
    this.feet=this.sensors.feet.map(f=>({x:f.x,y:f.y}));
    this.centerX=(this.feet[0].x+this.feet[1].x)/2;this.initialX=d.qpos[0];
    this.landingCorrection.x=0;this.landingCorrection.y=0;
    this.root.x=d.qpos[0];this.root.y=d.qpos[1];this.root.z=d.qpos[2];
    this.root.vz=0;this.root.az=0;
    this.cerebellum?.start();
  }
  update(dt:number, requestedSpeed:number, stopping:boolean, strength=1) {
    const d=this.state();
    this.age+=dt;
    // Sensors refresh at 100 Hz. Pair this observation with the previous
    // allocated wrench, never with the future command computed below.
    if(d.time-this.lastLoadSample>=.0099){
      this.lastLoadSample=d.time;
      if(!this.braking&&!this.settling&&d.qpos[2]>.88&&Math.hypot(d.qpos[4],d.qpos[5])<.05){
        this.expectedLoad.forEach((expected,i)=>{
          if(expected.valid&&this.sensors.feet[i].contact)
            this.cerebellum?.load.observe(i,expected.speed,expected.phase,expected.force,this.sensors.feet[i].force/(this.engine.totalMass*9.81),expected.progress);
        });
      }
    }
    if(this.landingLock){
      const lock=this.landingLock;lock.time+=dt;const s=smooth(lock.time/.1);
      this.feet[lock.side]={x:lock.from.x+(lock.to.x-lock.from.x)*s,y:lock.from.y+(lock.to.y-lock.from.y)*s};
      if(lock.time>=.1)this.landingLock=null;
    }
    // Finish the current swing at its planned speed before braking. Braking
    // midway used to leave the foot ahead of a prematurely stopped pelvis.
    if(stopping&&!this.launched)this.braking=true;
    const oldSpeed=this.speed;
    this.speed+=clamp((this.braking?0:requestedSpeed)-this.speed,(this.braking?.9:.65)*dt);
    this.time+=dt;
    const awaitingSupport=this.sensoryFeedback&&!this.launched&&
      !(this.sensors.feet[1-this.swing].contact&&this.sensors.feet[1-this.swing].force>this.engine.totalMass*9.81*.15)&&this.time>=.18*this.duration;
    if(awaitingSupport)this.time=.18*this.duration;
    const u=Math.min(1,this.time/this.duration);
    const sign=this.swing===1?1:-1;
    const recordingOffset=this.swing===1?.2:.7;
    let landed=false;
    const omega=Math.PI/this.duration, amplitude=.025;
    const blend=smooth(this.age/.6);
    if(!this.settling){
      this.root.x=this.initialX+(this.centerX-this.initialX)*smooth(this.age/.8)+sign*amplitude*Math.sin(Math.PI*u)*blend;
      const previousShift=this.loadShift;
      const shiftTarget=this.loadAdjust[0].transfer-this.loadAdjust[1].transfer;
      this.loadShift+=clamp(shiftTarget-this.loadShift,dt*.001);
      this.root.x+=this.loadShift;
      this.root.vx=sign*amplitude*omega*Math.cos(Math.PI*u)*blend+(this.loadShift-previousShift)/dt;
      this.root.ax=-sign*amplitude*omega*omega*Math.sin(Math.PI*u)*blend;
      this.root.y-=(this.sensoryFeedback&&(u>=1||awaitingSupport)?0:this.speed)*dt;
      this.root.vy=-this.speed;this.root.ay=-(this.speed-oldSpeed)/dt;
      if(this.sensoryFeedback&&(u>=1||awaitingSupport)){
        this.root.vx=0;this.root.vy=0;this.root.ax=0;this.root.ay=0;
      }
    }
    if(this.settling){
      const oldX=this.root.x,oldY=this.root.y,vx=this.root.vx??0,vy=this.root.vy??0;
      this.root.x+=clamp(((this.feet[0].x+this.feet[1].x)/2-this.root.x)*3,.025)*dt;
      this.root.y+=clamp(((this.feet[0].y+this.feet[1].y)/2-this.root.y)*3,.025)*dt;
      this.root.vx=(this.root.x-oldX)/dt;this.root.vy=(this.root.y-oldY)/dt;
      this.root.ax=clamp((this.root.vx-vx)/dt,1);this.root.ay=clamp((this.root.vy-vy)/dt,1);
      this.phase="双脚减速站稳";
    }
    this.lift=0;
    if(!this.settling&&!this.launched && u>=.18 && (!this.sensoryFeedback ||
      (this.sensors.feet[1-this.swing].contact&&this.sensors.feet[1-this.swing].force>this.engine.totalMass*9.81*.15))) {
      this.launched=true;this.swingStart={...this.feet[this.swing]};
      this.contextSpeed=this.speed;this.reactiveForStep=this.reactiveEnabled;
      this.loadAdjust=[0,1].map(side=>this.cerebellum?.load.corrections(side,this.contextSpeed)??{push:0,transfer:0});
      this.landingLead=this.cerebellum?.predict(this.swing,this.contextSpeed)??0;
      this.trajectoryDuration=.72*this.duration-this.landingLead;
      this.airborne=false;this.observedLanding=false;this.contactStable=0;
      this.landingCorrection.x=0;this.landingCorrection.y=0;
      const remaining=(1-u)*this.duration;
      const endSpeed=this.speed+clamp((this.braking?0:requestedSpeed)-this.speed,(this.braking?.9:.65)*remaining);
      this.swingEnd={x:this.centerX+(this.swing===0?.1:-.1),
        y:this.root.y-(this.speed+endSpeed)*.5*remaining-endSpeed*this.duration*.5};
    }
    if(this.launched) {
      const t=Math.min(1,Math.max(0,(this.time-.18*this.duration)/this.trajectoryDuration));
      const s=smooth(t);
      if(this.reactiveForStep&&!this.braking&&t<.65){
        // Compare measured capture point with the moving reference, retaining
        // the current COM-to-pelvis offset. Adjust early swing only.
        const omega=Math.sqrt(9.81/Math.max(.5,this.sensors.com.z));
        for(const axis of ["x","y"] as const){
          const k=axis==="x"?0:1;
          const expected=this.root[axis]+this.sensors.com[axis]-d.qpos[k]+(this.root[axis==="x"?"vx":"vy"]??0)/omega;
          const error=this.sensors.capture[axis]-expected;
          const correction=clamp(Math.sign(error)*Math.max(0,Math.abs(error)-.008)*.45,axis==="x"?.018:.025);
          this.landingCorrection[axis]+=clamp(correction-this.landingCorrection[axis],dt*.035);
        }
      }
      this.feet[this.swing]={x:this.swingStart.x+(this.swingEnd.x+this.landingCorrection.x-this.swingStart.x)*s,
        y:this.swingStart.y+(this.swingEnd.y+this.landingCorrection.y-this.swingStart.y)*s};
      this.lift=.035*Math.sin(Math.PI*t)**2;
      this.phase=t<1?`${this.swing===0?"左":"右"}脚摆动`:"接触确认";
    } else if(!this.settling)this.phase=awaitingSupport?"支撑不足 · 等待承重":"双脚支撑";
    const trajectory=this.launched?Math.min(1,Math.max(0,(this.time-.18*this.duration)/this.trajectoryDuration)):0;
    const rollScale=this.settling||!this.rollingEnabled?0:Math.min(1,this.speed/.5)*smooth(this.age/.6);
    const footTargets=this.feet.map((foot,i)=>{
      const desired=rockerPitch(u,i===this.swing,trajectory,rollScale,this.loadAdjust[i].push);
      this.footRoll[i].pitch+=clamp(desired-this.footRoll[i].pitch,dt*.8);
      const target=rollingFoot(foot.x,foot.y,i===this.swing?this.lift:0,this.footRoll[i].pitch);
      this.footRoll[i].toe=target.toe;
      this.footRoll[i].phase=i===this.swing&&this.lift>.003?"摆动离地":Math.abs(target.pitch)<.002?"全掌承重":target.phase;
      return target;
    });
    // Keep the stance leg extended, but lower the pelvis when the planned
    // foot separation needs more reach. A fixed low pelvis produced a squat.
    let reachableHeight=.94;
    footTargets.forEach((foot,i)=>{
      const dx=foot.x-this.root.x-(i===0?.1:-.1),dy=foot.y-this.root.y;
      reachableHeight=Math.min(reachableHeight,foot.z+.09+Math.sqrt(Math.max(.25,.755*.755-dx*dx-dy*dy)));
    });
    const height=this.settling ? .925 : .925+(Math.max(.89,reachableHeight)-.925)*smooth(this.age/.8);
    const oldVz=this.root.vz??0;
    this.root.vz=clamp((height-(this.root.z??.925))*15,.2);
    this.root.z=(this.root.z??.925)+this.root.vz*dt;
    this.root.az=clamp((this.root.vz-oldVz)/dt,3);
    if(this.launched){
      const foot=this.sensors.feet[this.swing];
      if(!foot.contact)this.airborne=true;
      this.contactStable=this.airborne&&u>.65&&foot.contact&&foot.force>this.engine.totalMass*9.81*.05?this.contactStable+dt:0;
      if(!this.observedLanding&&this.contactStable>=.012){
        this.observedLanding=true;
        if(d.qpos[2]>.88&&Math.hypot(d.qpos[4],d.qpos[5])<.08)
          this.cerebellum?.observe(this.swing,this.contextSpeed,.9*this.duration,this.time-this.contactStable+dt,this.landingLead);
      }
    }
    if(!this.settling&&u>=.9) {
      const foot=this.sensors.feet[this.swing];
      this.landingStable=foot.contact&&foot.force>this.engine.totalMass*9.81*.05?this.landingStable+dt:0;
      if(u>=(this.sensoryFeedback?.9:1)&&this.landingStable>=.012 && (!this.sensoryFeedback||this.airborne)) {
        landed=true;
      }
    }
    // Sample the side that generated this step. Switching sides before this
    // line used to insert a half-cycle arm/trunk jump on every landing frame.
    this.recordingPhase=recordingOffset+.5*u;
    this.counter++;
    if(this.counter%5===1 || !Object.keys(this.last).length) {
      const next=this.ik.solve(this.root,footTargets,this.last);
      footTargets.forEach((foot,i)=>{next[`${i===0?"left":"right"}_toe_flex`]=foot.toe;});
      for(const [name,value] of Object.entries(next)){
        const velocity=this.last[name]===undefined?0:clamp((value-this.last[name])/(dt*5),8);
        const acceleration=clamp((velocity-(this.velocities[name]??0))/(dt*5),60);
        this.accelerations[name]=(this.accelerations[name]??0)*.6+acceleration*.4;
        this.velocities[name]=velocity;
      }
      this.last=next;
    }
    const targets={...this.last};
    this.balance.apply(targets,this.root,this.swing,this.lift,this.sensors,this.accelerations);
    this.expectedLoad=this.balance.wrenches.map((w,i)=>({
      force:w[2]/(this.engine.totalMass*9.81),speed:this.contextSpeed,
      progress:i===this.swing||u<.18?u/.18:(u-.18)/.82,
      phase:(i===this.swing?2:u<.18?0:1) as 0|1|2,
      valid:this.age>.8&&!this.braking&&!this.settling&&Math.abs(requestedSpeed-this.speed)<.01
        &&(i!==this.swing||u<.18),
    }));
    for(const j of this.engine.joints) if(targets[j.name]!==undefined) {
      const gain=this.engine.model.actuator_gainprm[j.actuator*10];
      targets[j.name]+=(this.velocities[j.name]??0)*(-this.engine.model.actuator_biasprm[j.actuator*10+2])/gain;
    }
    this.coordinator.update(this.recordingPhase,!this.settling,strength,dt);
    if(this.settling){
      this.settleTime+=dt;
      if(this.settleTime>.8&&Math.hypot(d.qvel[0],d.qvel[1],d.qvel[2])<.03
        &&this.sensors.feet.every(foot=>foot.contact)
        &&Math.hypot(this.root.x-(this.feet[0].x+this.feet[1].x)/2,this.root.y-(this.feet[0].y+this.feet[1].y)/2)<.01)this.walking=false;
    }
    if(landed){
      const foot=this.sensors.feet[this.swing];
      this.landingLock={side:this.swing,from:{...this.feet[this.swing]},to:{x:foot.x,y:foot.y},time:0};
      this.steps++;this.swing=1-this.swing;
      this.time=0;this.launched=false;this.landingStable=0;
      this.duration=.62-.10*Math.min(1,this.speed);
      if(stopping&&this.speed<.03){this.settling=true;this.settleTime=0;}
    }
    return targets;
  }
  observation(){return {swing:this.swing,progress:this.launched?Math.min(1,Math.max(0,(this.time-.18*this.duration)/this.trajectoryDuration)):0,waiting:this.launched&&this.time>=this.duration,airborne:this.airborne};}
  mechanics(){return {feet:this.footRoll.map(foot=>({...foot})),
    corrections:this.loadAdjust.map(v=>({...v})),loadShift:this.loadShift};}
  references(){return {...this.last};}
  end(){
    this.cerebellum?.stop();
    const m=this.engine.model;
    for(const gain of this.gains){const k=gain.actuator*10;m.actuator_gainprm[k]=gain.kp;m.actuator_biasprm[k+1]=gain.bias;m.actuator_biasprm[k+2]=gain.damping;}
    this.gains=[];
  }
  dispose(){this.end();this.balance.dispose();this.ik.dispose();}
}
