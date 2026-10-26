import {ActionRunner,navigationSummary} from './actions.mjs';
import {observeForAgent} from './vision.mjs';
import {ObstacleWatch} from './obstacle_watch.mjs';
const $=id=>document.getElementById(id);
let socket=null,ready=false,thinking=false,staffThinking=false,paused=false,ended=false;
let epoch=0,inbox=[],processing=false,lastId=-1,lastStaff=0,localId=0,audioFinish=null;
let observing=false;
let demoPending=false,demoLoaded=false;
let sceneLoading=false,awaitingRecovery=false;
const failedNavigation=new Map();
const results=new Map();let broadcasts=[];
// 场景里的员工（ready 消息里给出），默认按银行场景
let greeter='robot',staffNames={robot:'服务机器人',teller:'柜员'};
const human=()=> $('human').contentWindow?.human;
let audioContext=null,analyser=null,audioSamples=null,customerAudio=false;
function trackSpeech(who){
  customerAudio=who==='customer';
  // Reuse one media source; reconnecting the same audio element is invalid in Web Audio.
  try{
    if(!audioContext){
      const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
      audioContext=new Context();analyser=audioContext.createAnalyser();analyser.fftSize=256;
      audioContext.createMediaElementSource($('audio')).connect(analyser);analyser.connect(audioContext.destination);
      audioSamples=new Float32Array(analyser.fftSize);
    }
    void audioContext.resume().catch(()=>{});
  }catch{customerAudio=false;}
}
function updateSpeech(){
  let level=0;
  if(customerAudio&&analyser&&!paused&&!$('audio').paused&&!$('audio').ended){
    analyser.getFloatTimeDomainData(audioSamples);
    level=Math.min(.75,Math.sqrt(audioSamples.reduce((sum,x)=>sum+x*x,0)/audioSamples.length)*3);
  }
  human()?.setSpeechLevel?.(level);
}
const auto=()=> $('mode').value==='auto';
function log(text){const row=document.createElement('div');row.textContent=text;$('log').append(row);
  while($('log').children.length>150)$('log').firstChild.remove();$('log').scrollTop=$('log').scrollHeight;}
function send(msg){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(msg));}
const runner=new ActionRunner(human,msg=>{
  if(msg.type==='action_progress'){
    log(`行走 #${msg.id}：${msg.phase==='blocked'?'感知到受阻，正在减停':msg.phase==='replanning'?'已停稳，正在寻找路线':'已重新规划，继续行走'}（成功 ${msg.navigation.replans} 次 / 尝试 ${msg.navigation.planningAttempts} 次）`);
    if(typeof msg.id==='number'&&ready)send(msg);
    return;
  }
  results.set(msg.id,msg);
  log(`动作 #${msg.id} ${msg.action}：${msg.status} — ${msg.message}`);
  if(typeof msg.id==='number'&&ready){
    if(msg.action==='walk_to'&&msg.status==='failed')failedNavigation.set(msg.target,{id:msg.id,sent:false});
    if(msg.action==='walk_to'&&msg.status==='completed')failedNavigation.delete(msg.target);
    send(msg);
  }
});
const obstacleWatch=new ObstacleWatch(human,()=>runner.active,observeForAgent,log);
$('human').addEventListener('load',()=>{demoLoaded=true;sceneLoading=false;});
function sceneUrl(kind){return kind==='normal'?`/bank/?obstacle=0&reload=${Date.now()}`:
  `/bank/?obstacle=1&height=low${kind==='blocked'?'&layout=blocked':''}&reload=${Date.now()}`;}
