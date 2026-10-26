const $=id=>document.getElementById(id);
let baseline=null,owner=null,busy=false,generation=0;
const human=()=> $('human').contentWindow?.human;
export async function observeForAgent(commandId,phase,isCurrent){
  if(busy||!human()?.captureFrame)return null;
  busy=true;update();const body=human(),token=generation,started=performance.now();
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
  const initial=body.getState().locomotion;
  const neck=body.getState().joints?.filter(j=>j.name.startsWith('neck_')).map(j=>({name:j.name,actual:j.actual}))??[];
  try{
    const frame=body.captureFrame('person');previews([frame]);
    $('vision-status').textContent='正在观察人物视野，供下一轮动作决策使用…';
    const response=await fetch('/api/vision',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({frames:[frame],question:phase==='during_navigation'
        ?'这是行走中的人物视角。重点观察正前方通道是否有实体阻挡，填写 path_obstacle 并简述可见依据；不要把侧面家具当成阻挡，看不清填 uncertain。'
        :'描述可见的服务设备、人物、障碍和遮挡；看不清请说明，不判断动作成功。'}),
      signal:abort.signal});
    if(!response.ok)throw new Error('视觉服务暂不可用');
    const result=await response.json(),state=body.getState(),current=state.locomotion;
    const moved=initial?.pelvis&&current?.pelvis&&
      Math.hypot(...current.pelvis.map((v,i)=>v-initial.pelvis[i]))>.15;
    const turned=Number.isFinite(initial?.yaw)&&Number.isFinite(current?.yaw)&&
      Math.abs(Math.atan2(Math.sin(current.yaw-initial.yaw),Math.cos(current.yaw-initial.yaw)))>.15;
    const headMoved=neck.some(j=>Math.abs((state.joints?.find(n=>n.name===j.name)?.actual??j.actual)-j.actual)>.15);
    if(token!==generation||body!==human()||!isCurrent()||moved||turned||headMoved||
      performance.now()-started>20000||state.time<frame.time||state.time-frame.time>30){
      $('vision-status').textContent='视觉结果已过期，使用当前身体状态继续';return null;
    }
    $('vision-status').textContent=`${result.model} · ${result.latency_seconds} 秒 · ${phase==='during_navigation'?'已提供给行走障碍检查':'已提供给 Agent'}`;
    $('vision-result').textContent=JSON.stringify(result.observation,null,2);
    return {captured_at:frame.time,command_id:commandId,view:'person',phase,observation:result.observation};
  }catch{
    if(token===generation)$('vision-status').textContent='视觉不可用，使用原有状态反馈继续';
    return null;
  }finally{clearTimeout(timer);busy=false;update();}
}
function update(){
  const ready=!!human()?.captureFrame;
  $('vision-baseline').disabled=busy||!ready;
  $('vision-single').disabled=busy||!ready;
  $('vision-compare').disabled=busy||!ready||!baseline;
  $('vision-view').disabled=busy;
}
function previews(frames){
  $('vision-images').replaceChildren(...frames.map((f,i)=>{
    const image=document.createElement('img');image.src=f.image;
    image.alt=`截图 ${i+1}，仿真 ${f.time.toFixed(2)} 秒`;
    image.style.cssText='width:48%;height:auto;object-fit:contain';return image;
  }));
}
function reset(){
  generation++;baseline=null;owner=null;
  $('vision-images').replaceChildren();$('vision-result').textContent='';
  $('vision-status').textContent='场景或视角已变化，请重新截图';update();
}
$('human').addEventListener('load',reset);
$('vision-view').onchange=reset;
$('vision-baseline').onclick=()=>{
  try{owner=human();baseline=owner.captureFrame($('vision-view').value);previews([baseline]);
    $('vision-status').textContent=`已保存动作前截图（${baseline.time.toFixed(2)} 秒），执行动作后点击对比`;
  }catch(e){$('vision-status').textContent=e.message;}update();
};
async function inspect(compare){
  if(busy)return;
  busy=true;update();const token=generation,body=human();
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),90000);
  $('vision-result').textContent='';
  try{
    if(compare&&(!baseline||owner!==body))throw new Error('请重新保存动作前截图');
    const current=body.captureFrame($('vision-view').value);
    const frames=compare?[baseline,current]:[current];previews(frames);
    $('vision-status').textContent='正在识别已截取的画面…';
    const response=await fetch('/api/vision',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({frames,question:$('vision-question').value}),signal:abort.signal});
    const result=await response.json();
    if(token!==generation||body!==human())return;
    if(!response.ok)throw new Error(result.error||'视觉服务请求失败');
    $('vision-status').textContent=`${result.model} · ${result.latency_seconds} 秒 · 结果对应截图时刻`;
    $('vision-result').textContent=JSON.stringify(result.observation,null,2);
  }catch(e){if(token===generation)$('vision-status').textContent=e.name==='AbortError'?'请求超时，请稍后重试':e.message;}
  finally{clearTimeout(timer);busy=false;update();}
}
$('vision-single').onclick=()=>void inspect(false);
$('vision-compare').onclick=()=>void inspect(true);
setInterval(update,500);update();
