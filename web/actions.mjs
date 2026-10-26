// Only use the public window.human API. Completion is measured by the controller.
export function navigationSummary(state) {
  const nav=state?.navigation;if(!nav)return null;
  return {status:nav.status,target:nav.target,location:nav.location,distance:nav.distance,
    replans:nav.replans??0,planningAttempts:nav.planningAttempts??0,blockedTime:nav.blockedTime??0,
    obstaclePhase:nav.obstaclePhase??'none',obstacleSource:nav.obstacleSource??'',failureCode:nav.failureCode??'',
    lastPlanningError:nav.lastPlanningError??'',unavailable_targets:nav.unavailable_targets??[],retryable_targets:nav.retryable_targets??[]};
}
export function mapAction(action, target) {
  if (action === "wave") return "raise_right_arm";
  if (action === "look_at" && target === "robot") return "turn_head_left";
  if (action === "look_at" && target === "help_desk") return "turn_head_right";
  if (action === 'take' || action === 'hand_over') return 'bend_left_elbow';
  if (action === 'nod') return 'nod_head';
  if (action === 'shake_head') return 'turn_head_left';
  if (action === 'point_to') return 'raise_right_arm';
  return null;
}

export class ActionRunner {
  constructor(getHuman, feedback) {
    this.getHuman = getHuman;
    this.feedback = feedback;
    this.active = null;
  }
  finish(status, message) {
    const command = this.active;
    this.active = null;
    const state=this.getHuman()===this.owner?this.owner?.getState():null;
    const navigation=command?.action==='walk_to'?navigationSummary(state):null;
    if (command) this.feedback({type: "action_feedback", id: command.id,
      action: command.action, status, message,...(navigation?{target:command.target,time:state.time,
        reason:status==='completed'?'arrived':navigation.failureCode||(status==='interrupted'?'interrupted':'execution_failed'),navigation}:{})});
  }
  execute(command) {
    if (command.action === "wait") return; // Speech must not cancel a running gesture.
    if(this.active)this.getHuman()?.cancelAction?.();
    this.finish("interrupted", "被新动作替换");
    this.active = command;
    const human = this.getHuman();
    if (command.action === 'walk_to' && human?.navigate) {
      this.owner=human;this.started=human.getState().time;this.mapped='navigation';
      this.progressKey='moving:0';this.progressSeq=0;
      if(!human.navigate(command.target))this.finish('failed',human.getState().navigation?.error||'导航无法启动');
      return;
    }
    if(human?.getState().navigation?.status==='running')human.stopNavigation?.();
    if(human?.performAction){
      this.owner=human;this.started=human.getState().time;this.mapped='skill';
      try{if(!human.performAction(command))this.finish('failed',human.getState().actionResult?.error||'人物控制器拒绝动作');}
      catch(e){this.finish('failed',String(e));}
      return;
    }
    const mapped = mapAction(command.action, command.target);
    if (!mapped) return this.finish("failed", "当前身体不支持此动作；支持物理 walk_to、wait、wave、look_at robot/help_desk、nod、shake_head、take、hand_over");
    if (!human) return this.finish("failed", "人物尚未就绪或已重新加载");
    this.owner = human;
    this.started = human.getState().time;
    this.mapped = mapped;
    try {
      if (!human.executeAction({action: mapped, duration: 2, source: "bank_agent"}))
        this.finish("failed", "人物控制器拒绝动作，请确认自由站立且未在抓杯");
    } catch (e) { this.finish("failed", String(e)); }
  }
  tick() {
    if (!this.active) return;
    const human = this.getHuman();
    if (human !== this.owner) return this.finish("failed", "人物被重新加载");
    const state = human.getState();
    if(this.mapped==='skill'){
      const result=state.actionResult;
      if(!result||result.id!==this.active.id||state.time<this.started)return this.finish('interrupted','动作已被替换或物理状态已重置');
      if(['completed','failed','interrupted'].includes(result.status))return this.finish(result.status,result.error||'动作已完成并稳定');
      if(state.time-this.started>35){human.cancelAction?.();this.finish('failed','动作超过 35 秒仿真时间仍未完成');}
      return;
    }
    if(this.mapped==='navigation'){
      const nav=state.navigation;
      if(!nav||['failed','interrupted'].includes(nav.status))return this.finish('failed',nav?.error||'导航状态丢失');
      if(nav.status==='completed'&&nav.location===this.active.target&&nav.distance<.08&&state.locomotion?.settled)
        return this.finish('completed',`你已经走到 ${nav.location} 并站稳。`);
      if(nav.status==='running'){
        const phase=nav.obstaclePhase==='braking'?'blocked':nav.obstaclePhase==='waiting'?'replanning':'moving';
        const key=`${phase}:${nav.replans??0}`;
        if(key!==this.progressKey){this.progressKey=key;this.feedback({type:'action_progress',id:this.active.id,
          action:'walk_to',target:this.active.target,seq:++this.progressSeq,time:state.time,phase,navigation:navigationSummary(state)});}
      }
      return;
    }
    if (state.time < this.started || state.status === "idle")
      return this.finish("interrupted", "物理状态被重置");
    if (state.status === "failed" || state.locomotion?.mode === "fallen")
      return this.finish("failed", "动作未稳定或人物跌倒，请查看人物面板并重置");
    if (state.status === "completed") {
      // Guard against manual commands taking over the same global status.
      const name = this.mapped === 'bend_left_elbow' ? 'left_elbow' : this.mapped === 'nod_head' ? 'neck_pitch' : this.mapped === "raise_right_arm" ? "right_shoulder" : "neck_yaw";
      const target = this.mapped === 'bend_left_elbow' ? 1.7 : this.mapped === 'nod_head' ? .35 : this.mapped === "raise_right_arm" ? 1.9 : this.mapped === "turn_head_left" ? 0.7 : -0.7;
      const joint = state.joints.find(j => j.name === name);
      if (joint && Math.abs(joint.actual - target) < 0.14 && Math.abs(joint.velocity) < 0.12)
        this.finish("completed", "动作已达到目标并稳定");
      else this.finish("failed", "动作被手动操作覆盖，或实际关节未达到目标");
    } else if (state.time - this.started > 12) this.finish("failed", "动作超过 12 秒仿真时间仍未完成");
  }
  clear() { this.getHuman()?.stopNavigation?.();this.getHuman()?.cancelAction?.();this.active = null; }
}
