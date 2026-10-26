import * as T from 'three';
import {HumanRenderer} from '../character/src/rendering/HumanRenderer';

/** Physical eyes supply rotation. The avatar bind pose supplies its own eye
 * sockets, which differ between the procedural head and the scanned head. */
export class BankHumanRenderer extends HumanRenderer {
  private eyeAnchors:{bone:T.Bone;position:T.Vector3}[]=[];
  override async loadSkin(source:string|ArrayBuffer){
    await super.loadSkin(source);
    this.eyeAnchors=[];
    this.avatar?.scene.traverse(object=>{
      if(!(object instanceof T.SkinnedMesh))return;
      const {bones,boneInverses}=object.skeleton;
      for(const name of ['left_eye','right_eye']){
        const i=bones.findIndex(b=>b.name===name);if(i<0)continue;
        const bone=bones[i],parent=bones.indexOf(bone.parent as T.Bone);
        if(parent<0||this.eyeAnchors.some(a=>a.bone===bone))continue;
        const local=new T.Matrix4().copy(boneInverses[parent]).multiply(new T.Matrix4().copy(boneInverses[i]).invert());
        this.eyeAnchors.push({bone,position:new T.Vector3().setFromMatrixPosition(local)});
      }
    });
    this.sync();
  }
  override sync(){
    super.sync();
    for(const anchor of this.eyeAnchors??[])anchor.bone.position.copy(anchor.position);
    this.avatar?.group.updateMatrixWorld(true);
  }
}
