import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadBank} from './loadBank';
import {BankController} from './physics/BankController';
import {Navigator} from './physics/Navigator';
import {BankWorkflow} from './BankWorkflow';
import {BankHumanRenderer as HumanRenderer} from './BankHumanRenderer';
import {BankEnvironment} from './BankEnvironment';
import {DESTINATIONS,LOOK_TARGETS,SCENE_ID} from './BankLayout';
import {neutralFace,validFace,type FaceControls} from '../character/src/rendering/DeformationRig';
import {TEST_BARRIER,type Barrier} from './ObstacleTest';
import {NavigationDebug} from './NavigationDebug';
import {SimulationClock} from './physics/SimulationClock';

async function main() {
  const query=new URLSearchParams(location.search),obstacleTest=query.get('obstacle')==='1';
  const blocked=query.get('layout')==='blocked';
  const testBarrier={...TEST_BARRIER,x:blocked?0:(Math.random()-.5)*.6,w:blocked?9:TEST_BARRIER.w,h:blocked?TEST_BARRIER.h:query.get('height')==='low'?.2:TEST_BARRIER.h};
  const lowerBarrier={...TEST_BARRIER,name:'test_barrier_lower',x:testBarrier.x-1.1,y:testBarrier.y+.25,w:.8,d:.5,h:.05};
  // The regular scene and the navigation demo share the same visible, physical barriers.
  const barriers:Barrier[]=query.get('obstacle')==='0'?[]:
    (blocked?[testBarrier]:[testBarrier,lowerBarrier]).map(b=>({...b,active:true}));
  const engine=await loadBank(barriers);
  const controller=new BankController(engine),navigation=new Navigator(controller),workflow=new BankWorkflow(navigation);
  let paused=false,speed=1;
  const clock=new SimulationClock(engine.dt,()=>{controller.update(engine.dt);engine.step();navigation.update(engine.dt);workflow.update(engine.dt,engine.data.time);});
  const scene=new T.Scene();scene.background=new T.Color(0xe8eee8);
  const camera=new T.PerspectiveCamera(42,1,.05,100);camera.up.set(0,0,1);
  const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  document.getElementById('view')!.append(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
  controls.minDistance=2;controls.maxDistance=18;controls.maxPolarAngle=Math.PI*.49;
  function view(wide:boolean) {
    camera.position.set(...(wide?[7,-11,8]:[-4.8,-3.5,3.6]) as [number,number,number]);
    controls.target.set(wide?0:.6,wide?.1:-.35,wide?.55:.9);controls.update();
  }
  document.getElementById('wide')!.onclick=()=>view(true);
  document.getElementById('close')!.onclick=()=>view(false);view(true);
  scene.add(new T.HemisphereLight(0xffffff,0x657460,2.4));
  const light=new T.DirectionalLight(0xfff5df,3);light.position.set(1,-4,8);light.castShadow=true;
  light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-6,right:6,top:6,bottom:-6});scene.add(light);
  const bank=new BankEnvironment(scene),human=new HumanRenderer(engine);scene.add(human.group);
  const barrierGroup=new T.Group();scene.add(barrierGroup);
  const barrierPanels=new Map<string,T.Mesh>();
  for(const b of barriers){
    const lower=b.name==='test_barrier_lower';
    const panel=new T.Mesh(new T.BoxGeometry(b.w,b.d,b.h),new T.MeshStandardMaterial({color:lower?0xf0b323:0xe24b22}));
    panel.position.set(b.x,b.y,b.h/2);panel.castShadow=true;barrierGroup.add(panel);
      barrierPanels.set(b.name,panel);
    for(const z of b.h<.3?[b.h*.65]:[.3,.7,1.1,1.28]){
      const stripe=new T.Mesh(new T.BoxGeometry(b.w+.01,b.d+.01,Math.min(.08,b.h*.3)),new T.MeshStandardMaterial({color:lower?0xfff1ad:0xffeac2}));
      stripe.position.set(b.x,b.y,z);barrierGroup.add(stripe);
    }
    for(const x of b.w<.8?[0]:[-.4,0,.4]){
      const stripe=new T.Mesh(new T.BoxGeometry(.10,b.d+.02,b.h+.01),new T.MeshStandardMaterial({color:0x171717}));
      stripe.position.set(b.x+x,b.y,b.h/2);barrierGroup.add(stripe);
    }
  }
  function barrierState(){
    return barriers.map(b=>{
      const id=engine.mj.mj_name2id(engine.model,5,`bank_${b.name}`);
      return {name:b.name,height:b.h,visible:barrierGroup.visible&&!!barrierPanels.get(b.name)?.visible,
        physical:id>=0&&engine.model.geom_contype[id]!==0,active:b.active};
    });
  }
  function updateBarrierStatus(){
    const visible=barrierState().filter(b=>b.active&&b.visible&&b.physical);
    const lower=visible.find(b=>b.name==='test_barrier_lower');
    document.getElementById('barrier-status')!.textContent=`已加载路障：${visible.length} 个${lower?` · 黄色 ${Math.round(lower.height*100)} 厘米`:''}`;
    (document.getElementById('barrier-view') as HTMLButtonElement).disabled=!visible.length;
  }
  function viewBarriers(){
    const box=new T.Box3();
    for(const b of barriers)if(b.active)box.expandByObject(barrierPanels.get(b.name)!);
    if(box.isEmpty())return;
    const sphere=box.getBoundingSphere(new T.Sphere());
    const halfVertical=T.MathUtils.degToRad(camera.fov/2);
    const halfFov=Math.min(halfVertical,Math.atan(Math.tan(halfVertical)*camera.aspect));
    const distance=Math.max(controls.minDistance,sphere.radius/Math.sin(halfFov)*1.35);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(new T.Vector3(0,-1,1.5).normalize(),distance);
    controls.update();
  }
  document.getElementById('barrier-view')!.onclick=viewBarriers;
  updateBarrierStatus();
  human.joints.visible=false;human.skeleton.visible=false;human.muscles.group.visible=false;
  await human.loadSkin('/bank/models/human-skinned.glb');human.setSkinVisible(true);
  let face={...neutralFace},speechLevel=0,avatarStyle='procedural';
  const avatarSelect=document.getElementById('avatar') as HTMLSelectElement;
  const avatarStatus=document.getElementById('avatar-status')!;
  async function setAvatar(style:string){
    if(!['procedural','scan'].includes(style))return false;
    avatarSelect.disabled=true;
    try{
      await human.loadSkin(style==='scan'?'/human/local-scans/eric.glb':'/bank/models/human-skinned.glb');
      // loadSkin refreshes mesh visibility; keep physics furniture hidden after every swap.
      for(const [id,mesh] of human.meshes)if((engine.mj.mj_id2name(engine.model,5,id)??'').startsWith('bank_'))mesh.visible=false;
      avatarStyle=style;avatarSelect.value=style;avatarStatus.textContent=style==='scan'?'本地扫描人物':'程序人物';return true;
    }catch(error){avatarSelect.value=avatarStyle;avatarStatus.textContent='人物加载失败，保留当前外观';console.warn(error);return false;}
    finally{avatarSelect.disabled=false;}
  }
  avatarSelect.onchange=()=>void setAvatar(avatarSelect.value);
  // Only the explicit local scan endpoint is served; private source assets stay outside web/.
  void fetch('/human/models/local-scan-status.json').then(r=>r.ok?r.json():{available:false}).then(async status=>{
    if(status.available){avatarSelect.add(new Option('真人扫描 Eric','scan'));await setAvatar('scan');}
  }).catch(()=>{});
  // Collision envelopes are in MuJoCo; detailed furniture remains in BankEnvironment.
  for(const [id,mesh] of human.meshes)if((engine.mj.mj_id2name(engine.model,5,id)??'').startsWith('bank_'))mesh.visible=false;
  document.getElementById('loading')!.remove();
  const captureTarget=new T.WebGLRenderTarget(768,512);
  captureTarget.texture.colorSpace=T.SRGBColorSpace;
  const headId=engine.mj.mj_name2id(engine.model,1,'head');
  function captureFrame(view='person'){
    if(!['person','observer'].includes(view))throw new Error('未知截图视角');
    human.sync();scene.updateMatrixWorld(true);
    const eye=camera.clone();eye.aspect=768/512;
    if(view==='person'){
      if(headId<0)throw new Error('未找到人物头部');
      const d=engine.data,b=headId*9,p=headId*3;
      const forward=new T.Vector3(-d.xmat[b+1],-d.xmat[b+4],-d.xmat[b+7]);
      const up=new T.Vector3(d.xmat[b+2],d.xmat[b+5],d.xmat[b+8]);
      eye.position.set(d.xpos[p],d.xpos[p+1],d.xpos[p+2]);
      eye.position.addScaledVector(forward,.14).addScaledVector(up,.07);
      eye.up.copy(up);eye.lookAt(eye.position.clone().add(forward));
      eye.fov=75;eye.near=.03;
    }
    eye.updateProjectionMatrix();
    const previousTarget=renderer.getRenderTarget(),pixels=new Uint8Array(768*512*4);
    try{
      renderer.setRenderTarget(captureTarget);renderer.render(scene,eye);
      renderer.readRenderTargetPixels(captureTarget,0,0,768,512,pixels);
    }finally{renderer.setRenderTarget(previousTarget);}
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=512;
    const ctx=canvas.getContext('2d')!,data=ctx.createImageData(768,512);
    for(let y=0;y<512;y++)data.data.set(pixels.subarray((511-y)*768*4,(512-y)*768*4),y*768*4);
    ctx.putImageData(data,0,0);
    return {image:canvas.toDataURL('image/jpeg',.85),view,time:engine.data.time};
  }
  // Preserve the public body API used by the bridge. Only the bank wrapper adds pause/speech controls.
  (window as any).human={
    captureFrame,
    obstacleTest,
    getSceneDiagnostics:()=>({url:location.href,bundle:import.meta.url,barriers:barrierState()}),
    getNavigationDebug:()=>({events:navigation.events,cells:navigation.localMap.elevation,path:navigation.remainingPath()}),
    reportVisualObstacle:()=>navigation.reportVisualObstacle(),
    removeTestObstacle:()=>{
      if(!barriers.some(barrier=>barrier.active))return false;
      for(const barrier of barriers){
        const id=engine.mj.mj_name2id(engine.model,5,`bank_${barrier.name}`);
        if(id<0)continue;
        engine.model.geom_contype[id]=0;engine.model.geom_conaffinity[id]=0;barrier.active=false;
      }
      barrierGroup.visible=false;
      updateBarrierStatus();
      engine.mj.mj_forward(engine.model,engine.data);return true;
    },
    executeAction:(command:any)=>controller.executeAction(command),
    performAction:(command:any)=>controller.performAction(command),
    cancelAction:()=>controller.cancel(),
    setFinger:(side:any,finger:any,value:number)=>controller.setFinger(side,finger,value),
    setMotionReference:(value:number)=>controller.setMotionReference(value),
    setLegDrive:(mode:any)=>controller.setLegDrive(mode),
    configureMuscleSenses:(options:any)=>controller.legMuscles.configure(options),
    setEyeTarget:(target:number[])=>controller.setEyeTarget(target),
    setFace:(patch:Partial<FaceControls>)=>{if(!validFace(patch))return false;face={...face,...patch};return true;},
    setSpeechLevel:(value:number)=>{speechLevel=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;},
    navigate:(target:string)=>navigation.go(target),
    stopNavigation:()=>navigation.stop(),
    takeTicket:()=>workflow.take(engine.data.time),
    drainEvents:()=>workflow.drain(),
    // 这个身体实际能做的动作和能去的地点，桥接页面在 hello 里原样声明给大脑
    capabilities:()=>({scenario:SCENE_ID,actions:['wait','walk_to','wave','nod','shake_head','look_at','hand_over','take'],
      places:Object.keys(DESTINATIONS),look_targets:LOOK_TARGETS}),
    setWalkingSpeed:(value:number)=>controller.locomotion.setSpeed(value),
    getState:()=>({status:controller.status,time:engine.data.time,timing:clock.snapshot(),actionResult:controller.result(),
      locomotion:controller.locomotion.getState(),navigation:navigation.getState(),bank:workflow.state(),joints:controller.snapshot(),
      reach:controller.reach.snapshot(),muscles:controller.muscles.snapshot(),legMuscles:controller.legMuscles.snapshot(),physicalEyes:controller.physicalEyes.snapshot(),body:engine.bodyState(),face:{...face,jawOpen:Math.max(face.jawOpen,speechLevel)},avatar:avatarStyle}),
    setPaused:(value:boolean)=>{paused=value;clock.resetAccumulator();},
    setSpeed:(value:number)=>{if([1,4,8].includes(value))speed=value;},
    say:(who:string|null,text='',name?:string)=>{
      if(who!=='customer')speechLevel=0;
      bank.speaking(who);document.getElementById('caption')!.textContent=text?`${name??(who==='robot'?'服务机器人':who==='teller'?'柜员':who==='broadcast'?'大厅广播':'顾客')}：${text}`:'';
    },
  };
  const drive=document.getElementById('leg-drive') as HTMLSelectElement;
  const reflex=document.getElementById('spindle-reflex') as HTMLInputElement;
  const eyes=document.getElementById('physical-eyes') as HTMLInputElement;
  const bodyStatus=document.getElementById('body-status')!;
  const walkingSpeed=document.getElementById('walking-speed') as HTMLInputElement;
  const walkingSpeedValue=document.getElementById('walking-speed-value')!;
  walkingSpeed.oninput=()=>controller.locomotion.setSpeed(Number(walkingSpeed.value));
  drive.onchange=()=>{
    if(!controller.setLegDrive(drive.value as 'servo'|'ankle'|'full')){
      drive.value=controller.legMuscles.mode;bodyStatus.textContent='请先停步站稳并结束当前动作，再切换腿部驱动。';
    }
  };
  reflex.onchange=()=>controller.legMuscles.configure({reflexes:reflex.checked});
  eyes.onchange=()=>{controller.physicalEyes.enabled=eyes.checked;};
  function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
  addEventListener('resize',resize);resize();
  if(obstacleTest)viewBarriers();
  const navigationDebug=new NavigationDebug(navigation,barriers,obstacleTest);
  let previous=performance.now(),frame=0,lastBodyStatus=-1;
  function animate(now:number){
    clock.advance((now-previous)/1000,speed,paused);
    if(now-lastBodyStatus>250){
      lastBodyStatus=now;drive.disabled=controller.locomotion.mode!=='stand'||!controller.locomotion.settled||controller.status==='running';
      drive.value=controller.legMuscles.mode;
      const motion=controller.locomotion.getState().motion;
      walkingSpeed.max=String(motion.maxSpeed);walkingSpeed.value=String(motion.speed);walkingSpeed.disabled=motion.maxSpeed<=.25;
      walkingSpeedValue.textContent=`${motion.speed.toFixed(2)} m/s`;
      const active=controller.legMuscles.snapshot().muscles.filter(m=>m.active);
      bodyStatus.textContent=`${motion.warmup?'起步加速 · ':motion.balanceSlowdown?'平衡调整减速 · ':''}步速 ${Math.hypot(engine.data.qvel[0],engine.data.qvel[1]).toFixed(2)} m/s · ${active.length} 个肌肉单元 · 肌梭 Ia ${(active[0]?.spindle.ia??0).toFixed(0)} Hz · ${controller.physicalEyes.enabled?'物理眼球已开启':'物理眼球已关闭'}`;
    }
    previous=now;human.setFace({...face,jawOpen:Math.max(face.jawOpen,speechLevel)},true);human.sync();bank.updateCustomer(engine.data.qpos[0],engine.data.qpos[1]);controls.update();renderer.render(scene,camera);navigationDebug.update(now);frame=requestAnimationFrame(animate);
  }
  frame=requestAnimationFrame(animate);
  addEventListener('beforeunload',()=>{cancelAnimationFrame(frame);navigationDebug.dispose();delete (window as any).human;captureTarget.dispose();human.dispose();controller.dispose();engine.dispose();controls.dispose();bank.dispose();renderer.dispose();});
}
main().catch(error=>{document.getElementById('loading')!.textContent=`加载失败：${error}`;console.error(error);});
