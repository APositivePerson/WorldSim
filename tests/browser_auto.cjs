const {chromium}=require('playwright');
const assert=require('node:assert/strict');
function silence(){const n=16000, b=Buffer.alloc(44+n);b.write('RIFF');b.writeUInt32LE(36+n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n,40);return b.toString('base64');}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<300;i++){if(check())return;await delay(50);}throw Error('Timed out waiting for messages');}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),messages=[],errors=[];let peer;
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('ws://localhost:8765',ws=>{peer=ws;ws.onMessage(raw=>{
   const m=JSON.parse(raw);messages.push(m);
   if(m.type==='hello')ws.send(JSON.stringify({type:'ready',persona:{name:'王阿姨'}}));
   if(m.type==='action_feedback')ws.send(JSON.stringify({type:'feedback_received',id:m.id}));
  });});
  await require('./browser_host.cjs')(page);
  await page.goto('http://127.0.0.1:8080');
  await page.waitForFunction(()=>!document.getElementById('connect').disabled,null,{timeout:60000});
  await page.click('#connect');await until(()=>messages.some(m=>m.type==='staff_request'));
  assert.equal(messages.find(m=>m.type==='hello').mode,'auto');
  assert(!messages.some(m=>m.type==='event'));
  await page.click('#pause');
  const now=()=>page.evaluate(()=>document.getElementById('human').contentWindow.human.getState().time);
  const t=await now();
  const first={type:'staff_command',id:'staff-1',turn:1,speaker:'robot',speech:'您好，请问办理什么业务？',audio:silence()};
  peer.send(JSON.stringify(first));peer.send(JSON.stringify(first));
  await delay(1200);assert.equal(await now(),t);assert(!messages.some(m=>m.type==='event'));
  assert(!(await page.locator('#log').innerText()).includes(first.speech));
  await page.click('#pause');
  await page.waitForFunction(()=>document.getElementById('audio').currentTime>0&&!document.getElementById('audio').ended);
  await page.click('#pause');
  const audioTime=await page.locator('#audio').evaluate(a=>a.currentTime);
  await delay(1200);
  assert.equal(await page.locator('#audio').evaluate(a=>a.currentTime),audioTime);
  assert(!messages.some(m=>m.type==='event'));
  await page.click('#pause');
  await until(()=>messages.some(m=>m.type==='event'&&m.event.type==='robot_speech'));
  const audioIndex=messages.findIndex(m=>m.type==='audio_done'&&m.id==='staff-1');
  assert(audioIndex>=0&&audioIndex<messages.findIndex(m=>m.type==='event'));
  assert.equal(messages.filter(m=>m.type==='event').length,1);
  peer.send(JSON.stringify({type:'command',id:1,action:'wave',speech:'我想问一下补卡需要什么材料。',audio:silence(),goal_status:'in_progress'}));
  await until(()=>messages.some(m=>m.type==='staff_request'&&m.command_id===1));
  assert(messages.some(m=>m.type==='action_feedback'&&m.status==='completed'));
  assert(messages.some(m=>m.type==='audio_done'&&m.id===1));
  await page.screenshot({path:'logs/bank-auto.png',fullPage:true});
  peer.send(JSON.stringify({type:'staff_command',id:'staff-2',turn:2,speaker:'none',speech:''}));
  await page.waitForFunction(()=>document.getElementById('status').textContent==='本场已结束');
  assert.equal(messages.filter(m=>m.type==='staff_request').length,2);
  await page.click('#disconnect');await delay(300);assert.deepEqual(errors,[]);
  // Ending while a response is pending closes the session without requesting another turn.
  await page.click('#connect');await until(()=>messages.filter(m=>m.type==='staff_request').length===3);
  await page.click('#disconnect');await delay(400);
  assert.equal(messages.filter(m=>m.type==='staff_request').length,3);
  console.log('PASS: bank scene, real gestures, alternating audio, buffered pause, duplicate suppression, terminal/stop');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
