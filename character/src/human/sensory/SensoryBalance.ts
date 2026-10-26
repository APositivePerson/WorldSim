import * as T from 'three';
import type {MuJoCoEngine} from '../../physics/MuJoCoEngine';
import {SensoryInterface,type SensoryOptions,type SensoryFrame} from './SensoryInterface';
import {BodyStateEstimator} from './BodyStateEstimator';
import {HeadEyeStabilizer} from './HeadEyeStabilizer';
import {BalanceController} from '../BalanceController';
import {NaturalWalking} from '../NaturalWalking';
import {WholeBodyCoordinator} from '../WholeBodyCoordinator';
import {LegIK} from '../LegIK';
export class SensoryBalance {
  lastFrame:SensoryFrame={time:0};
  readonly input:SensoryInterface;
  readonly estimate:BodyStateEstimator;
  readonly gaze=new HeadEyeStabilizer();
  readonly balance:BalanceController;
  readonly coordinator:WholeBodyCoordinator;
  readonly walking:NaturalWalking;
  private engine:MuJoCoEngine;
  private blindTime=0;
  safetyStop=false;
  private standRoot={x:0,y:0,z:.925};
  readonly com={x:0,y:0,z:1};
  readonly velocity={x:0,y:0,z:0};
  readonly capture={x:0,y:0};
  private previousCom:number[]=[];
  private observedAt=-1;
  private ik:LegIK;
  private targets:Record<string,number>={};
  private count=0;
  private pads:number[][]=[[0,0,0,0],[0,0,0,0]];
  private observedFeet=[0,1].map(()=>({x:0,y:0,z:.1,force:0,contact:false,slip:0,pressure:{x:0,y:0}}));
  constructor(engine:MuJoCoEngine){
    this.engine=engine;this.input=new SensoryInterface(engine);this.estimate=new BodyStateEstimator({mj:engine.mj,model:engine.model,joints:engine.joints,totalMass:engine.totalMass});
    this.balance=new BalanceController(engine,()=>this.estimate.data);this.ik=new LegIK(engine);
    this.coordinator=new WholeBodyCoordinator(engine,()=>this.data);
    this.walking=new NaturalWalking(engine,this,this.coordinator,undefined,()=>this.data,true);
    this.gaze.eyes.active=true;engine.sensoryEyes=this.gaze.eyes;
  }
  get referenceRoot(){return this.walking.walking?this.walking.root:this.standRoot;}
  get data(){return this.estimate.data;}
  configure(patch:Partial<SensoryOptions>){return this.input.configure(patch);}
  begin(){this.input.alignBodyRates=true;this.input.target.set(0,-100,1.65);this.blindTime=0;this.safetyStop=false;this.estimate.dynamic=true;this.estimate.locomoting=true;this.walking.begin();}
  reset(){this.lastFrame={time:0};this.walking.end();this.walking.walking=false;this.coordinator.reset();this.standRoot={x:0,y:0,z:.925};
    this.blindTime=0;this.safetyStop=false;this.previousCom=[];this.observedAt=-1;this.velocity.x=this.velocity.y=this.velocity.z=0;this.input.reset();this.input.target.set(0,-3,1.65);this.estimate.reset();this.gaze.reset();this.targets={};this.count=0;
    this.pads=[[0,0,0,0],[0,0,0,0]];this.observedFeet=this.estimate.anchors.map(p=>({x:p.x,y:p.y,z:p.z,force:0,contact:false,slip:0,pressure:{x:p.x,y:p.y}}));}
  update(time:number,dt:number,speed=.5,stopping=false,strength=1){
    const frame=this.input.sample(time,this.gaze.eyes);this.lastFrame=frame;
    this.estimate.update(frame);this.gaze.update(frame,dt,this.input.options.headEyes,this.estimate.bias);
    const d=this.data;
    this.pads=frame.plantar?.value.map(sole=>sole.pads.slice())??[[0,0,0,0],[0,0,0,0]];
    const ids=['left','right'].map(side=>this.engine.mj.mj_name2id(this.engine.model,1,side+'_foot'));
    this.observedFeet=ids.map((b,i)=>({x:d.xpos[b*3],y:d.xpos[b*3+1],z:d.xpos[b*3+2],force:frame.plantar?.value[i].force??0,
      contact:this.estimate.contactEstimate.feet[i].contact,slip:0,pressure:{x:d.xpos[b*3],y:d.xpos[b*3+1]}}));
    if(time-this.observedAt>=.0099||this.observedAt<0){
      const elapsed=time-this.observedAt,valid=this.observedAt>=0&&elapsed>0&&elapsed<.1;
      const alpha=valid?1-Math.exp(-elapsed*25):1;
      for(const [i,key] of (['x','y','z'] as const).entries()){
        this.com[key]=d.subtree_com[3+i];
        this.velocity[key]=valid?this.velocity[key]+(d.qvel[i]+((this.com[key]-d.qpos[i])-this.previousCom[i])/elapsed-this.velocity[key])*alpha:0;
      }
      this.previousCom=[this.com.x-d.qpos[0],this.com.y-d.qpos[1],this.com.z-d.qpos[2]];this.observedAt=time;
      const omega=Math.sqrt(9.81/Math.max(.5,this.com.z));
      this.capture.x=this.com.x+this.velocity.x/omega;this.capture.y=this.com.y+this.velocity.y/omega;
    }
    const root=this.standRoot;
    let output:Record<string,number>;
    if(this.walking.walking){
      this.blindTime=frame.vision?0:this.blindTime+dt;
      this.safetyStop ||= this.blindTime>.6||!frame.proprio||!frame.plantar||(!frame.vestibular&&!frame.vision);
      const cautious=!frame.vision||this.input.options.delayScale>1;
      output=this.walking.update(dt,Math.min(cautious?.25:.4,speed),stopping||this.safetyStop,strength);
      if(!this.walking.walking){
        this.estimate.dynamic=false;this.estimate.locomoting=false;
        this.estimate.anchors.forEach((p,i)=>{p.copy(new T.Vector3(this.feet[i].x,this.feet[i].y,.1));});
        this.standRoot={x:(this.estimate.anchors[0].x+this.estimate.anchors[1].x)/2,y:(this.estimate.anchors[0].y+this.estimate.anchors[1].y)/2,z:.925};
        this.walking.end();this.targets=this.walking.references();
      }
    }else{
      if(this.count++%5===0||!Object.keys(this.targets).length)this.targets=this.ik.solve(root,this.estimate.anchors.map(p=>({x:p.x,y:p.y,z:p.z})),this.targets);
      output={...this.targets,left_toe_flex:0,right_toe_flex:0};

      // During sensory startup use the calibrated two-foot stance prior.
      const support=frame.plantar?{feet:this.observedFeet}:undefined;
      this.balance.apply(output,root,1,0,support);
      this.coordinator.update(0,false,strength,dt);
    }
    if(this.input.options.headEyes){
      const {mj,model}=this.ik.engine,chest=mj.mj_name2id(model,1,'chest');
      const q=new T.Quaternion(d.xquat[chest*4+1],d.xquat[chest*4+2],d.xquat[chest*4+3],d.xquat[chest*4]);
      const e=new T.Euler().setFromQuaternion(q,'XYZ');
      output.neck_pitch=Math.max(-.15,Math.min(.15,-e.x*.8));output.neck_roll=Math.max(-.15,Math.min(.15,-e.y*.8));
    }
    return output;
  }
  get feet(){return this.observedFeet;}
  snapshot(){return {options:{...this.input.options},estimate:this.estimate.snapshot(),gaze:this.gaze.snapshot(),
    walking:{...this.walking.observation(),safetyStop:this.safetyStop,active:this.walking.walking,steps:this.walking.steps,phase:this.walking.phase,speed:this.walking.speed,landingCorrection:{...this.walking.landingCorrection}},target:this.input.target.toArray(),pads:this.pads.map(row=>row.slice())};}
  dispose(){this.gaze.eyes.active=false;this.walking.dispose();this.input.dispose();this.estimate.dispose();this.balance.dispose();this.ik.dispose();}
}
