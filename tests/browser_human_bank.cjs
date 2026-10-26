const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
  await fs.mkdir('logs',{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await require('./browser_host.cjs')(page);
    await page.goto('http://127.0.0.1:8080/bank/');
    await page.waitForFunction(()=>window.human?.getState().time>2,null,{timeout:60000});
    let state=await page.evaluate(()=>window.human.getState());
    assert.equal(state.locomotion.motion.speed,.5);assert.equal(state.timing.speed,1);
    assert.ok(state.timing.realTimeFactor<=1.01,'walking speed must not be faked by increasing simulation time');
    await page.waitForTimeout(2000);
    const steady=await page.evaluate(()=>window.human.getState());
    const steadyTimeFactor=(steady.time-state.time)/(steady.timing.realTime-state.timing.realTime);
    assert.equal(await page.evaluate(()=>window.human.setWalkingSpeed(.8)),false);
    assert.equal(await page.evaluate(()=>window.human.setWalkingSpeed(.4)),true);
    await page.waitForFunction(()=>document.getElementById('walking-speed-value').textContent==='0.40 m/s');
    assert.equal(await page.evaluate(()=>window.human.setWalkingSpeed(.5)),true);
    await page.waitForFunction(()=>document.getElementById('walking-speed-value').textContent==='0.50 m/s');
    await page.screenshot({path:'logs/human-bank-default-speed.png'});
    assert.ok(state.legMuscles.available&&state.physicalEyes.available);
    assert.equal(state.legMuscles.muscles.length,34);
    await page.waitForFunction(()=>!document.getElementById('leg-drive').disabled);
    await page.selectOption('#leg-drive','ankle');
    await page.waitForFunction(()=>window.human.getState().legMuscles.mode==='ankle');
    await page.waitForFunction(()=>window.human.getState().legMuscles.muscles.some(m=>m.active&&m.force>100));
    await page.selectOption('#leg-drive','full');
    await page.waitForFunction(()=>window.human.getState().legMuscles.mode==='full');
    assert.equal(await page.evaluate(()=>window.human.getState().locomotion.motion.maxSpeed),.25);
    assert.equal(await page.locator('#walking-speed').isDisabled(),true);
    await page.uncheck('#spindle-reflex');assert.equal(await page.evaluate(()=>window.human.getState().legMuscles.reflexes),false);
    await page.check('#spindle-reflex');
    await page.uncheck('#physical-eyes');assert.equal(await page.evaluate(()=>window.human.getState().physicalEyes.enabled),false);
    await page.check('#physical-eyes');
    assert.ok(await page.evaluate(()=>window.human.performAction({id:41,action:'nod'})));
    await page.waitForFunction(()=>window.human.getState().actionResult.status==='completed',null,{timeout:30000});
    assert.equal(await page.evaluate(()=>window.human.getState().actionResult.id),41);
    await page.evaluate(()=>window.human.setPaused(true));const before=await page.evaluate(()=>window.human.getState());
    await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>window.human.getState()),before);
    await page.screenshot({path:'logs/human-bank-integrated.png'});
    assert.ok(before.legMuscles.motors.every(m=>m.force===0));assert.deepEqual(errors,[]);
    console.log('PASS bank model, 34 muscles, spindle/eye controls, command feedback and pause',
      {initialTimeFactor:state.timing.realTimeFactor,steadyTimeFactor,finalTimeFactor:before.timing.realTimeFactor,walkingSpeed:state.locomotion.motion.speed});
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
