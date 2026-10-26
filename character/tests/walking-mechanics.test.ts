import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import load from "@mujoco/mujoco";
import {MuJoCoEngine} from "../src/physics/MuJoCoEngine.ts";
import {HumanController} from "../src/human/HumanController.ts";
import {rollingFoot} from "../src/human/FootRocker.ts";
const mj=await load(),xml=await readFile(new URL('../public/models/human-free.xml',import.meta.url),'utf8');
function fixture(){const e=new MuJoCoEngine(mj,xml),c=new HumanController(e);return {e,c,
  run(seconds:number,check?:()=>void){for(let i=0;i<Math.round(seconds/e.dt);i++){c.update(e.dt);e.step();check?.();}},
  dispose(){c.dispose();e.dispose();}};}

test('rocker geometry preserves the heel or articulated forefoot contact point',()=>{
  for(const pitch of [-.12,-.04,0,.04,.1,.2]){
    const foot=rollingFoot(.1,0,0,pitch),s=Math.sin(pitch),c=Math.cos(pitch);
    if(pitch<0){
      assert.ok(Math.abs(foot.z+.095*s-.1*c)<1e-12);
      assert.ok(Math.abs(foot.y+.095*c+.1*s-.095)<1e-12);
    }else{
      assert.ok(Math.abs(foot.z-.13*s-.052*c-.048)<1e-12);
      assert.ok(Math.abs(foot.y-.13*c+.052*s+.13)<1e-12);
      assert.equal(foot.toe,-pitch);
      assert.ok(foot.z+.095*s-.1*c>=-1e-12);
    }
  }
});

test('rolling changes real loaded heel contacts and toe dorsiflexion without support forces',async()=>{
  const results=[];
  for(const rolling of [false,true]){
    const f=fixture(),{e,c}=f,g=c.locomotion!;
    try{
      assert.equal(g.setWalkingMechanics({rolling}),true);
      f.run(2);c.execute({action:'walk_forward'});
      const ids=['left','right'].map(side=>({foot:mj.mj_name2id(e.model,1,side+'_foot'),
        toes:mj.mj_name2id(e.model,1,side+'_toes'),joint:e.joints.find(j=>j.name===side+'_toe_flex')!}));
      let heelContacts=0,forefootContacts=0,minimumToe=0,sample=0;
      f.run(20,()=>{
        if(++sample%5)return;
        assert.ok(e.data.qpos[2]>.88);
        ids.forEach(({foot,toes,joint},i)=>{
          const d=e.data,r=d.xmat;
          if(g.sensors.feet[i].force<e.totalMass*9.81*.08)return;
          const heel=d.xpos[3*foot+2]+.095*r[9*foot+7]-.1*r[9*foot+8];
          const front=d.xpos[3*toes+2]-.075*r[9*toes+7]-.048*r[9*toes+8];
          if(heel<.0015&&front>.003)heelContacts++;
          if(front<.0015&&heel>.003)forefootContacts++;
          minimumToe=Math.min(minimumToe,d.qpos[joint.q]);
        });
      });
      assert.equal(g.mode,'walk');
      assert.ok(Array.from(e.data.xfrc_applied as Float64Array).every(v=>v===0));
      assert.ok(Array.from(e.data.qfrc_applied as Float64Array).every(v=>v===0));
      results.push({rolling,heelContacts,forefootContacts,minimumToe,load:g.cerebellum.walking.snapshot().load});
    }finally{f.dispose();}
  }
  assert.ok(results[1].heelContacts>results[0].heelContacts*2);
  assert.ok(results[1].forefootContacts>20);
  assert.ok(results[1].minimumToe<-.04&&results[0].minimumToe>-.04);
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/walking-mechanics.json',JSON.stringify(results,null,2));
});

test('lateral pushes change the next measured landing toward the push, then walking recovers',()=>{
  for(const sign of [-1,1]){
    const control=fixture(),pushed=fixture();
    try{
      for(const f of [control,pushed]){f.run(2);f.c.execute({action:'walk_forward'});f.run(6.2);}
      pushed.e.data.xfrc_applied[6]=sign*35;pushed.run(.12);
      pushed.e.data.xfrc_applied[6]=0;control.run(.12);
      let correction=0,actualLanding=0;
      for(let i=0;i<120;i++){
        control.run(.01);pushed.run(.01);
        const a=pushed.c.locomotion!,b=control.c.locomotion!;
        correction=Math.max(correction,sign*(a.getState().balance.landingCorrection.x-b.getState().balance.landingCorrection.x));
        a.sensors.feet.forEach((foot,k)=>{
          if(foot.contact)actualLanding=Math.max(actualLanding,sign*(foot.x-b.sensors.feet[k].x));
        });
      }
      assert.ok(correction>.0002,'sensed impulse must modify the landing reference');
      assert.ok(actualLanding>.0005,'the physical foot must follow the changed landing');
      pushed.run(4);
      const state=pushed.c.locomotion!.getState();
      assert.equal(state.mode,'walk');assert.ok(state.pelvis[2]>.88);
      assert.ok(state.motion.actualSpeed>.35);
      assert.ok(Math.abs(state.balance.landingCorrection.x)<=.018001);
      assert.ok(Math.abs(state.balance.landingCorrection.y)<=.025001);
    }finally{control.dispose();pushed.dispose();}
  }
});
