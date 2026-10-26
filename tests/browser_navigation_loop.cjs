// Real bridge + real WebSocket + real BrainSession; deliberately controlled body/provider.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const origin=process.argv[3];
 try{for(const kind of ['normal','detour','blocked']){
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')console.error('BROWSER',m.text());});
  await page.addInitScript(()=>{window.wire=[];const Native=WebSocket;window.WebSocket=class extends Native{
   constructor(...args){super(...args);this.addEventListener('message',e=>window.wire.push(JSON.parse(e.data)));}
  };});
  await page.route(origin+'/bank/**',r=>r.fulfill({contentType:'text/html',body:`<script>
   const nav={status:'idle',location:'entrance',distance:0,replans:0,planningAttempts:0,obstaclePhase:'none',unavailable_targets:[],retryable_targets:[]};
   const s={time:0,navigation:nav,locomotion:{settled:true},bank:{},status:'idle'};
   window.human={getState:()=>s,capabilities:()=>({scenario:'bank',actions:['walk_to','wait'],places:['help_desk','entrance','exit'],look_targets:[]}),
    navigate:target=>{Object.assign(nav,{status:'running',target,location:'moving',distance:2,obstaclePhase:'none',failureCode:''});s.locomotion.settled=false;return true;},
    stopNavigation:()=>{},cancelAction:()=>{},setPaused:()=>{},setSpeechLevel:()=>{},say:()=>{},drainEvents:()=>[],
    block:()=>{nav.obstaclePhase='braking';},resume:()=>{nav.obstaclePhase='none';nav.replans=1;nav.planningAttempts=2;},
    finish:()=>{Object.assign(nav,{status:'completed',location:nav.target,distance:.01});s.locomotion.settled=true;nav.unavailable_targets=[];nav.retryable_targets=[];},
    fail:()=>{Object.assign(nav,{status:'failed',failureCode:'blocked_timeout',error:'No route after bounded recovery',planningAttempts:59,blockedTime:120,unavailable_targets:['help_desk']});s.locomotion.settled=true;},
    clear:()=>{nav.unavailable_targets=[];nav.retryable_targets=['help_desk'];}};
   setInterval(()=>s.time+=.1,100);
   </script>`}));
  await page.goto(origin);
  await page.locator('details').filter({has:page.locator('#navigation-load')}).locator('summary').click();
  await page.selectOption('#navigation-scenario',kind==='normal'?'normal':kind==='blocked'?'blocked':'detour');
  await page.click('#navigation-load');
  await page.waitForFunction(()=>!document.getElementById('connect').disabled);
  const scene=new URL(await page.locator('#human').getAttribute('src'),origin);
  assert.equal(scene.searchParams.get('obstacle'),kind==='normal'?'0':'1');
  assert.equal(scene.searchParams.get('layout'),kind==='blocked'?'blocked':null);
  assert.equal(await page.evaluate(()=>document.getElementById('human').contentWindow.human.getState().navigation.status),'idle','scene preparation must not start a local walk');
  await page.selectOption('#mode','manual');
  await page.fill('#url',process.argv[2]);await page.click('#connect');
  const commands=()=>page.evaluate(()=>window.wire.filter(m=>m.type==='command'));
  const count=async n=>{try{await page.waitForFunction(n=>window.wire.filter(m=>m.type==='command').length===n,n,{timeout:15000});}
   catch(e){console.error('WIRE',await page.evaluate(()=>window.wire),'UI',await page.locator('#log').textContent());throw e;}};
  const body=name=>page.evaluate(n=>document.getElementById('human').contentWindow.human[n](),name);
  await count(1);
  const walking=()=>page.waitForFunction(()=>document.getElementById('human').contentWindow.human.getState().navigation.status==='running');
  await walking();
  if(kind==='detour'){
   await body('block');await page.waitForFunction(()=>document.getElementById('log').textContent.includes('正在减停'));
   assert.equal((await commands()).length,1,'progress must not wake another decision');await body('resume');
   await page.waitForFunction(()=>document.getElementById('log').textContent.includes('继续行走'));
  }
  if(kind==='blocked'){
   await body('fail');await count(2);const help=(await commands())[1];assert.equal(help.action,'wait');assert.equal(help.goal_status,'in_progress');
   await page.waitForFunction(()=>!document.getElementById('send').disabled);
   await page.fill('#text','Please try again');await page.click('#send');await count(3);
   assert.equal((await commands())[2].action,'wait','speech alone cannot unlock the goal');
   await body('clear');await count(4);assert.equal((await commands())[3].action,'walk_to');await walking();
   await body('finish');await count(5);
  }else{await body('finish');await count(2);}
  assert.equal((await commands()).at(-1).action,'wait');assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>window.wire.filter(m=>m.type==='feedback_received'&&!m.accepted).length),0);
  console.log('PASS production bridge + BrainSession',kind);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
