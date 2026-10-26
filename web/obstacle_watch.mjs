/** Visual suspicion can request a physical stop, never manufacture arrival. */
export class ObstacleWatch {
  constructor(getHuman,getCommand,observe,notify=()=>{}){
    Object.assign(this,{getHuman,getCommand,observe,notify});
    this.busy=false;this.lastTime=-Infinity;this.lastWall=-Infinity;this.command=null;
  }
  async tick(enabled,paused=false){
    const body=this.getHuman(),cmd=this.getCommand(),state=body?.getState();
    if(!enabled||paused||this.busy||!body?.reportVisualObstacle||cmd?.action!=='walk_to'||
      state?.navigation?.status!=='running'||state.navigation.obstaclePhase!=='none')return;
    const loco=state.locomotion,goal=loco?.goal,p=loco?.pelvis;
    if(!goal||!p)return;
    const heading=Math.atan2(goal.x-p[0],-(goal.y-p[1]));
    if(Math.abs(Math.atan2(Math.sin(heading-loco.yaw),Math.cos(heading-loco.yaw)))>.25)return;
    if(this.command!==cmd){this.command=cmd;this.lastTime=-Infinity;}
    if(state.time-this.lastTime<5||Date.now()-this.lastWall<3000)return;
    this.busy=true;this.lastTime=state.time;this.lastWall=Date.now();
    const current=()=>this.getHuman()===body&&this.getCommand()===cmd&&
      body.getState().navigation?.status==='running'&&body.getState().navigation.obstaclePhase==='none';
    try{
      const visual=await this.observe(cmd.id,'during_navigation',current);
      if(!current()||!visual)return;
      if(visual.observation.path_obstacle==='suspected'){
        const stopped=body.reportVisualObstacle();
        this.notify(stopped?'视觉怀疑前方受阻，局部地图确认：正在停稳重规划':'视觉怀疑受阻，但局部地图未确认，继续观察');
      }
    }finally{this.busy=false;}
  }
}
