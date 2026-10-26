import type {MuJoCoEngine} from '../../character/src/physics/MuJoCoEngine';
import {actions} from '../../character/src/human/ActionDefinitions';
import {relaxedHands, handPose, type Side, type FingerName, fingerNames} from '../../character/src/human/Anatomy';
import {MuscleController} from '../../character/src/human/MuscleController';
import {ReachTask} from '../../character/src/human/ReachTask';
import {WholeBodyCoordinator} from '../../character/src/human/WholeBodyCoordinator';
import {Locomotion} from './Locomotion';
import {LegMuscleController,type LegDriveMode} from '../../character/src/human/neuromuscular/LegMuscleController';
import {PhysicalEyes} from '../../character/src/human/neuromuscular/PhysicalEyes';

type Command={action:string;duration?:number;target?:[number,number,number]};
type Segment={pose:Record<string,number>;duration:number};
/** Bank navigation owns legs; upstream components own reaching, hands and motion references.
 * Never run the upstream straight-line leg controller alongside bank navigation. */
export class BankController {
  readonly locomotion:Locomotion;
  readonly muscles:MuscleController;
  readonly reach:ReachTask;
  readonly coordinator:WholeBodyCoordinator;
  readonly legMuscles:LegMuscleController;
  readonly physicalEyes:PhysicalEyes;
  status='idle';action='wait';error='';
  commandId:string|number|null=null;
  private targets:Record<string,number>=relaxedHands();
  private starts:Record<string,number>={};
  private owned=new Set<string>();
  private pending:Segment[]=[];
  private elapsed=0;private duration=2;private strength=1;
  constructor(readonly engine:MuJoCoEngine){
    // Match upstream's default motor mode, including disabling passive tendons.
    this.muscles=new MuscleController(engine);
    this.reach=new ReachTask(engine);
    this.coordinator=new WholeBodyCoordinator(engine);
    this.locomotion=new Locomotion(engine);
    this.legMuscles=new LegMuscleController(engine);
    this.physicalEyes=new PhysicalEyes(engine);
  }
  setLegDrive(mode:LegDriveMode){
    if(this.status==='running'||this.reach.active||!this.locomotion.settled)return false;
    return this.legMuscles.setMode(mode);
  }
  setEyeTarget(target:number[]){
    if(!this.physicalEyes.setTarget(target))return false;
    this.engine.gazeTarget=[target[0],target[1],target[2]];return true;
  }
  private begin(pose:Record<string,number>,duration:number){
    this.starts=Object.fromEntries(this.engine.joints.map(j=>[j.name,this.engine.data.qpos[j.q]]));
    Object.assign(this.targets,pose);Object.keys(pose).forEach(name=>this.owned.add(name));
    this.elapsed=0;this.duration=duration;this.status='running';this.error='';
  }
  executeAction(command:Command){
    const duration=command?.duration??2;
    if(!command||!Object.hasOwn(actions,command.action)||!Number.isFinite(duration)||duration<=0
      ||this.locomotion.mode==='fallen'||['bend_right_knee','squat_check'].includes(command.action)){
      this.error='动作、时长无效，或当前身体不支持';return false;
    }
    this.commandId=null;this.pending=[];this.reach.cancel();this.action=command.action;
    if(command.action==='reach_left'||command.action==='reach_right'){
      const side=command.action==='reach_left'?'left':'right';
      // Keep the palm outside the torso; rotate this reach offset for bank turns.
      const yaw=this.locomotion.yaw,c=Math.cos(yaw),s=Math.sin(yaw),x=side==='left'?.32:-.32,d=this.engine.data;
      const target: [number,number,number]=command.target??[d.qpos[0]+x*c+.30*s,d.qpos[1]+x*s-.30*c,d.qpos[2]+.28];
      if(!this.reach.begin(side,duration,target)){this.status='failed';this.error='伸手目标超出可达范围';return false;}
      this.engine.gazeTarget=[...target];this.begin({},duration);return true;
    }
    const pose=command.action==='reset_pose'
      ?Object.fromEntries(this.engine.joints.filter(j=>!/(hip|knee|ankle|toe)/.test(j.name)).map(j=>[j.name,relaxedHands()[j.name]??0]))
      :actions[command.action as keyof typeof actions];
    if(command.action==='reset_pose'){this.owned.clear();this.engine.gazeTarget=null;}
    this.begin(pose,duration);return true;
  }
  /** Carry Agent command identity through completion instead of checking fixed angles. */
  performAction(command:{id:string|number;action:string;target?:string}){
    const gestures:Record<string,Segment[]>={
      wave:[{pose:{right_shoulder:1.2,right_elbow:.5},duration:1},{pose:{right_elbow:1.1},duration:.6},{pose:{right_elbow:.5},duration:.6},{pose:{right_shoulder:0,right_elbow:0},duration:1}],
      nod:[{pose:{neck_pitch:.35},duration:.6},{pose:{neck_pitch:0},duration:.6}],
      shake_head:[{pose:{neck_yaw:.45},duration:.6},{pose:{neck_yaw:-.45},duration:.9},{pose:{neck_yaw:0},duration:.6}],
    };
    if(this.locomotion.mode==='fallen'){this.error='人物已跌倒';return false;}
    if(Object.hasOwn(gestures,command.action)){
      this.cancel();this.action=command.action;const [first,...rest]=gestures[command.action];
      this.begin(first.pose,first.duration);this.pending=rest;
    }else{
      const mapped=command.action==='take'||command.action==='hand_over'?'reach_left'
        :command.action==='look_at'&&command.target==='robot'?'turn_head_left'
        :command.action==='look_at'&&command.target==='help_desk'?'turn_head_right':null;
      if(!mapped){this.error='当前身体不支持此动作或目标';return false;}
      if(!this.executeAction({action:mapped,duration:2}))return false;
    }
    this.commandId=command.id;return true;
  }
  setFinger(side:Side,finger:FingerName,curl:number){
    if(!['left','right'].includes(side)||!fingerNames.includes(finger)||!Number.isFinite(curl)||curl<0||curl>1)return false;
    if(this.reach.active||this.status==='running')return false;
    this.commandId=null;this.action='finger';this.begin(handPose(side,curl,finger),.5);return true;
  }
  setMotionReference(value:number){if(!Number.isFinite(value)||value<0||value>1)return false;this.strength=value;this.locomotion.referenceStrength=value;return true;}
  cancel(){
    this.pending=[];this.reach.cancel();this.engine.gazeTarget=null;
    if(this.status==='running')this.status='interrupted';
    this.targets=Object.fromEntries(this.engine.joints.map(j=>[j.name,this.engine.data.qpos[j.q]]));
    this.starts={...this.targets};this.elapsed=this.duration;
    this.engine.joints.filter(j=>!/(hip|knee|ankle|toe)/.test(j.name)).forEach(j=>this.owned.add(j.name));
  }
  update(dt:number){
    const d=this.engine.data;this.elapsed+=dt;const u=Math.min(1,this.elapsed/this.duration),smooth=u*u*(3-2*u);
    const legs=this.locomotion.update(dt);
    this.coordinator.update(this.locomotion.motionPhase,this.locomotion.mode==='walk',this.strength,dt);
    const coordinator=this.locomotion.naturalCoordinator??this.coordinator;
    const task=this.reach.update(dt),references:Record<string,number>={};
    for(const j of this.engine.joints){
      const auto=!this.owned.has(j.name)?(coordinator.arms[j.name]??coordinator.trunk[j.name]):undefined;
      const goal=this.targets[j.name]??0;
      const reference=legs[j.name]??task[j.name]??auto??((this.starts[j.name]??0)*(1-smooth)+goal*smooth);
      references[j.name]=reference;
      if(task[j.name]!==undefined)this.targets[j.name]=reference;
      const kp=this.engine.model.actuator_gainprm[j.actuator*10];
      const legManaged=legs[j.name]!==undefined&&/(hip|knee|ankle)/.test(j.name);
      d.ctrl[j.actuator]=Math.max(j.min,Math.min(j.max,reference+(legManaged?0:d.qfrc_bias[j.v]/kp)));
    }
    // Bank locomotion is the sole reference owner; the upstream muscle plant
    // replaces its selected position motors after the final balance references.
    this.legMuscles.update(dt,references);
    if(!this.engine.gazeTarget){
      const yaw=this.locomotion.yaw;
      this.physicalEyes.setTarget([d.qpos[0]+100*Math.sin(yaw),d.qpos[1]-100*Math.cos(yaw),1.65]);
    }
    this.physicalEyes.update(dt);
    if(this.locomotion.mode==='fallen'){this.status='failed';this.error='人物跌倒';this.pending=[];}
    else if(this.status==='running'&&u===1){
      const stable=this.engine.joints.filter(j=>this.owned.has(j.name)||this.reach.owns(j.name))
        .every(j=>Math.abs(d.qpos[j.q]-references[j.name])<.14&&Math.abs(d.qvel[j.v])<.12);
      if(stable&&(!this.reach.active||this.reach.error<.025)){
        const next=this.pending.shift();
        if(next)this.begin(next.pose,next.duration);
        else{this.status='completed';if(this.action==='reset_pose')this.owned.clear();}
      }else if(this.elapsed>this.duration+6){this.status='failed';this.error='动作未在容差内稳定';this.pending=[];}
    }
  }
  snapshot(){return this.engine.joints.map(j=>({...j,target:this.targets[j.name]??0,actual:this.engine.data.qpos[j.q],velocity:this.engine.data.qvel[j.v]}));}
  result(){return {id:this.commandId,status:this.status,error:this.error,action:this.action};}
  dispose(){this.physicalEyes.dispose();this.legMuscles.dispose();this.reach.dispose();this.locomotion.dispose();}
}
