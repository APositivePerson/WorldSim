import {OBSTACLES,CLEARANCE,blockingAlong,type Point} from './BankLayout';
import {BLOCK_HEIGHT,isBlockingCell,type ElevationCell} from './physics/LocalSensor';
import type {Navigator,NavigationEvent} from './physics/Navigator';
import type {Barrier} from './ObstacleTest';

/** Observer-only display. Ground-truth outlines never enter the sensor or planner. */
export class NavigationDebug {
  private root=document.createElement('details');
  private canvas:HTMLCanvasElement;
  private select:HTMLSelectElement;
  private info:HTMLElement;
  private cellInfo:HTMLElement;
  private truth:HTMLInputElement;
  private margin:HTMLInputElement;
  private lastUpdate=-Infinity;
  private eventKey='';
  private selectedCell:Point|null=null;
  private readonly names:Record<string,string>={start:'开始',stop:'发现受阻',replan:'重新规划',no_route:'无可用路线',failed:'失败',arrived:'到达',available:'恢复可达'};
  constructor(private nav:Navigator,private barriers:Barrier[],open=false){
    this.root.id='navigation-debug';this.root.open=open;
    this.root.style.cssText='position:fixed;left:18px;bottom:30px;width:min(370px,calc(100vw - 36px));max-height:55vh;overflow:auto;background:#fffffff2;border:1px solid #9fb8b5;border-radius:8px;padding:10px;z-index:5;font:12px system-ui;color:#173d43;box-sizing:border-box';
    this.root.innerHTML=`<summary style="cursor:pointer;font-weight:bold">感知地图与重规划记录</summary>
      <div style="margin:8px 0"><select aria-label="选择导航记录" style="width:100%"><option value="live">实时地图与当前路线</option></select></div>
      <canvas width="360" height="288" style="width:100%;background:#f8faf8;cursor:crosshair" aria-label="俯视感知地图，点击地图查看观测高度"></canvas>
      <div>红格：判障 · 浅灰格：其他观测 · 紫框：阻挡当前路段<br>蓝线：新/当前路线 · 灰虚线：旧路线 · 黑点：人物</div>
      <label><input type="checkbox" data-truth checked>显示红黄路障初始位置（仅对照）</label>
      <label><input type="checkbox" data-margin>显示43厘米安全范围</label>
      <div data-info style="white-space:pre-wrap;margin-top:6px"></div>
      <div data-cell style="white-space:pre-wrap;margin-top:6px">点击地图上的格子查看原始高度与判障高度。</div>
      <button data-export style="padding:5px;margin:6px 0 0">导出导航记录</button>
      <div style="color:#627878;margin-top:5px">最多保留最近80条事件。原始观测→10厘米网格高度→超过8厘米判障。接触记录仅供对照，不代表重规划原因。</div>`;
    document.body.append(this.root);
    this.canvas=this.root.querySelector('canvas')!;this.select=this.root.querySelector('select')!;
    this.info=this.root.querySelector('[data-info]')!;this.cellInfo=this.root.querySelector('[data-cell]')!;
    this.truth=this.root.querySelector('[data-truth]')!;this.margin=this.root.querySelector('[data-margin]')!;
    this.select.onchange=()=>{this.selectedCell=null;this.lastUpdate=-Infinity;};
    this.canvas.onclick=e=>{
      const r=this.canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*360,y=(e.clientY-r.top)/r.height*288;
      this.selectedCell={x:x/36-5,y:4-y/36};this.lastUpdate=-Infinity;
    };
    this.root.querySelector<HTMLButtonElement>('[data-export]')!.onclick=()=>{
      const e=this.nav.controller.engine;
      const payload={version:2,threshold:BLOCK_HEIGHT,resolution:.1,clearance:CLEARANCE,replanExtraClearanceMax:.12,
        horizontalPolicy:'实际深度观测水平范围，向外保留8厘米表面余量；高程仍按10厘米网格量化。',arrivalRegionRadius:.06,
        replanMarginPolicy:'保留43厘米身体距离；额外余量在起终点附近按可用空间收缩。',
        note:'场景实物轮廓仅用于人工对照；接触记录不表示碰撞触发重规划。',
        current:{time:e.data.time,position:{x:e.data.qpos[0],y:e.data.qpos[1]},path:this.nav.remainingPath(),cells:this.nav.localMap.elevation,planningCells:this.nav.localMap.obstacles},
        sceneReference:this.barriers,events:this.nav.events};
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='navigation-trace.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
  }
  update(now:number){
    if(!this.root.open||now-this.lastUpdate<250)return;this.lastUpdate=now;
    const events=this.nav.events,key=events.map(e=>e.id).join(',');
    if(key!==this.eventKey){
      const selected=this.select.value;this.select.replaceChildren(new Option('实时地图与当前路线','live'));
      for(const e of [...events].reverse())this.select.add(new Option(`#${e.id} · ${e.time.toFixed(1)}秒 · ${this.names[e.kind]??e.kind}`,String(e.id)));
      this.select.value=events.some(e=>String(e.id)===selected)?selected:'live';this.eventKey=key;
    }
    const event=events.find(e=>String(e.id)===this.select.value),d=this.nav.controller.engine.data;
    const position=event?.position??{x:Number(d.qpos[0]),y:Number(d.qpos[1])};
    const cells=event?.cells??this.nav.localMap.elevation,path=event?.newPath??this.nav.remainingPath();
    const blocking=event?.blockingCells??(path[0]?blockingAlong(position,path[0],this.nav.localMap.obstacles):[]);
    this.draw(position,cells,blocking,path,event);
    const latest=events.at(-1);
    this.info.textContent=event?
      `#${event.id} · ${event.time.toFixed(1)}秒 · ${this.names[event.kind]}\n${event.reason}\n人物 (${position.x.toFixed(2)}, ${position.y.toFixed(2)}) · 受阻格 ${blocking.length}\n已知家具：${event.staticBlockers.join('、')||'无'}\n当时非地面接触：${event.contacts.join('、')||'无'}\n累计重规划 ${event.replans} 次`:
      `实时 · ${Number(d.time).toFixed(1)}秒 · 观测格 ${cells.length} · 判障格 ${cells.filter(isBlockingCell).length}\n重规划 ${this.nav.replans} 次 · ${this.nav.status}\n最近事件：${latest?`#${latest.id} ${latest.reason}`:'尚未开始导航'}\n下拉选择事件可回看触发时地图与新旧路线。`;
    const selected=this.selectedCell;
    if(selected){
      const cell=cells.reduce<ElevationCell|undefined>((best,c)=>Math.hypot(c.x-selected.x,c.y-selected.y)<Math.hypot((best?.x??Infinity)-selected.x,(best?.y??Infinity)-selected.y)?c:best,undefined);
      this.cellInfo.textContent=cell&&Math.hypot(cell.x-selected.x,cell.y-selected.y)<.22?this.describe(cell):'此处没有保留的观测格；未观测不等于无障碍。';
    }else this.cellInfo.textContent=blocking.length?`受阻格示例（共${blocking.length}格）：\n${blocking.slice(0,3).map(c=>this.describe(c)).join('\n')}`:'点击地图上的格子查看原始高度与判障高度。';
  }
  private describe(c:ElevationCell){
    return `(${c.x.toFixed(1)}, ${c.y.toFixed(1)}) 原始 ${(c.minObservedZ*100).toFixed(1)}～${(c.maxObservedZ*100).toFixed(1)}厘米 → 地图 ${(c.maxZ*100).toFixed(0)}厘米 · ${isBlockingCell(c)?'判障':'未判障'}`;
  }
  private draw(position:Point,cells:ElevationCell[],blocking:ElevationCell[],path:Point[],event?:NavigationEvent){
    const c=this.canvas.getContext('2d')!,x=(v:number)=>(v+5)*36,y=(v:number)=>(4-v)*36;
    c.clearRect(0,0,360,288);c.lineWidth=1;c.setLineDash([]);
    c.strokeStyle='#dfe5e0';for(let i=0;i<=10;i++){c.beginPath();c.moveTo(i*36,0);c.lineTo(i*36,288);c.stroke();}for(let i=0;i<=8;i++){c.beginPath();c.moveTo(0,i*36);c.lineTo(360,i*36);c.stroke();}
    c.fillStyle='#aab7b2';for(const o of OBSTACLES)c.fillRect(x(o.x-o.w/2),y(o.y+o.d/2),o.w*36,o.d*36);
    if(this.margin.checked){c.fillStyle='#de64551c';for(const o of cells.filter(isBlockingCell))c.fillRect(x(o.x-o.w/2-CLEARANCE),y(o.y+o.d/2+CLEARANCE),(o.w+2*CLEARANCE)*36,(o.d+2*CLEARANCE)*36);}
    for(const o of cells){c.fillStyle=isBlockingCell(o)?'#db4c36':'#d0d4d1';c.fillRect(x(o.x-.05),y(o.y+.05),3.6,3.6);}
    if(this.truth.checked){c.setLineDash([3,2]);c.lineWidth=2;for(const o of this.barriers){
      // Initial placement is reference-only, including after removal.
      c.strokeStyle=o.name==='test_barrier_lower'?'#b78700':'#e26b19';c.strokeRect(x(o.x-o.w/2),y(o.y+o.d/2),o.w*36,o.d*36);
      c.fillStyle=c.strokeStyle;c.font='11px sans-serif';c.fillText(o.name==='test_barrier_lower'?'黄':'红',x(o.x-o.w/2),y(o.y+o.d/2)-3);
    }c.setLineDash([]);}
    c.strokeStyle='#972ac4';c.lineWidth=1.5;for(const o of blocking)c.strokeRect(x(o.x-.07),y(o.y+.07),5,5);
    const line=(points:Point[],color:string,dashed=false)=>{if(!points.length)return;c.strokeStyle=color;c.lineWidth=2;c.setLineDash(dashed?[5,3]:[]);c.beginPath();c.moveTo(x(position.x),y(position.y));for(const p of points)c.lineTo(x(p.x),y(p.y));c.stroke();c.setLineDash([]);};
    if(event)line(event.oldPath,'#777',true);line(path,'#0667db');
    c.fillStyle='#162f35';c.beginPath();c.arc(x(position.x),y(position.y),4,0,Math.PI*2);c.fill();
    if(this.selectedCell){c.strokeStyle='#111';c.strokeRect(x(this.selectedCell.x)-5,y(this.selectedCell.y)-5,10,10);}
  }
  dispose(){this.root.remove();}
}
