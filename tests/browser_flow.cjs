// State-machine integration with a deliberately stubbed body. Real mechanics are
// tested separately by physical_route.ts against the actual MuJoCo model.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage(),messages=[],errors=[];let peer;
  page.on('pageerror',e=>errors.push(e.message));
  await require('./browser_host.cjs')(page);
  await page.route('http://127.0.0.1:8080/bank/',route=>route.fulfill({contentType:'text/html',body:`<script>
  const s={time:0,status:'idle',navigation:{location:'entrance',status:'idle',distance:0},locomotion:{settled:true,mode:'stand'},bank:{ticket:null,called_counter:null},joints:[{name:'left_elbow',actual:1.7,velocity:0}]};
  let paused=false,events=[],takes=0;
  window.human={getState:()=>s,captureFrame:view=>({view,time:s.time,image:'data:image/jpeg;base64,test'}),navigate:target=>{s.navigation={target,status:'running',location:'moving',distance:2};s.locomotion.settled=false;return true;},
  executeAction:()=>{s.status='completed';return true;},setPaused:v=>paused=v,setSpeed:()=>{},say:()=>{},stopNavigation:()=>{},
  takeTicket:()=>{takes++;s.bank.ticket='A001';return {ok:true,message:'已取到 A001，请去 waiting_area 等候'};},drainEvents:()=>events.splice(0),
  finishNav:()=>{s.navigation.location=s.navigation.target;s.navigation.status='completed';s.navigation.distance=0;s.locomotion.settled=true;},
  failNav:()=>{s.navigation.status='failed';s.navigation.error='道路无法通过';},
  call:()=>{s.bank.called_counter='counter_1';events.push({type:'broadcast',content:'请 A001 到1号柜台'});},takes:()=>takes};
  setInterval(()=>{if(!paused)s.time+=.1;},100);
  </script>`}));
  const visionRequests=[];let visionFails=false;
  await page.route('**/api/vision',async route=>{
   visionRequests.push(route.request().postDataJSON());
   if(visionFails){await route.fulfill({status:502,json:{error:'mock timeout'}});return;}
   await route.fulfill({json:{model:'mock-vision',latency_seconds:.1,observation:{
    summary:'前方可见服务机器人',objects:[],changes:[],uncertainties:[],comparison:'not_applicable'}}});
  });
  await page.routeWebSocket('ws://localhost:8765',ws=>{peer=ws;ws.onMessage(raw=>{
   const m=JSON.parse(raw);messages.push(m);if(m.type==='hello')ws.send(JSON.stringify({type:'ready',persona:{name:'流程测试'}}));
  });});
  async function until(test){for(let i=0;i<200;i++){if(test())return;await delay(50);}throw Error('Timed out '+JSON.stringify(messages));}
  const invoke=name=>page.evaluate(name=>document.getElementById('human').contentWindow.human[name](),name);
  const command=(id,action,target,goal_status='in_progress',speech='')=>peer.send(JSON.stringify({type:'command',id,action,target,goal_status,speech}));
  const eventCount=type=>messages.filter(m=>m.type==='event'&&m.event.type===type).length;
  const completed=id=>messages.some(m=>m.type==='action_feedback'&&m.id===id&&m.status==='completed');
  await page.goto('http://127.0.0.1:8080');await page.check('#vision-agent');await page.click('#connect');
  await until(()=>messages.some(m=>m.type==='staff_request'));
  peer.send(JSON.stringify({type:'staff_status',thinking:false}));
  command(1,'walk_to','ticket_machine');await delay(300);assert.equal(eventCount('action_done'),0);
  await page.click('#pause');await invoke('finishNav');await delay(300);assert.equal(eventCount('action_done'),0);
  await page.click('#pause');await until(()=>eventCount('action_done')===1);assert(completed(1));
  const arrived=messages.find(m=>m.type==='event'&&m.event.type==='action_done');
  assert.equal(arrived.vision.command_id,1);assert.equal(arrived.vision.view,'person');
  assert.equal(arrived.vision.phase,'after_action');
  assert.equal(arrived.vision.observation.summary,'前方可见服务机器人');
  assert(visionRequests.every(r=>r.frames.length===1&&r.frames[0].view==='person'));
  command(2,'take');await until(()=>eventCount('action_done')===2);assert.equal(await invoke('takes'),1);
  command(3,'walk_to','waiting_area');await delay(200);await invoke('finishNav');await until(()=>eventCount('action_done')===3);
  command(4,'wait');await delay(400);
  assert.equal(messages.filter(m=>m.type==='staff_request').length,1);assert.notEqual(await page.locator('#status').innerText(),'本场已结束');
  await invoke('call');await until(()=>eventCount('broadcast')===1);await delay(200);assert.equal(eventCount('broadcast'),1);
  command(5,'walk_to','counter_1');await delay(200);await invoke('finishNav');await until(()=>eventCount('action_done')===4);
  command(6,'wait',null,'in_progress','您好');await until(()=>messages.some(m=>m.type==='staff_request'&&m.command_id===6));
  const request=messages.find(m=>m.type==='staff_request'&&m.command_id===6);assert.equal(request.state.location,'counter_1');assert.equal(request.bank.ticket,'A001');
  peer.send(JSON.stringify({type:'staff_command',id:'staff-1',turn:1,speaker:'teller',speech:'请出示身份证。'}));await until(()=>eventCount('teller_speech')===1);
  assert.equal(messages.find(m=>m.event?.type==='teller_speech').vision.phase,'before_decision');
  visionFails=true;
  command(7,'walk_to','exit','done');await delay(200);await invoke('failNav');await until(()=>eventCount('action_failed')===1);
  assert.equal(messages.find(m=>m.event?.type==='action_failed').vision,undefined);
  assert.notEqual(await page.locator('#status').innerText(),'本场已结束');
  command(8,'walk_to','exit','done');await delay(200);await invoke('finishNav');
  await page.waitForFunction(()=>document.getElementById('status').textContent==='本场已结束');
  // A late image must not leak into the next/disconnected session.
  await page.click('#disconnect');await page.selectOption('#mode','manual');
  let releaseVision,visionStarted;
  const started=new Promise(resolve=>visionStarted=resolve);
  await page.unroute('**/api/vision');
  await page.route('**/api/vision',async route=>{
   visionStarted();await new Promise(resolve=>releaseVision=resolve);
   await route.fulfill({json:{model:'mock',latency_seconds:1,observation:{
    summary:'旧场景',objects:[],changes:[],uncertainties:[],comparison:'not_applicable'}}});
  });
  const sceneStarts=eventCount('scene_start');
  await page.click('#connect');await started;await page.click('#disconnect');
  releaseVision();await delay(300);
  assert.equal(eventCount('scene_start'),sceneStarts);
  assert.deepEqual(errors,[]);console.log('PASS bridge flow: actual-arrival gating, pause, ticket, queue, teller, navigation failure before terminal');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
