import {evaluateSenses} from "./sensory/SensoryDiagnostics";
import {SensoryBalance} from "./sensory/SensoryBalance";
import type {SensoryOptions} from "./sensory/SensoryInterface";
import { BalanceController, type RootReference } from "./BalanceController";
import { LegIK } from "./LegIK";
import { LocomotionSensors } from "./LocomotionSensors";
import { WholeBodyCoordinator } from "./WholeBodyCoordinator";
import { Cerebellum } from "./Cerebellum";
import { NaturalWalking } from "./NaturalWalking";
import { recordedLift, sampleWalk, walkSource } from "./motion/WalkReference";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
const clamp=(v:number,limit:number)=>Math.max(-limit,Math.min(limit,v));
const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*x*(10+x*(-15+6*x));};
type Foot={x:number;y:number};
/** Contact-gated, recorded-motion reference tracking with centroid feedback. */
export class LocomotionController {
  sensory:SensoryBalance|null=null;
  setSensoryMode(enabled:boolean){
    if(typeof enabled!=="boolean"||this.mode!=="stand")return false;
    if(enabled&&!this.sensory){this.sensory=new SensoryBalance(this.engine);this.coordinator.reset();if(this.requestedSpeed<.25)this.requestedSpeed=this.speed=.25;}
    else if(!enabled&&this.sensory){
      this.sensors.update();this.feet=this.sensors.feet.map(f=>({x:f.x,y:f.y}));
      this.root={x:this.sensory.data.qpos[0],y:this.sensory.data.qpos[1],z:.925,vx:0,vy:0};
      this.last={};this.counter=0;this.blend=0;this.coordinator.reset();this.sensory.dispose();this.sensory=null;this.engine.sensoryEyes=null;}
    return true;
  }
  configureSenses(options:Partial<SensoryOptions>){return this.sensory?.configure(options)??false;}
  mode: "stand" | "walk" | "fallen" = "stand";
  phase="双脚支撑";
  steps=0;
  private stopRequested=false;
  private time=0;
  private swing=1;
  private stage: "shift"|"swing"|"landing"="shift";
  private feet:Foot[]=[{x:.1,y:0},{x:-.1,y:0}];
  private root:RootReference={x:0,y:0,z:.925,vx:0,vy:0};
  private start:Foot={x:0,y:0};
  private swingStart:Foot={x:0,y:0};
  private swingEnd:Foot={x:0,y:0};
  private landingStable=0;
  private last:Record<string,number>={};
  private counter=0;
  private recordingPhase=.20;
  private strength=1;
  private requestedSpeed=.5;
  private speed=.5;
  private shiftDuration=.07/.03*.48;
  private swingDuration=.07/.03*.52;
  private blend=0;
  private stepLength=.07;
  private captureCorrection={x:0,y:0};
  private waiting=false;
  private balance:BalanceController;
  private ik:LegIK;
  private natural:NaturalWalking|null=null;
  private usingNatural=false;
  private naturalStartSteps=0;
  private mechanics={rolling:true,reactiveStepping:true};
  setWalkingMechanics(options:{rolling?:boolean;reactiveStepping?:boolean}){
    if(this.mode==="walk"||!options||Object.entries(options).some(([key,value])=>!["rolling","reactiveStepping"].includes(key)||typeof value!=="boolean"))return false;
    Object.assign(this.mechanics,options);return true;
  }
  readonly sensors:LocomotionSensors;
  readonly coordinator:WholeBodyCoordinator;
  readonly cerebellum = new Cerebellum();
  get armTargets(){return (this.sensory?.coordinator??this.coordinator).arms;}
  get bodyTargets(){return (this.sensory?.coordinator??this.coordinator).trunk;}
  get maximumNaturalSpeed(){return this.engine.totalMass>75||this.engine.legMuscleDrive!=='servo'?.25:.5;}
  constructor(readonly engine:MuJoCoEngine) {
    this.ik=new LegIK(engine);this.balance=new BalanceController(engine);
    this.sensors=new LocomotionSensors(engine);this.coordinator=new WholeBodyCoordinator(engine);
  }
  dispose(){this.sensory?.dispose();this.natural?.dispose();this.ik.dispose();this.balance.dispose();this.sensors.dispose();}
  setSpeed(value:number){
    if(this.sensory&&value<.25)return false;
    if(!Number.isFinite(value)||!((value>=.015&&value<=.045)||(value>=.25&&value<=this.maximumNaturalSpeed)))return false;
    if(this.mode==="walk"&&(value>=.25)!==this.usingNatural)return false;
    this.requestedSpeed=value;if(this.mode!=="walk")this.speed=value;return true;
  }
  setReferenceStrength(value:number){if(!Number.isFinite(value)||value<0||value>1)return false;this.strength=value;return true;}
  walk(){
    if(this.mode==="fallen"||this.mode==="walk")return;
    if(this.sensory){
      if(this.requestedSpeed<.25||!this.sensory.input.options.proprioception||!this.sensory.input.options.plantar||!this.sensory.feet.every(f=>f.contact)||this.sensory.estimate.quality.available<3)return;
      this.sensory.begin();this.naturalStartSteps=this.steps;this.stopRequested=false;this.mode="walk";return;
    }
    this.stopRequested=false;this.mode="walk";this.time=0;this.stage="shift";this.start={...this.root};
    this.usingNatural=this.requestedSpeed>=.25;
    if(this.usingNatural){
      this.natural??=new NaturalWalking(this.engine,this.sensors,this.coordinator,this.cerebellum.walking);
      this.naturalStartSteps=this.steps;this.natural.begin();
    }
    this.shiftDuration=.07/this.speed*.48;
  }
  stop(){if(this.mode==="walk")this.stopRequested=true;}
  reset(){
    this.natural?.end();this.sensory?.reset();
    if(this.requestedSpeed>=.25){this.requestedSpeed=Math.min(this.requestedSpeed,this.maximumNaturalSpeed);this.speed=this.requestedSpeed;}
    this.stopRequested=false;this.last={};this.counter=0;this.mode="stand";this.phase="双脚支撑";
    this.steps=0;this.time=0;this.swing=1;this.stage="shift";this.landingStable=0;
    this.feet=[{x:.1,y:0},{x:-.1,y:0}];this.root={x:0,y:0,z:.925,vx:0,vy:0};this.start={...this.root};
    this.recordingPhase=.20;this.blend=0;this.waiting=false;this.captureCorrection={x:0,y:0};
    this.usingNatural=false;
    this.sensors.reset();this.coordinator.reset();this.cerebellum.reset();
  }
  get settled(){
    const d=this.sensory?.data??this.engine.data;
    return this.mode==="stand"&&(this.sensory?.feet??this.sensors.feet).every(foot=>foot.contact)
      &&Math.hypot(d.qvel[0],d.qvel[1],d.qvel[2])<.03
      &&Math.abs(d.qpos[0]-(this.sensory?.referenceRoot.x??this.root.x))<.015&&Math.abs(d.qpos[1]-(this.sensory?.referenceRoot.y??this.root.y))<.015;
  }
  get cerebellumSafe(){
    const d=this.engine.data;
    return this.mode==="stand"&&d.qpos[2]>.88&&Math.hypot(d.qpos[4],d.qpos[5])<.12
      &&this.sensors.feet.every(foot=>foot.contact&&foot.slip<.1);
  }
  getReference(name:string){return this.last[name];}
  getState(){
    const d=this.engine.data,m=this.engine.model;
    const balance=(this.sensory?(this.sensory.walking.walking?this.sensory.walking.balance:this.sensory.balance):null)??(this.usingNatural&&this.mode==="walk"?this.natural!.balance:this.balance);
    const ids=["left","right"].map(side=>this.engine.mj.mj_name2id(m,1,`${side}_foot`));
    return {
      sensory:this.sensory?{...this.sensory.snapshot(),diagnostics:evaluateSenses(this.engine,this.sensory)}:null,
      mechanics:{...this.mechanics,...(this.usingNatural?this.natural?.mechanics():{})},
      mode:this.mode,phase:this.phase,steps:this.steps,pelvis:Array.from(d.qpos.slice(0,3)) as number[],contacts:d.ncon,
      footHeight:ids.map(b=>{const k=b*9,r=d.xmat;return d.xpos[b*3+2]-.055*r[k+7]-.055*r[k+8]-.07*Math.abs(r[k+6])-.15*Math.abs(r[k+7])-.045*Math.abs(r[k+8]);}),
      stopping:this.stopRequested,settled:this.settled,
      cerebellum:this.cerebellum.snapshot(),
      motion:{source:"CMU 07_01",sourceDuration:walkSource.duration,phase:((this.recordingPhase%1)+1)%1,strength:this.strength,blend:this.blend,speed:this.requestedSpeed,filteredSpeed:this.speed,
        gait:this.requestedSpeed>=.25?"natural":"careful",actualSpeed:Math.max(0,-this.sensors.velocity.y),maxSpeed:this.maximumNaturalSpeed},
      balance:{com:this.sensory?{x:this.sensory.data.subtree_com[3],y:this.sensory.data.subtree_com[4],z:this.sensory.data.subtree_com[5]}:{...this.sensors.com},velocity:this.sensory?{x:this.sensory.data.qvel[0],y:this.sensory.data.qvel[1],z:this.sensory.data.qvel[2]}:{...this.sensors.velocity},capturePoint:this.sensory?{x:this.sensory.data.subtree_com[3]+this.sensory.data.qvel[0]/Math.sqrt(9.81/Math.max(.5,this.sensory.data.subtree_com[5])),y:this.sensory.data.subtree_com[4]+this.sensory.data.qvel[1]/Math.sqrt(9.81/Math.max(.5,this.sensory.data.subtree_com[5]))}:{...this.sensors.capture},landingCorrection:{...(this.sensory?.walking.landingCorrection??this.captureCorrection)},waitingForSupport:this.waiting,
        feet:(this.sensory?.feet??this.sensors.feet).map(f=>({...f,pressure:{...f.pressure}})),wrenchResidual:{...balance.residual},wrenches:balance.wrenches.map(w=>w.slice())},
    };
  }
  private finishLanding(){
    const actual=this.sensors.feet[this.swing];
    // Lock the planted foot to the observed position, not a moving animation root.
    this.feet[this.swing]={x:actual.x,y:actual.y};
    this.steps++;this.swing=1-this.swing;this.stage="shift";this.time=0;this.start={...this.root};
    this.shiftDuration=.07/this.speed*.48;
    if(this.stopRequested){this.mode="stand";this.stopRequested=false;}
  }
  update(dt:number):Record<string,number>{
    if(this.sensory){
      this.sensors.update(); // Evaluation only.
      // Live pose below is only a fall monitor, never a feedback input.
      if(this.engine.data.qpos[2]<.65){this.mode="fallen";this.phase="跌倒：请重置";this.sensory.walking.end();this.sensory.walking.walking=false;}
      if(this.mode==="fallen")return {};
      this.sensory.walking.rollingEnabled=this.mechanics.rolling;
      this.sensory.walking.reactiveEnabled=this.mechanics.reactiveStepping;
      const output=this.sensory.update(this.engine.data.time,dt,this.requestedSpeed,this.stopRequested,this.strength);
      if(this.mode==="walk"){
        this.steps=this.naturalStartSteps+this.sensory.walking.steps;this.speed=this.sensory.walking.speed;
        this.phase=`感觉步态 · ${this.sensory.walking.phase}`;
        if(!this.sensory.walking.walking){this.mode="stand";this.stopRequested=false;}
      }else this.phase="感觉估计 · 双脚站立";
      return output;
    }
    this.sensors.update();const d=this.engine.data;
    if(d.qpos[2]<.65){this.natural?.end();this.cerebellum.cancel("跌倒，已取消本轮");this.mode="fallen";this.phase="跌倒：请重置";return {};}
    if(this.mode==="walk"&&this.usingNatural&&this.natural){
      this.natural.rollingEnabled=this.mechanics.rolling;
      this.natural.reactiveEnabled=this.mechanics.reactiveStepping;
      const result=this.natural.update(dt,this.requestedSpeed,this.stopRequested,this.strength);
      this.steps=this.naturalStartSteps+this.natural.steps;this.phase=`连续步态 · ${this.natural.phase}`;
      this.recordingPhase=this.natural.recordingPhase;this.speed=this.natural.speed;this.blend=Math.min(1,this.blend+dt*2);
      this.captureCorrection={...this.natural.landingCorrection};
      this.last=this.natural.references();this.root={...this.natural.root};
      if(!this.natural.walking){
        this.natural.end();
        this.mode="stand";this.stopRequested=false;this.usingNatural=false;
        this.blend=Math.max(0,Math.min(1,((this.root.z??.925)-.925)/.02));
        this.root.groundWrench=false;this.counter=0;
        this.feet=this.sensors.feet.map(foot=>({x:foot.x,y:foot.y}));
        this.root.vx=0;this.root.vy=0;this.root.vz=0;this.root.ax=0;this.root.ay=0;this.root.az=0;
      }
      return result;
    }
    const old={x:this.root.x,y:this.root.y};
    this.blend+=((this.mode==="walk"?1:0)-this.blend)*(1-Math.exp(-dt*2));
    this.speed+=(this.requestedSpeed-this.speed)*(1-Math.exp(-dt*2));
    // Latch each phase duration. Changing speed mid-swing must never rewind
    // the foot path or jump the reference phase.
    const shiftDuration=this.shiftDuration,swingDuration=this.swingDuration;
    let lift=0,pitch=0;this.waiting=false;
    if(this.mode==="walk"){
      this.time+=dt;const support=1-this.swing,foot=this.feet[support],side=this.swing===0?"left":"right";
      const offset=this.swing===1?.20:.70;
      if(this.stage==="shift"){
        const u=Math.min(1,this.time/shiftDuration),s=smooth(u);
        this.phase="参考动作 · 转移支撑";
        this.root.x=this.start.x+(foot.x*.65-this.start.x)*s;
        this.root.y=this.start.y+(foot.y-.025-this.start.y)*s;
        this.recordingPhase=offset+.10*u;
        if(this.time>=shiftDuration){
          const observation=this.sensors.feet[support];
          const captured=this.sensors.capture;
          const secure=observation.contact&&observation.force>this.engine.totalMass*9.81*.48
            &&Math.abs(captured.x-observation.x)<.085&&Math.abs(captured.y-observation.y)<.15;
          this.waiting=!secure;
          if(this.stopRequested){this.mode="stand";this.stopRequested=false;}
          else if(secure){
            this.stage="swing";this.time=0;this.swingStart={...this.feet[this.swing]};
            this.swingDuration=.07/this.speed*.52;
            // Capture-point correction is bounded to the reachable step region.
            this.captureCorrection.x=clamp((captured.x-this.root.x)*.12,.008);
            this.captureCorrection.y=clamp((this.sensors.velocity.y+this.speed)*.12,.010);
            this.stepLength=.07;
            this.swingEnd={x:(this.swing===0?.1:-.1)+this.captureCorrection.x,y:foot.y-this.stepLength+this.captureCorrection.y};
          }else this.phase="平衡修正 · 等待支撑稳定";
        }
      }else if(this.stage==="swing"){
        this.phase=`参考动作 · ${side==="left"?"左":"右"}脚摆动`;
        const u=Math.min(1,this.time/swingDuration),s=smooth(u);
        this.feet[this.swing]={x:this.swingStart.x+(this.swingEnd.x-this.swingStart.x)*s,y:this.swingStart.y+(this.swingEnd.y-this.swingStart.y)*s};
        const recorded=recordedLift(side,u),envelope=Math.sin(Math.PI*u)**2;
        lift=.026*((1-this.strength)*envelope+this.strength*(.65*recorded+.35*envelope));
        pitch=clamp(sampleWalk(`${side}_ankle`,offset+.10+.40*u)*.08,.045)*envelope*this.strength;
        this.recordingPhase=offset+.10+.40*u;
        // Keep the centroid moving during single support instead of freezing it.
        this.root.y=foot.y-.025-.012*s;
        if(this.time>=swingDuration){this.stage="landing";this.time=0;this.landingStable=0;}
      }else{
        this.phase="接触反馈 · 确认落地";
        const foot=this.sensors.feet[this.swing];
        this.landingStable=foot.contact&&foot.force>this.engine.totalMass*9.81*.06?this.landingStable+dt:0;
        if(this.landingStable>.05)this.finishLanding();
        else if(this.time>1.5){this.phase="平衡修正 · 等待落脚";this.waiting=true;}
      }
    }else if(this.mode==="stand"){
      this.phase="双脚支撑";const alpha=1-Math.exp(-dt*2);
      this.root.x+=((this.feet[0].x+this.feet[1].x)/2-this.root.x)*alpha;
      this.root.y+=((this.feet[0].y+this.feet[1].y)/2-this.root.y)*alpha;
    }
    this.root.z=.925+this.blend*(.020+clamp(sampleWalk("pelvis_height",this.recordingPhase)*.1,.002)*this.strength);
    const alpha=1-Math.exp(-dt*8);
    this.root.vx=(this.root.vx??0)+clamp(((this.root.x-old.x)/dt-(this.root.vx??0))*.20,.08)*alpha;
    this.root.vy=(this.root.vy??0)+clamp(((this.root.y-old.y)/dt-(this.root.vy??0))*.20,.08)*alpha;
    this.counter++;
    if(this.counter%10===1||Object.keys(this.last).length===0){
      this.last=this.ik.solve(this.root,this.feet.map((foot,i)=>({...foot,z:.1+(this.stage==="swing"&&i===this.swing?lift:0),pitch:this.stage==="swing"&&i===this.swing?pitch:0})),this.last);
    }
    const targets={...this.last};
    const tilt=2*Math.asin(Math.min(1,Math.hypot(d.qpos[4],d.qpos[5])));
    const correction=this.cerebellum.update(d.time,d.qpos[0],d.qvel[0],this.cerebellumSafe,tilt);
    this.balance.apply(targets,{...this.root,x:this.root.x+correction},this.swing,lift,this.sensors);
    this.coordinator.update(this.recordingPhase,this.mode==="walk",this.strength,dt);
    return targets;
  }
}
