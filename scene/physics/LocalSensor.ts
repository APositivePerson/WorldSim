import type {MuJoCoEngine} from '../../character/src/physics/MuJoCoEngine';
import type {Obstacle} from '../BankLayout';

const RANGE=3,RESOLUTION=.1;
export type DepthRay={dx:number;dy:number;dz:number;distance:number;hit:boolean};
export type DepthFrame={origin:{x:number;y:number;z:number};yaw:number;rays:DepthRay[];range:number;
  grid?:{hMin:number;hStep:number;hCount:number;vMin:number;vStep:number;vCount:number}};
export type ElevationCell=Obstacle&{minZ:number;maxZ:number;minObservedZ:number;maxObservedZ:number;
  minObservedX:number;maxObservedX:number;minObservedY:number;maxObservedY:number;points:number};
export const BLOCK_HEIGHT=.08,MAX_BODY_HEIGHT=1.9;
export const isBlockingCell=(c:ElevationCell)=>c.maxZ>BLOCK_HEIGHT&&c.minZ<MAX_BODY_HEIGHT;

function intersectBox(e:MuJoCoEngine,g:number,origin:number[],direction:number[]){
  const p=e.data.geom_xpos,m=e.data.geom_xmat,s=e.model.geom_size;
  const offset=[origin[0]-p[3*g],origin[1]-p[3*g+1],origin[2]-p[3*g+2]];
  let near=0,far=RANGE;
  for(let axis=0;axis<3;axis++){
    const o=offset[0]*m[9*g+axis]+offset[1]*m[9*g+3+axis]+offset[2]*m[9*g+6+axis];
    const d=direction[0]*m[9*g+axis]+direction[1]*m[9*g+3+axis]+direction[2]*m[9*g+6+axis];
    const half=s[3*g+axis];
    if(Math.abs(d)<1e-9){if(Math.abs(o)>half)return Infinity;}
    else {
      const a=(-half-o)/d,b=(half-o)/d;
      near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));
      if(far<near)return Infinity;
    }
  }
  return near;
}

/** Head-mounted depth image generated from collision geometry.
 * Only first-surface ranges cross this boundary; no object ids or hidden shape. */
export function captureDepth(e:MuJoCoEngine,yaw:number):DepthFrame{
  let x=Number(e.data.qpos[0]),y=Number(e.data.qpos[1]),z=1.65,heading=yaw;
  const head=e.mj?.mj_name2id?.(e.model,1,'head')??-1;
  if(head>=0){
    const b=9*head,p=3*head,forwardX=-Number(e.data.xmat[b+1]),forwardY=-Number(e.data.xmat[b+4]);
    x=Number(e.data.xpos[p]);y=Number(e.data.xpos[p+1]);z=Number(e.data.xpos[p+2]+.07);
    heading=Math.atan2(forwardX,-forwardY);
  }
  const origin={x:x+Math.sin(heading)*.14,y:y-Math.cos(heading)*.14,z};
  const rays:DepthRay[]=[];
  for(let v=-60;v<=15;v+=5)for(let h=-60;h<=60;h+=3){
    const azimuth=heading+h*Math.PI/180,elevation=v*Math.PI/180,flat=Math.cos(elevation);
    const direction=[Math.sin(azimuth)*flat,-Math.cos(azimuth)*flat,Math.sin(elevation)];
    let distance=RANGE,hit=false;
    for(let g=0;g<e.model.ngeom;g++){
      if(e.model.geom_type[g]!==6||e.isHumanBody(e.model.geom_bodyid[g])||
        !(e.model.geom_contype[g]||e.model.geom_conaffinity[g]))continue;
      const value=intersectBox(e,g,[origin.x,origin.y,origin.z],direction);
      if(value<distance){distance=value;hit=true;}
    }
    rays.push({dx:direction[0],dy:direction[1],dz:direction[2],distance,hit});
  }
  return {origin,yaw:heading,rays,range:RANGE,grid:{hMin:-60,hStep:3,hCount:41,vMin:-60,vStep:5,vCount:16}};
}

