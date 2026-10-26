import type {MuJoCoEngine} from '../../character/src/physics/MuJoCoEngine';
import {LegIK} from './LegIK';
import {Balance,clamp,wrap,type Foot} from './Balance';
import {LocomotionSensors} from '../../character/src/human/LocomotionSensors';
import {NaturalGait} from './NaturalGait';
const smooth=(u:number)=>{u=Math.max(0,Math.min(1,u));return u*u*u*(10+u*(-15+6*u));};
export class Locomotion {
  private get shiftDuration(){return this.engine.legMuscleDrive==='servo'?.5:.65;}
  private get swingDuration(){return this.engine.legMuscleDrive==='servo'?.65:.75;}
  private rootVelocity={x:0,y:0};
  mode:'stand'|'walk'|'fallen'='stand';steps=0;phase='双脚支撑';
  goal:(Foot&{tolerance?:number})|null=null;
  referenceStrength=1;
  feet:Foot[]=[{x:.1,y:0,yaw:0},{x:-.1,y:0,yaw:0}];
  root:Foot={x:0,y:0,yaw:0};
  private ik;private balance;private last:Record<string,number>={};
  private stage:'shift'|'swing'='shift';private time=0;private swing=1;private counter=0;
  private landingStable=0;
  private supportStable=0;
  private start:Foot={...this.root};private from:Foot={...this.feet[1]};private to:Foot={...this.feet[1]};
  private stopRequested=false;private aligning=false;
  readonly sensors:LocomotionSensors;
  private natural:NaturalGait;
  private naturalActive=false;
  private naturalSteps=0;
  private cruising=false;
  private preparingNatural=false;
  private cruiseStance:Foot|null=null;
  private standTime=0;
  private requestedSpeed=.5;
  private cruiseSpeedLimit=.5;
  private balanceSlowdown=0;
  private unsupportedTime=0;
  private warmup=0;
  get maximumNaturalSpeed(){return this.engine.legMuscleDrive==='servo'&&this.engine.totalMass<=75?.5:.25;}
  private get naturalSpeed(){return Math.min(this.requestedSpeed,this.maximumNaturalSpeed);}
  setSpeed(value:number){
    if(!Number.isFinite(value)||value<.25||value>this.maximumNaturalSpeed)return false;
    this.requestedSpeed=value;return true;
  }
  private beginNatural(heading:number,distance:number){
    this.cruiseSpeedLimit=Math.max(.25,distance*.5);
    this.balanceSlowdown=0;this.unsupportedTime=0;
    // After a turn or previous walk, establish a few measured contacts before
    // returning to full speed. The initial neutral upstream start is unchanged.
    this.warmup=this.steps>0?2:0;
    this.root.yaw=heading;this.natural.begin(heading);this.naturalSteps=this.steps;
    this.naturalActive=true;this.cruising=true;
  }
  private get naturalReady(){
    const d=this.engine.data;
    return this.stanceSettled&&Math.hypot(...Array.from(d.qvel.slice(0,6),Number))<.012
      &&Math.hypot(d.qpos[4],d.qpos[5])<.015
      &&this.engine.joints.filter(j=>/(hip|knee|ankle|toe)/.test(j.name)).every(j=>Math.abs(d.qvel[j.v])<.08);
  }
  private neutralStance(heading:number){
    const e=this.engine,d=e.data;
    const ids=['left','right'].map(side=>e.mj.mj_name2id(e.model,1,side+'_foot'));
    const dx=d.xpos[ids[0]*3]-d.xpos[ids[1]*3],dy=d.xpos[ids[0]*3+1]-d.xpos[ids[1]*3+1];
    const c=Math.cos(heading),s=Math.sin(heading);
    return Math.abs(c*dx+s*dy-.2)<.015&&Math.abs(-s*dx+c*dy)<.02&&ids.every(b=>{
      const k=b*9;return Math.abs(wrap(Math.atan2(d.xmat[k+3],d.xmat[k])-heading))<.03&&Math.hypot(d.xmat[k+6],d.xmat[k+7])<.04;
    });
  }
  get naturalCoordinator(){return this.naturalActive?this.natural.gait.coordinator:null;}
  constructor(readonly engine:MuJoCoEngine){
    this.sensors=new LocomotionSensors(engine);
    this.natural=new NaturalGait(engine,this.sensors);
    this.ik=new LegIK(engine);this.balance=new Balance(engine);
    const d=engine.data;this.root={x:d.qpos[0],y:d.qpos[1],yaw:this.yaw};
    this.feet=['left','right'].map(side=>{const b=engine.mj.mj_name2id(engine.model,1,side+'_foot');return{x:d.xpos[b*3],y:d.xpos[b*3+1],yaw:this.yaw};});
    this.start={...this.root};
  }
  go(goal:Foot&{tolerance?:number}){
    if(this.mode==='fallen')return false;
    const d=this.engine.data,heading=Math.atan2(goal.x-d.qpos[0],-(goal.y-d.qpos[1]));
    const distance=Math.hypot(goal.x-d.qpos[0],goal.y-d.qpos[1]);
    const launch=this.naturalReady&&this.neutralStance(heading)&&distance>.35&&Math.abs(wrap(heading-this.yaw))<.03;
    this.goal={...goal};this.aligning=false;this.cruiseStance=null;this.preparingNatural=false;
    if(this.mode==='stand'){this.mode='walk';this.stage='shift';this.time=0;this.supportStable=0;this.start={...this.root};}
    this.stopRequested=false;
    if(launch)this.beginNatural(heading,distance);
    return true;
  }
  stop(){this.stopRequested=true;this.goal=null;this.preparingNatural=false;}
  // Pace the upstream captured upper-body reference using bank step phases.
  get motionPhase(){return this.naturalActive?this.natural.gait.recordingPhase:((this.swing===1?.2:.7)+(this.stage==='shift'?.1*Math.min(1,this.time/this.shiftDuration):.1+.4*Math.min(1,this.time/this.swingDuration)))%1;}
  get yaw(){const q=this.engine.data.qpos;return Math.atan2(2*(q[3]*q[6]+q[4]*q[5]),1-2*(q[5]**2+q[6]**2));}
  get support(){
    // Status polling must not reschedule the sensory filters or landing
    // observations. Sampling belongs to the fixed physics update only.
    return this.sensors.feet.map(foot=>foot.force);
  }
  // Match navigation's 8 cm position tolerance. A stationary, loaded stance may
  // differ a few cm from the IK reference after turns; that is not instability.
  private get stanceSettled(){const d=this.engine.data;return this.mode==='stand'&&Math.hypot(...Array.from(d.qvel.slice(0,6),Number))<.04&&Math.hypot(d.qpos[0]-this.root.x,d.qpos[1]-this.root.y)<.08&&Math.abs(wrap(this.yaw-this.root.yaw))<.1&&this.support.every(f=>f>10);}
  get settled(){return !this.preparingNatural&&this.stanceSettled;}
  getState(){return {mode:this.mode,phase:this.phase,steps:this.steps,pelvis:Array.from(this.engine.data.qpos.slice(0,3)),yaw:this.yaw,settled:this.settled,goal:this.goal,support:this.support,reference:{...this.root},contacts:this.engine.data.ncon,speed:Math.hypot(...Array.from(this.engine.data.qvel.slice(0,6),Number)),
    motion:{source:'CMU 07_01',phase:this.motionPhase,gait:this.naturalActive?'natural':'precision',speed:this.naturalSpeed,maxSpeed:this.maximumNaturalSpeed,warmup:this.warmup>0,balanceSlowdown:this.balanceSlowdown>0,targetSpeed:this.naturalActive?Math.min(this.naturalSpeed,this.cruiseSpeedLimit,this.balanceSlowdown>0||this.warmup>0?.25:.5):this.naturalSpeed,actualSpeed:Math.hypot(this.engine.data.qvel[0],this.engine.data.qvel[1])},
    walkingLearning:this.natural.learning.snapshot(),
    balance:{com:{...this.sensors.com},velocity:{...this.sensors.velocity},capturePoint:{...this.sensors.capture},feet:this.sensors.feet.map(f=>({...f,pressure:{...f.pressure}}))}};}
  update(dt:number){
    this.sensors.update();
    const d=this.engine.data;if(d.qpos[2]<.65||!Number.isFinite(d.qpos[2])){this.mode='fallen';return {};}
    const previousRoot={...this.root};
    if(this.preparingNatural&&this.goal&&this.standTime>1&&this.naturalReady&&this.neutralStance(this.cruiseStance?.yaw??this.root.yaw)){
      this.beginNatural(this.cruiseStance?.yaw??this.yaw,Math.hypot(this.goal.x-d.qpos[0],this.goal.y-d.qpos[1]));
      this.naturalActive=true;this.preparingNatural=false;this.cruising=true;this.mode='walk';
    }
    if(this.naturalActive){
      const distance=this.goal?Math.hypot(this.goal.x-d.qpos[0],this.goal.y-d.qpos[1]):0;
      const heading=this.goal?Math.atan2(this.goal.x-d.qpos[0],-(this.goal.y-d.qpos[1])):this.yaw;
      const reference=this.natural.world(this.natural.gait.root);
      const trackingError=Math.hypot(reference.x-d.qpos[0],reference.y-d.qpos[1]);
      const tilt=2*Math.asin(Math.min(1,Math.hypot(d.qpos[4],d.qpos[5])));
      this.unsupportedTime=this.sensors.feet.some(f=>f.contact)?0:this.unsupportedTime+dt;
      if(trackingError>.035||tilt>.06||this.unsupportedTime>.025)this.balanceSlowdown=1.2;
      else this.balanceSlowdown=Math.max(0,this.balanceSlowdown-dt);
      this.warmup=Math.max(0,this.warmup-dt);
      const speed=Math.min(this.naturalSpeed,this.cruiseSpeedLimit,this.balanceSlowdown>0||this.warmup>0?.25:.5);
      const observed=this.natural.gait.observation(),v=this.natural.gait.speed;
      const offset=observed.swing===1?.2:.7;
      const cycle=Math.min(1,((this.natural.gait.recordingPhase-offset)%1+1)%1*2);
      // Native gait brakes immediately in double support; only a launched
      // swing must finish first. Counting a whole step here stopped too early.
      const remaining=cycle<.18?0:(.62-.1*v)*(1-cycle);
      const stoppingDistance=.04+v*remaining+v*v/(2*.9);
      if(this.stopRequested||!this.goal||distance<stoppingDistance||Math.abs(wrap(heading-this.root.yaw))>.3)this.cruising=false;
      const targets=this.natural.update(dt,speed,!this.cruising,this.referenceStrength);
      const g=this.natural.gait,p=this.natural.world(g.root);this.root={...p,yaw:this.root.yaw};
      this.steps=this.naturalSteps+g.steps;this.phase=`连续步态 · ${g.phase}`;
      if(!g.walking){
        g.end();this.naturalActive=false;this.cruiseStance=null;this.sensors.update();
        this.feet=this.sensors.feet.map(f=>({x:f.x,y:f.y,yaw:this.yaw}));
        this.root={x:d.qpos[0],y:d.qpos[1],yaw:this.yaw};this.start={...this.root};this.rootVelocity={x:0,y:0};
        this.last={};this.stage='shift';this.time=0;
        const arrived=this.goal&&Math.hypot(this.goal.x-d.qpos[0],this.goal.y-d.qpos[1])<(this.goal.tolerance??.07)&&Math.abs(wrap(this.goal.yaw-this.yaw))<.1;
        if(this.stopRequested||!this.goal||arrived){this.mode='stand';this.stopRequested=false;}
      }
      return targets;
    }
    const mid=()=>({x:(this.feet[0].x+this.feet[1].x)/2,y:(this.feet[0].y+this.feet[1].y)/2,yaw:this.feet[0].yaw+wrap(this.feet[1].yaw-this.feet[0].yaw)/2});
    let lift=0;
    if(this.mode==='walk'){
      this.time+=dt;const support=this.feet[1-this.swing],center=mid();
      if(this.stage==='shift'){
        this.phase='重心转移';const u=smooth(this.time/this.shiftDuration),c=Math.cos(center.yaw),s=Math.sin(center.yaw);
        const lateral=(support.x-center.x)*c+(support.y-center.y)*s;
        const fore=(support.x-center.x)*s-(support.y-center.y)*c+.025;
        const transfer=this.engine.legMuscleDrive==='servo'?.4:.55;
        this.root={x:this.start.x+(center.x+transfer*lateral*c+fore*s-this.start.x)*u,
          y:this.start.y+(center.y+transfer*lateral*s-fore*c-this.start.y)*u,yaw:this.start.yaw+wrap(center.yaw-this.start.yaw)*u};
        const loaded=this.sensors.feet[1-this.swing];
        this.supportStable=loaded.contact&&loaded.force>this.engine.totalMass*9.81*.55?this.supportStable+dt:0;
        if(this.time>=this.shiftDuration&&this.supportStable<.025)this.phase='重心转移 / 等待足底承重';
        if(this.time>=this.shiftDuration&&this.supportStable>=.025){
          const distance=this.goal?Math.hypot(this.goal.x-center.x,this.goal.y-center.y):0;
          if(distance<.18)this.aligning=true;
          const heading=this.goal?Math.atan2(this.goal.x-center.x,-(this.goal.y-center.y)):center.yaw;
          if(!this.stopRequested&&this.goal&&distance>.35&&Math.abs(wrap(heading-this.yaw))<.12){
            this.cruiseStance??={...center,yaw:heading};
            const pivot=this.cruiseStance;
            const stance=[1,-1].map(sign=>({x:pivot.x+sign*.1*Math.cos(pivot.yaw),y:pivot.y+sign*.1*Math.sin(pivot.yaw),yaw:pivot.yaw}));
            const ready=(i:number)=>Math.hypot(this.feet[i].x-stance[i].x,this.feet[i].y-stance[i].y)<.005&&Math.abs(wrap(this.feet[i].yaw-pivot.yaw))<.02;
            if(ready(0)&&ready(1)){
              this.preparingNatural=true;this.mode='stand';
            }else{
              if(ready(this.swing))this.swing=1-this.swing;
              this.to=stance[this.swing];this.from={...this.feet[this.swing]};
              this.stage='swing';this.time=0;this.landingStable=0;this.start={...this.root};
              // Finish this precision foot placement before starting a continuous cycle.
              const targets={...this.last};this.balance.apply(targets,this.root,this.feet,this.swing,0);return targets;
            }
          }
          if(this.preparingNatural){
            // Standing recentres smoothly before the native gait takes over.
          }else if(this.stopRequested||!this.goal||(distance<(this.goal.tolerance??.07)&&Math.abs(wrap(this.goal.yaw-center.yaw))<.01)){
            this.mode='stand';this.stopRequested=false;
          }else{
            const heading=this.aligning?this.goal.yaw:Math.atan2(this.goal.x-center.x,-(this.goal.y-center.y));
            const angle=wrap(heading-center.yaw),nextYaw=center.yaw+clamp(angle,this.engine.legMuscleDrive==='servo'?.5:.35);
            const sign=this.swing===0?1:-1;
            if(Math.abs(angle)>.2||this.aligning){
              const pivot=this.aligning?this.goal:center;
              this.to={x:pivot.x+sign*.1*Math.cos(nextYaw),y:pivot.y+sign*.1*Math.sin(nextYaw),yaw:nextYaw};
            }else{
              const step=Math.min(this.engine.legMuscleDrive==='servo'?.1:.07,distance);
              this.to={x:support.x+sign*.2*Math.cos(nextYaw)+step*Math.sin(nextYaw),y:support.y+sign*.2*Math.sin(nextYaw)-step*Math.cos(nextYaw),yaw:nextYaw};
            }
            this.from={...this.feet[this.swing]};this.stage='swing';this.time=0;this.landingStable=0;this.start={...this.root};
          }
        }
      }else{
        this.phase=this.swing===0?'左脚迈步 / 转向':'右脚迈步 / 转向';const u=Math.min(1,this.time/this.swingDuration),s=smooth(u);
        this.feet[this.swing]={x:this.from.x+(this.to.x-this.from.x)*s,y:this.from.y+(this.to.y-this.from.y)*s,yaw:this.from.yaw+wrap(this.to.yaw-this.from.yaw)*s};
        this.root.yaw=this.start.yaw+wrap(mid().yaw-this.start.yaw)*s;
        lift=.025*Math.sin(Math.PI*u)**2;
        const observed=this.sensors.feet[this.swing];
        this.landingStable=u>=1&&observed.contact&&observed.force>this.engine.totalMass*9.81*.05&&observed.slip<.08?this.landingStable+dt:0;
        if(this.landingStable>=.03){
          // A completed step is a loaded contact, not an elapsed animation.
          // Lock the next support reference to the measured landing position.
          const body=this.engine.mj.mj_name2id(this.engine.model,1,this.swing===0?'left_foot':'right_foot');
          this.feet[this.swing]={x:observed.x,y:observed.y,yaw:Math.atan2(d.xmat[body*9+3],d.xmat[body*9])};
          this.steps++;this.swing=1-this.swing;this.stage='shift';this.time=0;this.supportStable=0;this.start={...this.root};
          if(this.stopRequested){this.mode='stand';this.stopRequested=false;}
        }
      }
    }else if(this.mode==='stand'){
      this.phase='双脚支撑';const m=mid(),a=1-Math.exp(-dt*2);this.root.x+=(m.x-this.root.x)*a;this.root.y+=(m.y-this.root.y)*a;this.root.yaw+=wrap(m.yaw-this.root.yaw)*a;
      this.standTime+=dt;
      // A loaded foot can remain stuck in yaw after braking. Correct that
      // residual with another measured step instead of waiting forever.
      const distance=this.goal?Math.hypot(this.goal.x-d.qpos[0],this.goal.y-d.qpos[1]):0;
      const yawError=this.goal?Math.abs(wrap(this.goal.yaw-this.yaw)):0;
      if(!this.preparingNatural&&this.goal&&this.standTime>1&&Math.hypot(d.qvel[0],d.qvel[1],d.qvel[2])<.02
        &&distance<.35&&(distance>.08||yawError>.12||(!this.stanceSettled&&(distance>.04||yawError>.1)))){
        this.feet=['left','right'].map(side=>{const b=this.engine.mj.mj_name2id(this.engine.model,1,side+'_foot');return{x:d.xpos[b*3],y:d.xpos[b*3+1],yaw:Math.atan2(d.xmat[b*9+3],d.xmat[b*9])};});
        this.root={x:d.qpos[0],y:d.qpos[1],yaw:this.yaw};this.start={...this.root};
        this.aligning=true;this.mode='walk';this.stage='shift';this.time=0;this.standTime=0;
      }
    }
    if(this.mode!=='stand')this.standTime=0;
    if(++this.counter%10===1||!Object.keys(this.last).length)this.last=this.ik.solve(this.root,this.feet.map((f,i)=>({...f,z:.1+(this.stage==='swing'&&i===this.swing?lift:0)})),this.last);
    const vx=clamp((this.root.x-previousRoot.x)/dt,.8),vy=clamp((this.root.y-previousRoot.y)/dt,.8);
    const ax=clamp((vx-this.rootVelocity.x)/dt,3),ay=clamp((vy-this.rootVelocity.y)/dt,3);
    this.rootVelocity={x:vx,y:vy};
    const targets={...this.last};this.balance.apply(targets,{...this.root,vx,vy,ax,ay,vyaw:clamp(wrap(this.root.yaw-previousRoot.yaw)/dt,1.5)},this.feet,this.swing,lift);return targets;
  }
  dispose(){this.natural.dispose();this.ik.dispose();this.balance.dispose();this.sensors.dispose();}
}
