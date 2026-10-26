import type {Navigator} from './physics/Navigator';
import scene from '../scenarios/bank/scene.json';
import {DESTINATIONS} from './BankLayout';
// 取号地点、等候地点、叫号柜台都来自场景文件的 workflow；3D 里只叫能走到的柜台
const flow=scene.workflow,counter=flow.service_places.find(p=>p in DESTINATIONS)!,WAIT_SECONDS=16;
export class BankWorkflow {
  ticket:string|null=null;called_counter:string|null=null;private waited=0;private serial=0;
  private events:{type:string;content:string;time:number}[]=[];
  constructor(readonly navigation:Navigator){}
  take(time:number){
    const where=DESTINATIONS[flow.ticket_place].label,wait=DESTINATIONS[flow.waiting_place].label;
    if(this.navigation.location!==flow.ticket_place||!this.navigation.controller.locomotion.settled)return {ok:false,message:`你还没有在${where}前站稳，不能取号。`};
    if(this.ticket)return {ok:true,message:`你已经取到了 ${this.ticket}，请去${wait}等叫号。`};
    this.ticket=`${flow.ticket_prefix}${String(++this.serial).padStart(3,'0')}`;this.waited=0;this.called_counter=null;
    return {ok:true,message:`你从${where}取到了号码 ${this.ticket}，前面还有 ${flow.people_ahead} 人，请走到${wait}等待叫号。`};
  }
  update(dt:number,time:number){
    if(!this.ticket||this.called_counter||this.navigation.location!==flow.waiting_place||!this.navigation.controller.locomotion.settled)return;
    this.waited+=dt;if(this.waited>=WAIT_SECONDS){this.called_counter=counter;this.events.push({type:'broadcast',content:`请 ${this.ticket} 号顾客到${DESTINATIONS[counter].label}办理业务。`,time});}
  }
  drain(){const result=this.events;this.events=[];return result;}
  state(){return {ticket:this.ticket,called_counter:this.called_counter,waiting_seconds:Math.max(0,WAIT_SECONDS-this.waited)};}
}
