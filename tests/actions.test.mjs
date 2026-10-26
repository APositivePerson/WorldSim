import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ActionRunner} from '../web/actions.mjs';
function fixture() {
  const feedback = [], calls = [];
  const state = {time:0, status:'running', joints:[{name:'right_shoulder', actual:1.9, velocity:0}]};
  const human = {executeAction:c => {calls.push(c); return true;}, getState:() => state};
  const runner = new ActionRunner(() => human, f => feedback.push(f));
  return {runner, state, feedback, calls, human};
}
test('acceptance and wait do not produce premature completion', () => {
  const f = fixture(); f.runner.execute({id:1, action:'wave'});
  f.runner.execute({id:2, action:'wait'}); f.runner.tick();
  assert.equal(f.feedback.length,0); assert.equal(f.calls.length,1);
  f.state.status='completed'; f.runner.tick(); f.runner.tick();
  assert.equal(f.feedback.length,1); assert.equal(f.feedback[0].id,1);
  assert.equal(f.feedback[0].status,'completed');
});
test('unsupported navigation is rejected without calling body', () => {
  const f=fixture(); f.runner.execute({id:1,action:'walk_to',target:'exit'});
  assert.equal(f.calls.length,0); assert.equal(f.feedback[0].status,'failed');
});
test('paused simulation does not time out, reset interrupts', () => {
  const f=fixture(); f.runner.execute({id:1,action:'wave'});
  for(let i=0;i<1000;i++)f.runner.tick();
  assert.equal(f.feedback.length,0);
  f.state.status='idle'; f.runner.tick(); assert.equal(f.feedback[0].status,'interrupted');
});
test('wrong joint pose cannot be reported as success', () => {
  const f=fixture();f.runner.execute({id:1,action:'wave'});
  f.state.status='completed';f.state.joints[0].actual=0;f.runner.tick();
  assert.equal(f.feedback[0].status,'failed');
});
test('new gesture interrupts previous, controller rejection is reported', () => {
  const f=fixture(); f.runner.execute({id:1,action:'wave'});
  f.human.executeAction=()=>false;
  f.runner.execute({id:2,action:'look_at',target:'robot'});
  assert.deepEqual(f.feedback.map(x=>x.status),['interrupted','failed']);
});
test('navigation completion requires target, distance and physical stability',()=>{
 const f=fixture();f.human.navigate=()=>true;
 f.state.navigation={status:'running',location:'moving',distance:1};f.state.locomotion={settled:false};
 f.runner.execute({id:1,action:'walk_to',target:'ticket_machine'});f.state.time=200;f.runner.tick();assert.equal(f.feedback.length,0);
 f.state.navigation={status:'completed',location:'ticket_machine',distance:.01};f.runner.tick();assert.equal(f.feedback.length,0);
 f.state.locomotion.settled=true;f.state.navigation.distance=.09;f.runner.tick();assert.equal(f.feedback.length,0);
 f.state.navigation.distance=.01;f.runner.tick();assert.equal(f.feedback[0].status,'completed');
});

test('integrated skills use matching command results, not old fixed joint angles',()=>{
 const f=fixture();f.human.performAction=c=>{f.state.actionResult={id:c.id,status:'running'};return true;};
 f.runner.execute({id:7,action:'hand_over'});f.runner.tick();assert.equal(f.feedback.length,0);
 f.state.actionResult.status='completed';f.runner.tick();assert.equal(f.feedback[0].status,'completed');
 f.runner.execute({id:8,action:'wave'});f.state.actionResult={id:9,status:'completed'};f.runner.tick();
 assert.equal(f.feedback[1].status,'interrupted');
});

test('skill timeout and disconnect cancel actual body work',()=>{
 const f=fixture();let cancellations=0;
 f.human.performAction=c=>{f.state.actionResult={id:c.id,status:'running'};return true;};
 f.human.cancelAction=()=>cancellations++;
 f.runner.execute({id:7,action:'take'});f.state.time=36;f.runner.tick();
 assert.equal(f.feedback[0].status,'failed');assert.equal(cancellations,1);
 f.runner.execute({id:8,action:'wave'});f.runner.clear();assert.equal(cancellations,2);
});

test('navigation transitions report progress without completing or flooding feedback',()=>{
 const f=fixture();f.human.navigate=()=>true;
 f.state.navigation={status:'running',target:'help_desk',location:'moving',distance:2,replans:0,planningAttempts:0,obstaclePhase:'none'};
 f.state.locomotion={settled:true};f.runner.execute({id:20,action:'walk_to',target:'help_desk'});
 f.runner.tick();assert.equal(f.feedback.length,0);
 f.state.navigation.obstaclePhase='braking';f.runner.tick();f.runner.tick();
 assert.equal(f.feedback.length,1);assert.equal(f.feedback[0].type,'action_progress');assert.equal(f.feedback[0].phase,'blocked');
 assert(f.runner.active);
 f.state.navigation.obstaclePhase='waiting';f.state.navigation.planningAttempts=3;f.runner.tick();
 f.state.navigation.obstaclePhase='none';f.state.navigation.replans=1;f.runner.tick();
 assert.deepEqual(f.feedback.map(m=>m.phase),['blocked','replanning','moving']);
 f.state.navigation.status='completed';f.state.navigation.location='help_desk';f.state.navigation.distance=.01;
 f.runner.tick();assert.equal(f.feedback.at(-1).type,'action_feedback');assert.equal(f.feedback.at(-1).reason,'arrived');
 assert.equal(f.feedback.at(-1).navigation.planningAttempts,3);assert.equal(f.feedback.at(-1).target,'help_desk');
});
test('final blocked feedback carries recovery evidence and cannot look successful',()=>{
 const f=fixture();f.human.navigate=()=>true;
 f.state.navigation={status:'running',target:'help_desk',location:'moving',distance:2,replans:0};
 f.runner.execute({id:21,action:'walk_to',target:'help_desk'});
 Object.assign(f.state.navigation,{status:'failed',failureCode:'blocked_timeout',planningAttempts:59,blockedTime:120,
  error:'No route',unavailable_targets:['help_desk'],retryable_targets:[]});
 f.runner.tick();f.runner.tick();assert.equal(f.feedback.length,1);
 assert.equal(f.feedback[0].reason,'blocked_timeout');assert.equal(f.feedback[0].navigation.planningAttempts,59);
 assert.deepEqual(f.feedback[0].navigation.unavailable_targets,['help_desk']);assert.equal(f.feedback[0].status,'failed');
});
