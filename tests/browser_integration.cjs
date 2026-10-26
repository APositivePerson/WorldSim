// Real local server + real private scan (when installed) + synthesized audio; no LLM calls.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const path=require('node:path');
function tone(){
 const n=8000*4,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);
 b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++)b.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*440*i/8000)),44+i*2);
 return b.toString('base64');
}
(async()=>{
 const server=spawn('python',['-u','body_3d.py','--port','0'],{cwd:path.resolve(__dirname,'..'),windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{
   let output='';const timeout=setTimeout(()=>reject(Error('server startup timeout: '+output)),60000);
   server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});
   server.on('error',reject);server.on('exit',code=>{clearTimeout(timeout);reject(Error('server exited '+code+' '+output));});
   server.stderr.on('data',()=>{});
  });
  const scan=await (await fetch(url+'/human/models/local-scan-status.json')).json();
  assert.equal((await fetch(url+'/human/local-scans/other.glb')).status,404);
  assert.equal((await fetch(url+'/human/local-scans/%2e%2e%2f%2e%2e%2f.env')).status,404);
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];let peer;
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('ws://localhost:8765',ws=>{peer=ws;ws.onMessage(raw=>{
   const message=JSON.parse(raw);
   if(message.type==='hello')ws.send(JSON.stringify({type:'ready',persona:{name:'整合测试'}}));
   if(message.type==='event')ws.send(JSON.stringify({type:'status',thinking:false}));
  });});
  await page.goto(url);
  await page.waitForFunction(()=>!document.getElementById('connect').disabled,null,{timeout:60000});
  const frame=page.frames().find(f=>f.url().includes('/bank/'));
  // Real capture, mocked provider: no API cost in regression tests.
  const captures=await frame.evaluate(()=>['person','observer'].map(v=>window.human.captureFrame(v)));
  require('node:fs').writeFileSync('logs/vision-person.jpg',Buffer.from(captures[0].image.split(',')[1],'base64'));
  require('node:fs').writeFileSync('logs/vision-observer.jpg',Buffer.from(captures[1].image.split(',')[1],'base64'));
  for(const capture of captures){
   assert(capture.image.startsWith('data:image/jpeg;base64,'));
   assert(capture.image.length>1000); // Looking away from the hall can be blank.
   assert(capture.time>=0);
  }
  let visionRequests=[];
  await page.route('**/api/vision',async route=>{
   const payload=route.request().postDataJSON();visionRequests.push(payload);
   await route.fulfill({json:{model:'mock-vision',latency_seconds:.1,
    observation:{summary:'测试视觉结果',objects:[],changes:[],uncertainties:['测试'],comparison:'uncertain'}}});
  });
  await page.locator('#vision-panel summary').click();
  await page.click('#vision-single');
  await page.waitForFunction(()=>document.getElementById('vision-result').textContent.includes('测试视觉结果'));
  assert.equal(visionRequests[0].frames.length,1);
  await page.click('#vision-baseline');await page.click('#vision-compare');
  await page.waitForFunction(()=>!document.getElementById('vision-single').disabled);
  assert.equal(visionRequests[1].frames.length,2);
  await page.selectOption('#vision-view','observer');
  assert(await page.locator('#vision-compare').isDisabled());
  assert.equal((await fetch(url+'/api/vision',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({frames:[]})})).status,400);
  assert.equal((await fetch(url+'/api/vision',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},
   body:'{}'})).status,403);
  if(scan.available)await frame.waitForFunction(()=>window.human.getState().avatar==='scan',null,{timeout:60000});
  assert.equal(await frame.evaluate(()=>window.human.setFace({jawOpen:2})),false);
  assert.equal(await frame.evaluate(()=>window.human.setFace({smile:.4})),true);
  await page.selectOption('#mode','manual');await page.click('#connect');
  await page.waitForFunction(()=>!document.getElementById('send').disabled);
  peer.send(JSON.stringify({type:'command',id:1,action:'wait',speech:'语音与面部联调',audio:tone(),goal_status:'in_progress'}));
  await frame.waitForFunction(()=>window.human.getState().face.jawOpen>.05);
  await page.click('#pause');
  await frame.waitForFunction(()=>window.human.getState().face.jawOpen===0);
  const t=await frame.evaluate(()=>window.human.getState().time);await page.waitForTimeout(300);
  assert.equal(await frame.evaluate(()=>window.human.getState().time),t);
  await page.click('#pause');await frame.waitForFunction(()=>window.human.getState().face.jawOpen>.05);
  await page.click('#disconnect');await frame.waitForFunction(()=>window.human.getState().face.jawOpen===0);
  await page.screenshot({path:'logs/integrated-character.png',fullPage:true});
  if(scan.available){
   await frame.selectOption('#avatar','procedural');
   await frame.waitForFunction(()=>window.human.getState().avatar==='procedural');
  }
  assert.deepEqual(errors,[]);
  const before=await frame.evaluate(()=>window.human.captureFrame('observer'));
  assert(await frame.evaluate(()=>window.human.executeAction({action:'raise_right_arm',duration:1})));
  await frame.waitForFunction(()=>window.human.getState().status==='completed',null,{timeout:30000});
  const after=await frame.evaluate(()=>window.human.captureFrame('observer'));
  for(const [name,capture] of [['before',before],['after',after]])
   require('node:fs').writeFileSync('logs/vision-'+name+'.jpg',Buffer.from(capture.image.split(',')[1],'base64'));
  console.log('PASS local asset serving, avatar selection, face validation, audio-driven jaw, pause and disconnect; scan='+scan.available);
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
