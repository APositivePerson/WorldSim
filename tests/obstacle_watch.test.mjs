import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ObstacleWatch} from '../web/obstacle_watch.mjs';
function setup(observe){
 let calls=0,active={id:1,action:'walk_to'};
 const state={time:10,navigation:{status:'running',obstaclePhase:'none'},
  locomotion:{goal:{x:0,y:2},pelvis:[0,0,1],yaw:Math.PI}};
 const body={getState:()=>state,reportVisualObstacle:()=>{calls++;return true;}};
 const watch=new ObstacleWatch(()=>body,()=>active,observe);
 return {watch,state,calls:()=>calls,replace:()=>active={id:2,action:'walk_to'}};
}
test('only visual suspicion requests geometric confirmation',async()=>{
 for(const result of ['clear','uncertain','suspected']){
  const f=setup(async()=>({observation:{path_obstacle:result}}));
  await f.watch.tick(true);assert.equal(f.calls(),result==='suspected'?1:0);
 }
});
test('late results cannot stop a replacement command',async()=>{
 let resolve;const f=setup(()=>new Promise(r=>resolve=r));
 const running=f.watch.tick(true);f.replace();resolve({observation:{path_obstacle:'suspected'}});
 await running;assert.equal(f.calls(),0);
});
test('disabled, paused, turning and waiting skip VLM',async()=>{
 let calls=0;const f=setup(async()=>{calls++;return null;});
 await f.watch.tick(false);await f.watch.tick(true,true);
 f.state.locomotion.yaw=0;await f.watch.tick(true);
 f.state.locomotion.yaw=Math.PI;f.state.navigation.obstaclePhase='waiting';await f.watch.tick(true);
 assert.equal(calls,0);
});