$('obstacle-start').onclick=()=>{
  if(socket||runner.active)return;
  epoch++;demoPending=true;demoLoaded=false;sceneLoading=true;ended=false;paused=false;results.clear();failedNavigation.clear();awaitingRecovery=false;
  $('vision-agent').checked=false;$('speed').value='1';
  $('human').src=sceneUrl($('navigation-scenario').value);
};
$('navigation-load').onclick=()=>{
  if(socket||runner.active||sceneLoading)return;
  epoch++;demoPending=false;demoLoaded=false;sceneLoading=true;ended=false;paused=false;results.clear();failedNavigation.clear();awaitingRecovery=false;
  const kind=$('navigation-scenario').value;
  $('human').src=sceneUrl(kind);
  log('正在加载所选场景；人物就绪后连接大脑，即可验证完整任务反馈。');
};
$('obstacle-remove').onclick=()=>{
  if(human()?.removeTestObstacle?.())log('已移除场景路障；导航通过后续感知更新，不直接通知恢复');
};
function state(){const s=human()?.getState();return {time:s?.time??0,location:s?.navigation?.location??'entrance',posture:'standing',current_action:runner.active?.action??'wait',navigation:navigationSummary(s)};}
function bankState(){return human()?.getState().bank??{};}
function waitingForCall(){return state().location==='waiting_area'&&bankState().ticket&&!bankState().called_counter;}
// audio：员工说话的录音（base64 mp3）。带上它，大脑会用 ASR 听写，以识别结果为准。
async function event(type,content,audio,commandId){
  const token=epoch,body=human(),id=lastId<0?null:lastId;
  let vision=null;
  const shouldObserve=$('vision-agent').checked&&
    (['scene_start','robot_speech','teller_speech','action_failed'].includes(type)||
      type==='action_done'&&results.get(commandId)?.action==='walk_to');
  const valid=()=>token===epoch&&body===human()&&(lastId<0?null:lastId)===id;
  if(shouldObserve){
    observing=true;update();
    try{vision=await observeForAgent(id,commandId===undefined?'before_decision':'after_action',valid);}
    finally{if(token===epoch)observing=false;}
    if(!valid())return;
    if(!await waitUntil(()=>!paused,token)||!valid())return;
    if(vision&&state().time-vision.captured_at>30)vision=null;
  }
  if(!valid())return;
  const m={type:'event',event:{type,content,time:state().time},state:state(),bank:bankState()};
  if(vision)m.vision=vision;
  if(commandId!==undefined)m.command_id=commandId;
  if(audio)m.audio=audio;send(m);}
