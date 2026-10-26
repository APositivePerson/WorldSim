import type {Sole} from './SensoryInterface';
export type ContactPhase='swing'|'heel'|'flat'|'forefoot'|'uncertain';
/** Load hysteresis and temporal evidence; receives delivered sole signals only. */
export class ContactEstimator {
  readonly feet=[0,1].map(()=>({contact:false,phase:'uncertain' as ContactPhase,confidence:0,touchdowns:0}));
  private pending=[0,0];
  private last=-1;
  reset(){this.last=-1;this.pending.fill(0);this.feet.forEach(f=>Object.assign(f,{contact:false,phase:'uncertain',confidence:0,touchdowns:0}));}
  update(soles:Sole[]|undefined,sampledAt:number,weight:number){
    if(!soles){this.feet.forEach(f=>{f.contact=false;f.phase='uncertain';f.confidence=0;});this.pending.fill(0);return;}
    if(sampledAt<=this.last)return;
    const dt=this.last<0?.01:Math.min(.04,sampledAt-this.last);this.last=sampledAt;
    soles.forEach((s,i)=>{
      const f=this.feet[i],candidate=s.force>weight*(f.contact?.012:.025);
      this.pending[i]=candidate!==f.contact?this.pending[i]+dt:0;
      if(this.pending[i]>=.009){f.contact=candidate;this.pending[i]=0;if(candidate)f.touchdowns++;}
      f.confidence=Math.max(0,Math.min(1,s.force/(weight*.12)));
      const rear=s.pads[0]+s.pads[1],front=s.pads[2]+s.pads[3];
      f.phase=!f.contact?'swing':rear>weight*.025&&front>weight*.025?'flat':rear>front?'heel':'forefoot';
    });
  }
}
