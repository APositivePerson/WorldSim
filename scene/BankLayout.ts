// 地点站位和障碍物都来自场景文件 scenarios/<场景>/scene.json（构建时打包进来），这里不再写死。
// 只有写了 pose3d 的地点才能在 3D 场景里走过去（例如银行场景没有 3 号柜台）。
import scene from '../scenarios/bank/scene.json';
export type Destination={x:number;y:number;yaw:number;label:string};
type Place={label:string;pose3d?:number[]};
export const SCENE_ID:string=scene.id;
export const DESTINATIONS:Record<string,Destination>=Object.fromEntries(
  Object.entries(scene.places as Record<string,Place>).filter(([,p])=>p.pose3d)
    .map(([key,p])=>[key,{x:p.pose3d![0],y:p.pose3d![1],yaw:p.pose3d![2],label:p.label.split('（')[0]}]));
export const START:string=scene.start;
/** 3D 身体实际能去的地点、能看的目标，在 hello 里声明给大脑。 */
export const LOOK_TARGETS=['robot','help_desk'];
// Conservative solid collision envelopes; dimensions enclose visible furniture.
export const OBSTACLES:{name:string;x:number;y:number;w:number;d:number;h:number}[]=scene.obstacles3d;
export function bankModel(xml:string,extra:typeof OBSTACLES=[]){
  const geoms=[...OBSTACLES,...extra].map(o=>`<geom name="bank_${o.name}" type="box" pos="${o.x} ${o.y} ${o.h/2}" size="${o.w/2} ${o.d/2} ${o.h/2}" rgba="0.3 0.5 0.4 1"/>`).join('\n');
  return xml.replace('<worldbody>','<worldbody>\n'+geoms)
    .replace(/(<key name="stand" qpos=")[^ ]+ [^ ]+ /,(_,prefix)=>prefix+`${DESTINATIONS[START].x} ${DESTINATIONS[START].y} `);
}
export type Point={x:number;y:number};
export const CLEARANCE=.43;
export type Obstacle={x:number;y:number;w:number;d:number};
/** Extra comfort margin must not invalidate an endpoint that satisfies body clearance. */
export function planningObstacles<T extends Obstacle>(obstacles:T[],start:Point,end:Point):T[]{
  return obstacles.map(o=>{
    const room=(p:Point)=>Math.max(Math.abs(p.x-o.x)-o.w/2-CLEARANCE,Math.abs(p.y-o.y)-o.d/2-CLEARANCE);
    const padding=Math.max(0,Math.min(.12,room(start)-.02,room(end)-.02));
    return {...o,w:o.w+2*padding,d:o.d+2*padding};
  });
}
/** Diagnostic counterpart of segmentFree: identical samples and body clearance. */
export function blockingAlong<T extends Obstacle>(a:Point,b:Point,obstacles:T[]):T[]{
  const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.04));
  return obstacles.filter(o=>{
    for(let i=0;i<=n;i++)if(Math.abs(a.x+(b.x-a.x)*i/n-o.x)<o.w/2+CLEARANCE&&Math.abs(a.y+(b.y-a.y)*i/n-o.y)<o.d/2+CLEARANCE)return true;
    return false;
  });
}
export function free(p:Point,extra:Obstacle[]=[]){return p.x>-4.45&&p.x<4.5&&p.y>-3.5&&p.y<3.3&&![...OBSTACLES,...extra].some(o=>Math.abs(p.x-o.x)<o.w/2+CLEARANCE&&Math.abs(p.y-o.y)<o.d/2+CLEARANCE);}
export function segmentFree(a:Point,b:Point,extra:Obstacle[]=[]){const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.04));for(let i=0;i<=n;i++)if(!free({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n},extra))return false;return true;}
/** A bank destination is an arrival region (8 cm), not a mathematical point.
 * A quantized observed surface can exclude the exact point while a point 2 cm
 * away remains safe. Keep all obstacle clearance checks and a 2 cm arrival buffer. */
export function planDestination(start:Point,goal:Point,extra:Obstacle[]=[]):Point[]{
  if(!free(start,extra))throw Error('起点位于障碍物安全范围内');
  const clearance=(p:Point)=>Math.min(...[...OBSTACLES,...extra].map(o=>Math.max(
    Math.abs(p.x-o.x)-o.w/2-CLEARANCE,Math.abs(p.y-o.y)-o.d/2-CLEARANCE)));
  if(free(goal,extra)&&clearance(goal)>=.06)return planPath(start,goal,planningObstacles(extra,start,goal));
  const candidates:Point[]=[goal];
  for(const radius of [.02,.04,.06])for(let i=0;i<16;i++){
    const angle=i*Math.PI/8;candidates.push({x:goal.x+radius*Math.cos(angle),y:goal.y+radius*Math.sin(angle)});
  }
  // Prefer space for natural root sway, rather than the first barely-free point.
  candidates.sort((a,b)=>clearance(b)-clearance(a));
  for(const end of candidates){
    if(!free(end,extra))continue;
    try{return planPath(start,end,planningObstacles(extra,start,end));}catch{/* Try another safe point in the same arrival region. */}
  }
  throw Error('目标到达区域内没有安全落点');
}
export function planPath(start:Point,end:Point,extra:Obstacle[]=[]):Point[]{
  if(!free(start,extra)||!free(end,extra))throw Error('起点或终点位于障碍物安全范围内');
  if(segmentFree(start,end,extra))return [{...end}];
  const step=.2,key=(x:number,y:number)=>`${x},${y}`,point=(x:number,y:number)=>({x:x*step,y:y*step});
  const sx=Math.round(start.x/step),sy=Math.round(start.y/step);
  // The nearest rounded grid cell can be inside clearance even when the actual
  // stopped position is safe. Seed every nearby visible cell from the real pose.
  const open:{x:number;y:number;g:number}[]=[],cost=new Map<string,number>(),parent=new Map<string,string>();
  for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
    const x=sx+dx,y=sy+dy,p=point(x,y);
    if(segmentFree(start,p,extra)){const g=Math.hypot(p.x-start.x,p.y-start.y);open.push({x,y,g});cost.set(key(x,y),g);}
  }
  let finish='';
  for(let count=0;open.length&&count<4000;count++){
    open.sort((a,b)=>a.g+Math.hypot(a.x*step-end.x,a.y*step-end.y)-b.g-Math.hypot(b.x*step-end.x,b.y*step-end.y));
    const node=open.shift()!,p=point(node.x,node.y),k=key(node.x,node.y);
    if(node.g>cost.get(k)!)continue;
    if(Math.hypot(p.x-end.x,p.y-end.y)<.3&&segmentFree(p,end,extra)){finish=k;break;}
    for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const x=node.x+dx,y=node.y+dy,q=point(x,y),nk=key(x,y),g=node.g+step*Math.hypot(dx,dy);
      if(!segmentFree(p,q,extra)||g>=(cost.get(nk)??Infinity))continue;cost.set(nk,g);parent.set(nk,k);open.push({x,y,g});
    }
  }
  if(!finish)throw Error('没有可通过的银行通道');
  const raw:Point[]=[end];for(let k=finish;k;k=parent.get(k)??''){const [x,y]=k.split(',').map(Number);raw.unshift(point(x,y));}
  raw.unshift(start);const path:Point[]=[];let i=0;
  while(i<raw.length-1){let j=raw.length-1;while(j>i+1&&!segmentFree(raw[i],raw[j],extra))j--;if(!segmentFree(raw[i],raw[j],extra))throw Error('起点无法安全连接通道');path.push(raw[j]);i=j;}
  return path;
}