type Voxel={x:number;y:number;z:number;observedX:number;observedY:number;observedZ:number};
const rounded=(value:number)=>Math.round(value/RESOLUTION)*RESOLUTION;
const key=(x:number,y:number,z:number)=>`${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;

/** Sparse 3D occupancy fused from depth frames, with a 2.5D elevation view.
 * Free rays clear old voxels; space outside the current view is retained. */
export class ElevationMap{
  private voxels=new Map<string,Voxel>();
  update(frame:DepthFrame){
    // Project previous surface observations into the current depth pixels. Line
    // carving alone misses old voxels when head sway shifts sparse sample rays.
    // Clear only in-view points with a newly observed farther surface/free range.
    const grid=frame.grid;
    if(grid)for(const [id,voxel] of this.voxels){
      const dx=voxel.observedX-frame.origin.x,dy=voxel.observedY-frame.origin.y,dz=voxel.observedZ-frame.origin.z;
      const range=Math.hypot(dx,dy,dz);if(range<.15||range>=frame.range-.12)continue;
      const h=Math.atan2(Math.sin(Math.atan2(dx,-dy)-frame.yaw),Math.cos(Math.atan2(dx,-dy)-frame.yaw))*180/Math.PI;
      const v=Math.asin(dz/range)*180/Math.PI;
      const hi=Math.round((h-grid.hMin)/grid.hStep),vi=Math.round((v-grid.vMin)/grid.vStep);
      if(hi<0||hi>=grid.hCount||vi<0||vi>=grid.vCount)continue;
      const ray=frame.rays[vi*grid.hCount+hi];
      if(ray&&ray.distance>range+.12)this.voxels.delete(id);
    }
    for(const ray of frame.rays){
      const clearTo=Math.max(0,ray.distance-.12);
      for(let d=.15;d<clearTo;d+=.08){
        const x=rounded(frame.origin.x+ray.dx*d),y=rounded(frame.origin.y+ray.dy*d);
        const z=rounded(frame.origin.z+ray.dz*d);
        this.voxels.delete(key(x,y,z));
      }
      if(!ray.hit)continue;
      const observedX=frame.origin.x+ray.dx*ray.distance,observedY=frame.origin.y+ray.dy*ray.distance;
      const x=rounded(observedX),y=rounded(observedY);
      const observedZ=frame.origin.z+ray.dz*ray.distance,z=rounded(observedZ);
      if(z>.04&&z<2.05)this.voxels.set(key(x,y,z),{x,y,z,observedX,observedY,observedZ});
    }
  }
  get elevation(){
    const columns=new Map<string,ElevationCell>();
    for(const voxel of this.voxels.values()){
      const k=`${voxel.x.toFixed(1)},${voxel.y.toFixed(1)}`,cell=columns.get(k);
      if(cell){cell.minZ=Math.min(cell.minZ,voxel.z);cell.maxZ=Math.max(cell.maxZ,voxel.z);cell.minObservedZ=Math.min(cell.minObservedZ,voxel.observedZ);cell.maxObservedZ=Math.max(cell.maxObservedZ,voxel.observedZ);
        cell.minObservedX=Math.min(cell.minObservedX,voxel.observedX);cell.maxObservedX=Math.max(cell.maxObservedX,voxel.observedX);
        cell.minObservedY=Math.min(cell.minObservedY,voxel.observedY);cell.maxObservedY=Math.max(cell.maxObservedY,voxel.observedY);cell.points++;}
      else columns.set(k,{x:voxel.x,y:voxel.y,w:.16,d:.16,minZ:voxel.z,maxZ:voxel.z,minObservedZ:voxel.observedZ,maxObservedZ:voxel.observedZ,
        minObservedX:voxel.observedX,maxObservedX:voxel.observedX,minObservedY:voxel.observedY,maxObservedY:voxel.observedY,points:1});
    }
    return [...columns.values()];
  }
  // Current body has no step-over skill, so objects above 8 cm block walking.
  get obstacles(){return this.elevation.filter(isBlockingCell).map(cell=>({...cell,
    // Preserve the 8 cm surface padding on every observed point, without adding
    // another half grid cell through horizontal rounding. Heights stay quantized.
    x:(cell.minObservedX+cell.maxObservedX)/2,y:(cell.minObservedY+cell.maxObservedY)/2,
    w:cell.maxObservedX-cell.minObservedX+.16,d:cell.maxObservedY-cell.minObservedY+.16}));}
  get voxelCount(){return this.voxels.size;}
}
