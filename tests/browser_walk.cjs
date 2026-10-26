const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await require('./browser_host.cjs')(page);
  await page.goto('http://127.0.0.1:8080');
  await page.waitForFunction(()=>!document.getElementById('connect').disabled,null,{timeout:60000});
  await page.selectOption('#speed','8');
  const state=()=>page.evaluate(()=>document.getElementById('human').contentWindow.human.getState());
  const initial=await state();
  await page.evaluate(()=>document.getElementById('human').contentWindow.human.navigate('exit'));
  await page.waitForFunction(()=>document.getElementById('human').contentWindow.human.getState().locomotion.steps>3,null,{timeout:60000});
  await page.evaluate(()=>document.getElementById('human').contentWindow.human.setPaused(true));
  const stopped=await state();await delay(500);assert.deepEqual((await state()).locomotion.pelvis,stopped.locomotion.pelvis);assert.equal((await state()).time,stopped.time);
  await page.evaluate(()=>document.getElementById('human').contentWindow.human.setPaused(false));
  await page.waitForFunction(()=>['completed','failed'].includes(document.getElementById('human').contentWindow.human.getState().navigation.status),null,{timeout:180000});
  const final=await state();assert.equal(final.navigation.status,'completed',final.navigation.error);assert.equal(final.navigation.location,'exit');
  assert(final.navigation.distance<.08);assert(final.locomotion.settled);assert(final.locomotion.steps>10);
  assert(Math.hypot(final.locomotion.pelvis[0]-initial.locomotion.pelvis[0],final.locomotion.pelvis[1]-initial.locomotion.pelvis[1])>.6);
  assert.deepEqual(errors,[]);await page.screenshot({path:'logs/bank-physical-walk.png',fullPage:true});
  console.log('PASS browser real physical walk + fixed-step speed + pause',JSON.stringify(final.navigation),final.locomotion.steps,final.time);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
