// Uses the root workspace's Playwright dependency.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1900,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const received=[];let peer;
  await page.routeWebSocket('ws://localhost:8765', ws=>{
   peer=ws;ws.onMessage(raw=>{
    const msg=JSON.parse(raw);received.push(msg);
    if(msg.type==='hello')ws.send(JSON.stringify({type:'ready',persona:{name:'测试顾客'}}));
    if(msg.type==='event'&&msg.event.type==='scene_start')ws.send(JSON.stringify({type:'command',id:0,action:'wait',speech:'',goal_status:'in_progress'}));
    if(msg.type==='action_feedback')ws.send(JSON.stringify({type:'feedback_received',id:msg.id}));
   });
  });
  await require('./browser_host.cjs')(page);
  await page.goto('http://127.0.0.1:8080');
  await page.waitForFunction(()=>!document.getElementById('connect').disabled,{},{timeout:60000});
  await page.selectOption('#mode','manual');
  await page.click('#connect');
  await page.waitForFunction(()=>!document.getElementById('send').disabled);
  const hello=received.find(m=>m.type==='hello');
  assert.equal(hello.body_profile,'human_3d');assert.equal(hello.scenario,'bank');
  assert(hello.capabilities.places.includes('counter_1')&&!hello.capabilities.places.includes('counter_3'));
  for(const [id,action,target] of [[1,'wave',null],[2,'look_at','robot'],[3,'look_at','help_desk'],[4,'hand_over',null]]) {
   peer.send(JSON.stringify({type:'command',id,action,target,speech:'测试对话',goal_status:'in_progress'}));
   await page.waitForFunction(id=>document.getElementById('log').textContent.includes(`大脑已记录动作 #${id}`),id,{timeout:60000});
   const f=received.find(m=>m.type==='action_feedback'&&m.id===id);
   console.log(JSON.stringify(f));assert.equal(f.status,'completed');
  }
  await page.fill('#text','您好，请问办理什么业务？');await page.click('#send');
  assert(received.some(m=>m.type==='event'&&m.event.type==='robot_speech'));
  await page.screenshot({path:'logs/3d-bridge.png',fullPage:true});
  await page.click('#disconnect');assert.equal(await page.locator('#send').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('Browser: real WASM gestures + WebSocket messages PASS');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
