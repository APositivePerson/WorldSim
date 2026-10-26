import assert from 'node:assert/strict';
import {DESTINATIONS,planPath,segmentFree,free} from '../scene/BankLayout';
let count=0;
for(const [name,start]of Object.entries(DESTINATIONS))for(const goal of Object.values(DESTINATIONS)){
 for(const dx of [-.025,0,.025])for(const dy of [-.025,0,.025]){
  let last={x:start.x+dx,y:start.y+dy};if(!free(last))continue;
  const path=planPath(last,goal);for(const next of path){assert(segmentFree(last,next),name);last=next;}
  assert.equal(last.x,goal.x);assert.equal(last.y,goal.y);count++;
 }
}
assert.throws(()=>planPath({x:-3.6,y:-1.7},DESTINATIONS.entrance));
console.log(`PASS ${count} paths from actual stopping offsets; all segments retain clearance`);