function waitUntil(test,token){return new Promise(resolve=>{
  const timer=setInterval(()=>{if(token!==epoch||test()){clearInterval(timer);resolve(token===epoch);}},50);
});}
async function textDelay(text,token){
  let remaining=Math.min(5000,Math.max(1000,text.length*65)),previous=performance.now();
  return waitUntil(()=>{const now=performance.now();if(!paused)remaining-=now-previous;previous=now;return remaining<=0;},token);
}
function update(){
  const loaded=!!human()&&!sceneLoading;$('connect').disabled=!loaded||!!socket||!!runner.active;$('disconnect').disabled=!socket;
  for(const id of ['persona','url','mode','vision-agent'])$(id).disabled=!!socket;
  $('pause').disabled=!loaded||(socket?(!ready||ended):!runner.active);$('pause').textContent=paused?'继续':'暂停';
  $('connect').textContent=auto()?'开始自动对话':'连接大脑';$('chat').hidden=auto();
  $('send').disabled=!ready||thinking||staffThinking||processing||observing||paused||ended;
  document.querySelectorAll('[data-action]').forEach(b=>b.disabled=!loaded||!!socket||!!runner.active);
  const s=human()?.getState();
  $('obstacle-start').disabled=!!socket||!!runner.active||demoPending;
  $('navigation-load').disabled=!!socket||!!runner.active||demoPending||sceneLoading;
  $('navigation-scenario').disabled=$('navigation-load').disabled;
  $('obstacle-remove').disabled=!human()?.obstacleTest;
  const nav=s?.navigation;
  $('obstacle-status').textContent=human()?.obstacleTest||nav?.target?
    `导航：${nav?.status} · 障碍处理：${nav?.obstaclePhase??'none'} · 成功重规划：${nav?.replans??0} / 尝试：${nav?.planningAttempts??0} · 高程格：${nav?.observedCells??0} · 来源：${nav?.obstacleSource==='vision'?'VLM 怀疑＋高程图确认':nav?.obstacleSource==='depth_elevation'?'头部深度＋高程地图':'尚未触发'}`:'尚未开始';
  $('physical').textContent=s?`位置：${s.navigation?.location} · ${s.locomotion?.phase} · 仿真 ${s.time.toFixed(1)} 秒\n目标：${s.navigation?.target??'—'} · 距离 ${(s.navigation?.distance??0).toFixed(2)} 米\n号码：${s.bank?.ticket??'未取号'} · 叫号柜台：${s.bank?.called_counter??'未叫号'}`:'正在加载物理模型';
  $('status').textContent=!loaded?'等待人物加载':ended?'本场已结束':paused?'已暂停 · 点击继续恢复':
    observing?'正在观察环境…':staffThinking?'机器人正在思考 / 合成语音…':thinking?'顾客正在思考 / 合成语音…':
    ready?(awaitingRecovery?'等待道路恢复或工作人员进一步帮助':waitingForCall()?'正在等候叫号':auto()?'自动银行流程进行中':'已连接 · 可以对话'):socket?'正在连接大脑…':'银行场景就绪';
}
function disconnect(){
  epoch++;inbox=[];processing=false;observing=false;ready=false;thinking=false;staffThinking=false;paused=false;
  runner.clear();human()?.stopNavigation?.();human()?.setPaused?.(false);human()?.say?.(null);results.clear();broadcasts=[];
  failedNavigation.clear();awaitingRecovery=false;
  if(audioFinish)audioFinish(false);$('audio').pause();$('audio').removeAttribute('src');$('audio').load();
  customerAudio=false;human()?.setSpeechLevel?.(0);
  $('speaker').textContent='等待开始';
  $('skip-audio').hidden=true;
  const old=socket;socket=null;if(old?.readyState===WebSocket.OPEN)old.send(JSON.stringify({type:'bye'}));old?.close();update();
}
function requestStaff(commandId){staffThinking=true;send({type:'staff_request',command_id:commandId,state:state(),bank:bankState()});update();}
function finish(message){ended=true;thinking=false;staffThinking=false;log(message);$('speaker').textContent='咨询结束';update();}
async function speak(msg,who,token){
  if(!msg.speech)return true;
  const name=who==='customer'?'顾客':(msg.label||staffNames[who]||who);
  log(`${name}：${msg.speech}`);
  human()?.say?.(who===greeter?'robot':who==='customer'?'customer':'teller',msg.speech,name);$('speaker').textContent=`${name}正在说话`;
  if(!msg.audio){return textDelay(msg.speech,token);}
  const complete=await new Promise(resolve=>{
    const audio=$('audio');let settled=false;
    const done=success=>{
      if(settled)return;settled=true;audio.onended=null;audio.onerror=null;audio.onplay=null;
      audioFinish=null;$('skip-audio').hidden=true;resolve(success);
      customerAudio=false;human()?.setSpeechLevel?.(0);
    };
    audioFinish=done;
    audio.onended=()=>done(true);
    audio.onerror=()=>{log('音频播放失败，按文字继续。');done(false);};
    audio.onplay=()=>{if(paused)audio.pause();else trackSpeech(who);};
    audio.src=`data:audio/mpeg;base64,${msg.audio}`;$('skip-audio').hidden=false;
    audio.play().catch(()=>{if(token===epoch)log('自动播放受限，请点击播放器播放，或跳过本句语音。');});
  });
  if(token!==epoch)return false;
  if(complete)send({type:'audio_done',id:msg.id});
  else await textDelay(msg.speech,token);
  return token===epoch;
}
async function pump(){
  if(processing||paused||!ready||ended||!inbox.length)return;
  processing=true;const token=epoch;update();
  try{
    while(inbox.length&&token===epoch&&!ended){
      if(!await waitUntil(()=>!paused,token))return;
      const msg=inbox.shift();
      if(msg.type==='auto_finished'){finish(msg.message);break;}
      const staff=msg.type==='staff_command';
      if(staff&&(msg.speaker==='none'||!msg.speech)){
        if(waitingForCall()||broadcasts.length)continue;
        if(state().navigation?.unavailable_targets?.length){awaitingRecovery=true;log('道路仍不可达，保持等待；新的可达证据或工作人员消息到来后再决策。');continue;}
        finish('工作人员暂无后续回应，本场结束。');break;
      }
      for(const error of msg.errors??[])log(error);
      if(!staff)runner.execute(msg);
      if(!await speak(msg,staff?msg.speaker:'customer',token))return;
      if(!await waitUntil(()=>!paused&&!runner.active,token))return;
      if(ended)break;
      human()?.say?.(null);$('speaker').textContent='等待下一轮';
      if(staff){
        // Only after the robot's audio ended does the customer hear it.
        await event(msg.speaker===greeter?'robot_speech':'teller_speech',msg.speech,msg.audio);if(token!==epoch)return;thinking=true;
      }else if(['failed','interrupted'].includes(results.get(msg.id)?.status)){
        const result=results.get(msg.id);await event('action_failed',result.message,undefined,msg.id);if(token!==epoch)return;thinking=true;
      }else if(msg.action==='take'&&state().location==='ticket_machine'){
        const result=human().takeTicket();log(result.message);await event(result.ok?'action_done':'action_failed',result.message,undefined,msg.id);if(token!==epoch)return;thinking=true;
      }else if(msg.goal_status&&msg.goal_status!=='in_progress'){
        finish('顾客咨询已结束。');
      }else if(msg.action==='walk_to'){
        await event('action_done',results.get(msg.id)?.message??`已经抵达 ${state().location}`,undefined,msg.id);if(token!==epoch)return;thinking=true;
      }else if(auto()){
        if(waitingForCall()||broadcasts.length){/* Physical queue will emit the next event. */}
        else if(!msg.speech&&msg.action==='wait'&&state().navigation?.unavailable_targets?.length){
          awaitingRecovery=true;log('身体已停止且目标暂不可达，等待新证据或进一步指引。');
        }
        else if(!msg.speech&&msg.action==='wait'&&state().location==='exit'){finish('顾客已离开银行。');}
        else requestStaff(msg.id);
      }
      results.delete(msg.id);
    }
  }catch(e){log(`对话处理失败：${e}`);finish('请结束后重新开始。');}
  finally{if(token===epoch){processing=false;update();if(inbox.length&&!paused&&!ended)void pump();}}
}
$('connect').onclick=()=>{
  ended=false;paused=false;awaitingRecovery=false;failedNavigation.clear();human()?.setPaused?.(false);lastId=-1;lastStaff=0;epoch++;$('log').replaceChildren();
  try{socket=new WebSocket($('url').value.trim());}catch(e){log(`连接失败：${e}`);update();return;}
  const ws=socket;
  ws.onopen=()=>{if(socket!==ws)return;const caps=human()?.capabilities?.()??{};
    send({type:'hello',version:1,persona:$('persona').value,scenario:caps.scenario,body_profile:'human_3d',mode:$('mode').value,
      capabilities:{actions:caps.actions,places:caps.places,look_targets:caps.look_targets}});};
  ws.onmessage=({data})=>{
    if(socket!==ws)return;
    try{
      const msg=JSON.parse(data);
      if(msg.type==='ready'){
        ready=true;log(`顾客：${msg.persona.name}。已连接大脑。`);
        if(msg.scenario?.staff){staffNames=Object.fromEntries(Object.entries(msg.scenario.staff).map(([k,v])=>[k,v.label]));
          greeter=msg.scenario.greeter??Object.keys(msg.scenario.staff)[0];log(`场景：${msg.scenario.name}`);}
        if(auto())requestStaff(null);
        else {event('scene_start',`你走进了大厅，现在在 ${state().location}。`);thinking=true;}
      }else if(msg.type==='status')thinking=!!msg.thinking;
      else if(msg.type==='staff_status')staffThinking=!!msg.thinking;
      else if(msg.type==='command'){
        if(msg.id<=lastId)return;thinking=false;awaitingRecovery=false;lastId=msg.id;inbox.push(msg);void pump();
      }else if(msg.type==='staff_command'){
        if(msg.turn<=lastStaff)return;staffThinking=false;lastStaff=msg.turn;inbox.push(msg);void pump();
      }else if(msg.type==='auto_finished'){inbox.push(msg);void pump();}
      else if(msg.type==='error'){log(`大脑错误：${msg.message}`);if(auto())finish('自动咨询遇到错误，请结束后重试。');}
      else if(msg.type==='feedback_received'){
        if(msg.accepted===false){log(`大脑拒绝动作 #${msg.id} 的反馈：${msg.reason}`);if(msg.id===lastId)finish('动作反馈不一致，请结束并重新加载场景。');}
        else log(`大脑已记录动作 #${msg.id} 的反馈`);
      }
    }catch(e){log(`消息处理失败：${e}`);}update();
  };
  ws.onerror=()=>{if(socket===ws)log('连接错误，请确认 brain_server.py 已启动。');};
  ws.onclose=()=>{if(socket===ws){log('大脑连接已断开');disconnect();}};update();
};
$('pause').onclick=()=>{
  paused=!paused;human()?.setPaused?.(paused);
  if(paused)$('audio').pause();
  else {if(audioFinish)$('audio').play().catch(()=>log('请点击播放器恢复语音。'));void pump();}
  update();
};
$('skip-audio').onclick=()=>{$('audio').pause();if(audioFinish)audioFinish(false);};
$('disconnect').onclick=()=>{disconnect();ended=true;log('本场已结束。');update();};
$('mode').onchange=update;
$('speed').onchange=()=>human()?.setSpeed?.(Number($('speed').value));
$('motion-reference').onchange=()=>human()?.setMotionReference?.(Number($('motion-reference').value));
$('reset').onclick=()=>{if(socket)return;runner.clear();results.clear();failedNavigation.clear();broadcasts=[];paused=false;ended=false;awaitingRecovery=false;sceneLoading=true;$('human').src='/bank/';$('speed').value='1';$('motion-reference').value='1';};
$('chat').onsubmit=e=>{
  e.preventDefault();const text=$('text').value.trim();
  if(!text||$('send').disabled||auto())return;
  log(`机器人：${text}`);event('robot_speech',text);$('text').value='';thinking=true;update();
};
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>runner.execute({id:`local-${++localId}`,action:b.dataset.action,target:b.dataset.target}));
setInterval(()=>{
  if(demoPending&&demoLoaded&&human()){
    demoPending=false;human().setSpeed(1);runner.execute({id:`local-${++localId}`,action:'walk_to',target:'help_desk'});
    log('本地行走测试开始：目标为咨询台，感知、恢复及到达由人物侧完成；此按钮不连接大脑。');
  }
  updateSpeech();
  if(ready&&!human()){log('人物已重载，请重新连接。');disconnect();}
  runner.tick();
  void obstacleWatch.tick($('vision-agent').checked,paused).catch(e=>log(`途中视觉检查失败：${e.message}`));
  if(ready&&!ended&&!paused&&!processing&&!thinking&&!staffThinking&&!runner.active&&!inbox.length){
    const retryable=state().navigation?.retryable_targets??[];
    for(const target of retryable){
      const failure=failedNavigation.get(target);if(!failure||failure.sent)continue;
      failure.sent=true;awaitingRecovery=false;thinking=true;
      log(`身体重新观测确认 ${target} 已恢复可达，交给大脑决定是否继续。`);
      void event('navigation_available',`重新观测并规划确认 ${target} 恢复可达；此前行走仍记为失败，请结合原任务决定下一步。`,undefined,failure.id);
      break;
    }
  }
  if(ready)broadcasts.push(...(human()?.drainEvents?.()??[]));
  if(ready&&!ended&&!paused&&!processing&&!thinking&&!staffThinking&&!inbox.length&&broadcasts.length){
    const next=broadcasts.shift();log(`大厅广播：${next.content}`);human()?.say?.('broadcast',next.content);$('speaker').textContent=next.content;event(next.type,next.content);thinking=true;
  }
  $('reset').disabled=!!socket;update();
},100);
addEventListener('beforeunload',disconnect);update();
