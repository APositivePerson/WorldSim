// Real MuJoCo + UI: sensed detour without VLM or obstacle-removal command.
const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn('python',['-u','body_3d.py','--port','0','--no-scan'],
  {windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{
   let output='';const timer=setTimeout(()=>reject(Error('startup timeout')),60000);
   server.stdout.on('data',c=>{output+=c;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});
   server.on('error',reject);server.stderr.on('data',()=>{});
  });
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];let requests=0,frame;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/vision',async route=>{requests++;await route.abort();});
  await page.goto(url);
  await page.waitForFunction(()=>!document.getElementById('connect').disabled,null,{timeout:60000});
  await page.locator('details').filter({has:page.locator('#obstacle-start')}).locator('summary').click();
  await page.click('#obstacle-start');
  await page.waitForFunction(()=>document.getElementById('human').contentWindow?.human?.obstacleTest&&
   document.getElementById('human').contentWindow.human.getState().navigation.status==='running',null,{timeout:60000});
  frame=page.frames().find(f=>f.url().includes('/bank/'));
  assert(frame.url().includes('height=low'));
  await frame.evaluate(()=>window.human.setSpeed(8));
  await frame.waitForFunction(()=>window.human.getState().navigation.replans>0,null,{timeout:120000});
  assert.equal(await page.isChecked('#vision-agent'),false);
  await page.screenshot({path:'logs/obstacle-detour.png',fullPage:true});
  await frame.waitForFunction(()=>window.human.getState().navigation.status==='completed',null,{timeout:240000});
  const arrived=await frame.evaluate(()=>window.human.getState().navigation);
  assert.equal(arrived.location,'help_desk');assert(arrived.distance<.08);
  assert.equal(arrived.obstacleSource,'depth_elevation');assert(arrived.observedVoxels>0);
  assert.deepEqual(errors,[]);
  assert.equal(requests,0);assert(arrived.replans>0);
  console.log('PASS head-depth/elevation detour without removal',JSON.stringify({requests,replans:arrived.replans,voxels:arrived.observedVoxels,distance:arrived.distance}));
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
