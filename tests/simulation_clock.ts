import assert from 'node:assert/strict';
import {SimulationClock} from '../scene/physics/SimulationClock';
import {SimulationLoop} from '../character/src/physics/SimulationLoop';
for(const speed of [1,4,8]){
 let bankSteps=0,upstreamSteps=0;
 const bank=new SimulationClock(.002,()=>bankSteps++);
 const upstream=new SimulationLoop({dt:.002,step:()=>upstreamSteps++} as any,{update:()=>{}} as any);upstream.speed=speed;
 for(const elapsed of [.016,.075,.09,.12,.016,.03]){bank.advance(elapsed,speed);upstream.advance(elapsed);assert.equal(bankSteps,upstreamSteps);}
 assert.ok(Math.abs(bank.snapshot().droppedTime-upstream.dropped)<1e-12);
 const before=bank.snapshot();bank.advance(1,speed,true);assert.deepEqual(bank.snapshot(),before);
}
let steps=0;const clock=new SimulationClock(.002,()=>steps++);
for(let i=0;i<20;i++)clock.advance(.075);
assert.ok(steps>=749,'75 ms frames must retain real time instead of slowing to two thirds speed');
assert.ok(clock.snapshot().realTimeFactor>.998);console.log('PASS upstream clock parity, 75 ms frames, speed scales and pause');
