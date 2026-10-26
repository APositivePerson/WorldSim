import * as T from 'three';

export class BankEnvironment {
  readonly group = new T.Group();
  readonly robot = new T.Group();
  private customerLabel:T.Object3D;
  private screen = new T.MeshStandardMaterial({color:0x123c46,emissive:0x043c42,emissiveIntensity:.5});
  private textures: T.Texture[] = [];
  constructor(scene:T.Scene) {
    scene.add(this.group);
    const box=(x:number,y:number,z:number,w:number,d:number,h:number,color:number,parent=this.group)=>{
      const m=new T.Mesh(new T.BoxGeometry(w,d,h),new T.MeshStandardMaterial({color,roughness:.72}));
      m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
    };
    box(0,0,-.07,10,8,.12,0xe6e7de);
    for(let x=-5;x<=5;x++)box(x,0,-.003,.012,8,.004,0xcdd4ca);
    for(let y=-4;y<=4;y++)box(0,y,-.003,10,.012,.004,0xcdd4ca);
    box(0,3.8,1.5,10,.16,3,0xf3efe5);
    box(-4.9,0,.22,.16,7.6,.44,0xf3efe5);
    box(0,3.69,.24,9.8,.05,.48,0x24594f);
    box(-4.8,0,.24,.05,7.6,.48,0x24594f);
    this.label('示例银行  /  BANK',0,3.65,2.55,3.5,.55,0x164f48);
    this.label('综合业务',-2.2,2.9,1.95,1.4,.3);
    for(let i=0;i<2;i++) {
      const x=-3.25+i*1.65;
      box(x,2.4,.48,1.5,.75,.96,0xdfd1b8);
      box(x,2.4,1,1.62,.85,.08,0x1d6258);
      box(x,2.5,1.23,.48,.07,.32,0x243b40);
      box(x,2.5,1.05,.06,.1,.24,0x455854);
      this.label(`${i+1} 号柜台`,x,2.0,1.58,1,.3);
    }
    // Consultation desk is off the customer's physical footprint.
    box(1.7,-.3,.45,1.45,.7,.9,0xe3d3b6);
    box(1.7,-.3,.94,1.55,.8,.09,0x176b62);
    this.label('咨询服务',1.7,-.72,.61,1.1,.28);
    this.customerLabel=this.label('顾客',0,-2.8,2.05,.55,.2);
    // Waiting chairs and a small table.
    for(let i=0;i<3;i++) {
      const y=.6+i*.85;
      box(3.7,y,.46,.65,.65,.12,0x467c72);
      box(3.99,y,.78,.12,.65,.6,0x467c72);
      for(const dx of [-.22,.22])for(const dy of [-.22,.22])box(3.7+dx,y+dy,.22,.04,.04,.4,0x66716a);
    }
    this.label('等候区',3.7,2.6,1.6,1.1,.3);
    // Ticket kiosk and ATM.
    box(-3.6,-1.7,.65,.55,.5,1.3,0xf8f8ef);
    box(-3.6,-1.97,1.03,.4,.04,.35,0x245d67);
    this.label('取号机',-3.6,-1.7,1.65,.9,.28);
    box(-4.35,.4,1,.7,.8,2,0x2b7168);
    box(-3.98,.4,1.25,.04,.5,.4,0x173c46);
    this.label('ATM',-4.1,.4,2.25,.75,.28);
    // Open entrance indication and floor path.
    this.label('入口 / 出口',-.9,-3.5,.28,1.4,.25);
    for(let y=-3.1;y<-.8;y+=.48)box(0,y,.004,.08,.22,.008,0xb5bda5);
    // Planters.
    for(const [x,y] of [[4.2,-2.7],[-4,3.1]]) {
      box(x,y,.23,.4,.4,.46,0xc5b493);
      for(let i=0;i<5;i++){
        const leaf=new T.Mesh(new T.SphereGeometry(.22,12,10),new T.MeshStandardMaterial({color:i%2?0x4b7c55:0x658b59}));
        leaf.scale.set(.6,.6,2.2);leaf.position.set(x+Math.sin(i*2)*.13,y+Math.cos(i*2)*.13,.7+i*.035);this.group.add(leaf);
      }
    }
    this.group.add(this.robot);this.robot.position.set(1.2,-1.45,0);
    this.robot.rotation.z=Math.atan2(-1.2,-1.45);
    box(0,0,.15,.55,.5,.26,0x263b3c,this.robot);
    box(0,0,.68,.43,.38,.95,0xf2f6ee,this.robot);
    box(0,0,1.36,.58,.35,.42,0xf2f6ee,this.robot);
    const face=new T.Mesh(new T.BoxGeometry(.48,.02,.26),this.screen);face.position.set(0,-.19,1.38);this.robot.add(face);
    for(const x of [-.13,.13]) {
      const eye=new T.Mesh(new T.SphereGeometry(.035,16,12),new T.MeshBasicMaterial({color:0x78ede0}));
      eye.position.set(x,-.21,1.4);this.robot.add(eye);
    }
    box(-.29,0,.8,.11,.14,.48,0x17857b,this.robot);box(.29,0,.8,.11,.14,.48,0x17857b,this.robot);
    this.label('服务机器人',1.2,-1.45,1.95,1,.23);
  }
  private label(text:string,x:number,y:number,z:number,w:number,h:number,color=0x21574f) {
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=160;
    const c=canvas.getContext('2d')!;
    c.fillStyle='#ffffff';c.fillRect(0,0,768,160);
    c.fillStyle=`#${color.toString(16).padStart(6,'0')}`;c.font='bold 58px "Microsoft YaHei", sans-serif';
    c.textAlign='center';c.textBaseline='middle';c.fillText(text,384,80,730);
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;this.textures.push(texture);
    const sign=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide}));
    sign.rotation.x=Math.PI/2;sign.position.set(x,y,z);this.group.add(sign);
    return sign;
  }
  updateCustomer(x:number,y:number){this.customerLabel.position.set(x,y,2.05);}
  speaking(who:string|null) { this.screen.emissiveIntensity=who==='robot'?2:.5; }
  dispose() { this.textures.forEach(t=>t.dispose()); }
}
