# Human Dynamics Lab

浏览器内运行的自由站立、慢速步行与可交互人体动力学系统。React + TypeScript + Vite、Three.js，以及 Google DeepMind 官方 **`@mujoco/mujoco@3.16.0` 单线程 WebAssembly**。全部物理计算在浏览器中完成。

## 运行与操作

本机已接入 Renderpeople 的真人扫描角色 **Eric**。本地扫描资产存在时默认显示该角色，也可在「内置人物」选择程序人物 V2；用 `?avatar=procedural` 可直接打开 V2。

扫描外观包含原始人物网格、摄影颜色、法线和由光泽转换的粗糙度贴图，原图 8K、运行时 4K。运行骨架共 99 根，匹配原有 51 根物理骨骼，并保留手指、眼睛和面部辅助控制。皮肤散射使用厚度权重的实时近似；厚度图是制作的效果权重，不是扫描测得的数据。人物穿着衬衫和马
网格已按现有仿真骨架重新拟合，适合真人外观和动作展示，**不代表标定过的人体尺寸、医学精度或内部解剖结构**。站立、脸部、眨眼及抓杯复查图位于本机 `artifacts/scanned-private/review/`。

扫描资产使用供应商独立许可，不能套用程序模型的 CC0 声明。原始文件和派生 GLB 均放在被忽略的 `artifacts/scanned-private/`，仅由本地 Vite 开发/预览服务提供，不复制到 `public/` 或 `dist/`。静态部署自动使用程序人物；发布扫描版之前须确认供应商对该分发方式的授权。来源和许可见 [扫描资产说明](docs/scanned-avatar.md)。

需要 Node.js 22.12+（推荐 Node 24 LTS）、npm、支持 WASM / WebGL2 的 Chrome。

```bash
npm install
npm run dev
```

默认手部姿态为掌心朝向大腿、各指轻微握曲，显式张手、手指滑块和抓杯任务会接管这些关节。抓杯先舒展手指、回正前臂，再求解完整掌心姿态。

打开终端显示的开发地址。默认模式是「自由站立 / 行走」：骨盆具有真实六自由度，人体通过足底地面接触站立。

1. 点击「向前行走」，左右脚交替摆动，人体沿自身正前方 −Y 缓慢前进，相机跟随水平位移。
2. 点击「停步并站稳」，控制器完成当前摆动脚落地，再将重心移回双脚支撑区。暂停不会完成这一步，需要恢复物理时间。
3. 「抬手」「转头」「屈肘」「握拳」「张开双手」可以在自由模式中执行；腿部由平衡器管理。行走时双臂与两脚反向交替摆动，抬手或手动调节手臂后，该侧让出摆臂控制权；「放下双臂」恢复自动摆臂。
4. 「手指控制」支持左右手五指各自弯曲，每指联动真实物理关节；关节区域选择器可筛选头颈腰胸、左右臂、左右手和下肢，单独控制每个自由度。拇指位于食指一侧，握拳时四指先收拢、拇指后对掌并覆盖在外侧；张手时拇指先释放。舞台顶部的「左手细节 / 右手细节」提供跟随手部的近景。
5. 「质量与重心」显示总质量、重力载荷、重心高度和各段质量，支持 45–100 kg 体重调整；应用后重置物理状态。
6. 「生物力学」面板可开启「双肘肌肉驱动」，用双侧肱二头肌/肱三头肌驱动肘关节，查看激活、拉力和疲劳，并实验共同收缩与恢复。「肌肉负载示意」是独立显示开关：双肘肌肉模式下显示实际激活，其余肌群仍显示关节负载代理。
7. 切换到「固定动作演示」可单独控制全部关节，包括大幅屈膝；模式切换会重建模型、清除状态。
8. 「恢复初始姿态」通过 actuator 恢复上肢并请求停步。「重置物理状态」直接恢复 MJCF 初始 keyframe，并保留当前暂停状态。
9. 「GLB 蒙皮外观」切换连续人体皮肤 / 碰撞几何显示；关节和骨骼连线可独立显示。「关节体积修正」「呼吸与软组织动态」默认开启，可分别关闭比较。
10. 「右手向前伸 / 左手向前伸」通过肩带、肩、肘、前臂与腕部共同求解掌心目标，躯干略作配合，视线跟随；「协调向左看 / 协调向右看」由眼睛先看，再依次带动颈部、胸部与腰部。

```bash
npm test                  # 真实 WASM / GLB 测试，不是 mock
npm run build             # TypeScript + 生产打包
npm run preview           # 本地检查 dist
npx playwright install chromium
npm run test:browser      # 生产浏览器交互、步行、GLB、内存测试
```

已有 Chromium 时使用 `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`。浏览器套件包含一分钟内存观察，约需 1–2 分钟。受限云环境可使用 `npm ci --cache /workspace/.npm-cache`；普通本地开发不需要该缓存参数。

## 物理模型与对照

| 模型                     | 骨盆                  | 人体刚体 | 驱动关节 / actuator | 广义坐标 / 速度 |
| ------------------------ | --------------------- | -------- | ------------------- | --------------- |
| `human-free.xml`（默认） | freejoint，无固定约束 | 51       | 81 / 85             | 88 / 87         |
| `human.xml`              | 固定在世界坐标系      | 51       | 81 / 85             | 81 / 81         |
| `human-neuromuscular.xml` | freejoint，神经肌肉实验 | 53 | 81＋6 眼轴 / 131 | 94 / 93 |

人体包含骨盆、腰腹、独立胸廓、颈、头、左右肩带/上臂/前臂/手、大腿/小腿/后足/前脚掌，以及双手共 30 段独立手部骨骼。腰部和胸廓各有 3 个转动自由度，颈部 3 个；每侧肩带 2 个、肩关节 3 个、肘屈伸 1 个、前臂旋前/旋后 1 个、腕部 2 个。每只手有 20 个驱动自由度：四指分别具有掌指侧摆与三段屈曲，拇指具有独立对掌、掌骨屈曲、MCP 与 IP 屈曲。自由模型每条腿使用 3 自由度髋、单轴膝、2 自由度踝；多个局部 hinge 组合在同一 body 中。所有模型保留 −9.81 m/s² 重力、惯量、接触碰撞和关节限位。各段显式质量，惯量由 MuJoCo 根据碰撞几何及质量计算。

默认总质量 **65.41 kg**，在 −9.81 m/s² 重力下对应约 641.7 N 重力载荷。每只手的 0.45 kg 由掌部 0.33 kg 和五指共 0.12 kg 组成，每指三个骨段分别为 0.012/0.008/0.004 kg；拇指三段包含第一掌骨，其他四指为近/中/远节。它们是项目参数，未按个体人体数据标定。体重调整使用官方 `mj_setTotalmass` 同时缩放质量、惯量，调用 `mj_setConst` 重建派生常量，再重置控制器；平衡器使用更新后的总质量。肌肉、脂肪及骨骼的质量已合并在所属刚体内，渲染肌肉不会再加一份重量。

自由模型没有用于站立的 equality、mocap、根部 actuator、弹簧吊挂或外部支撑力。自由基座的位移与姿态由关节力矩和地面接触共同产生。下肢位置驱动器 `kp=1200, kv=85`，力矩限制 ±240 N·m；上肢与躯干保留 `kp=180, kv=24`，±160 N·m。新增腰胸关节 `kp=260, kv=30`；肩带 `kp=140, kv=14`；颈部俯仰/侧倾 `kp=60, kv=6`；前臂旋转 `kp=25, kv=2`。腕部两轴均使用 `kp=12, kv=0.6`、±5 N·m；指关节使用 `kp=1.5, kv=0.045`、±0.45 N·m，配合较小的关节阻尼与转动惯量。手指参与身体/地面接触，拇指与其他四指启用真实碰撞，以防拇指穿入拳头；其他四指之间不计算接触。相邻骨盆/腰腹、骨盆/大腿显式排除碰撞，以免固定基座模式下关节内部的重叠几何阻碍动作。自由模式总足底尺寸仍为 0.14 × 0.30 m，由后足和可转动前脚掌的两个接触盒组成，前脚掌使用 `kp=400, kv=12`、±60 N·m。步态是针对此简化模型调整的低速平地步态。

## 站立与步行控制

新增「感觉与头眼稳定」站立与行走实验：保留精确状态控制作为对照，新增带延迟和噪声的关节感觉代理、头部惯性、分区足底压力及地标视觉代理。平衡器使用独立的估计状态，支持闭眼、受限感觉、真实颈部转头和有限速度眼球补偿，以及 35 N / 120 ms 侧推对照。感觉行走增加动态支撑估计、延迟接触步态切换和估计状态落点修正；延迟增大时限速，闭眼短时行走后主动停步。长期运动学习冻结。当前范围和验收见 [感觉闭环说明](docs/sensory-control.md) 与 [感觉行走](docs/sensory-walking.md)。

新增「小脑学习实验」：在双脚站稳后，对有提示的重复侧推学习提前补偿，支持原有控制、持续学习和冻结学习对照。侧推补偿仅在实验中启用。连续行走另有左右脚落脚时序与足底载荷学习，可在同一面板学习、冻结或关闭校正。实现范围、接口和实测结果见 [小脑功能原型说明](docs/cerebellum.md)。

运动控制使用 **真人动作参考＋实测接触反馈＋全身姿态协调**。参考来自 [CMU 官方 07_01 行走采集](https://mocap.cs.cmu.edu/search.php?subjectnumber=7)，120 Hz 原始 ASF/AMC 与许可说明保存在 `assets/motions/cmu/`，转换脚本为 `scripts/prepare-walk-reference.py`。运行时对单个实测步态周期作骨架适配、周期滤波与相位采样，肩肘和腰胸运动来自该参考，慢速实验也使用实测足部抬起曲线，连续步态另行规划足端轨迹；幅度与时间按本模型的物理能力调整，手指不使用 CMU 未实测的通道。来源与控制设计详见 [运动控制说明](docs/motion-control.md)。

界面「平衡与步行」默认使用 **0.5 m/s 的连续行走**，可调 0.25–0.5 m/s；步幅约 0.28 m、节奏约每分钟 100 步，身体重心持续前移，起停有速度渐变，并显示实测前进速度。当前默认质量模型的 130 秒测试前进约 64.8 m、完成 209 次真实落脚。75 kg 以上采用经验证的 0.25 m/s 保守档位，大体重下肢控制增益随质量增强，轻体重保留基础增益，停止/重置恢复原增益。

「慢速平衡实验」保留原有 0.015–0.045 m/s 小步控制。两种步态均使用 0–100% 动作参考强度，必须先停步才能切换。连续行走由 `NaturalWalking` 生成连续重心与足部参考，在独立数据中求解 IK，并补偿位置电机的速度阻尼与摆腿惯性。骨盆高度随腿部可达距离调整，换脚时摆臂参考保持连续，落脚时序从真实接触在线校准；新增脚跟到前掌的真实关节滚动、受扰后的有界落点反馈，并从计划 / 实测载荷误差小幅校准蹬地与重心转移；停步先消除余速再切回站立。实际前进仍由关节力矩及真实地面接触产生，未改写人体位置或调高仿真倍速。当前更接近舒缓行走，尚未达到常见成人正常步速，也未覆盖转向和复杂地形。

`LocomotionSensors` 读取真实足底接触力、压力中心、支撑脚滑速和质心速度，估计 capture point。慢速实验中，`LocomotionController` 将参考相位映射到转移支撑、摆动、落地确认：支撑载荷及重心条件不满足时暂停抬脚，确认落地后才计步；落脚位置由有界重心反馈修正，着地脚锁定到实测位置。单支撑阶段重心仍继续前移；骨盆高度和微幅起伏随动作平滑变化。

`WholeBodyCoordinator` 采样真人的左右肩肘、腰胸屈伸、侧弯和扭转，叠加小幅躯干姿态反馈，并让起停权重平滑渐入渐出。手动抬臂、腰胸指令和伸手/取物任务优先于相应运动参考；下肢继续保持平衡控制权。

`LegIK` 在独立的 **scratch MjData** 中计算期望关节角：固定参考根部目标，使用 `mj_kinematics`、数值 Jacobian 和阻尼最小二乘求解每脚的位置与姿态。仅这个参考求解器会改写自己的 qpos；它不步进、不渲染，也不会覆写正在仿真的 qpos。初始站立 keyframe 也由同一求解器生成。

`BalanceController` 读取真实根部位置、姿态、速度、全身质心和 `qfrc_bias`，计算期望支撑力及姿态反馈力矩，按实际接触和支撑阶段分配足端 wrench。通过固定迭代的投影梯度求解受约束的足端力分配，限制单向法向力、摩擦棱锥和足底压力中心范围，并输出力/力矩残差。通过官方 `mj_jacBody` 的平移/旋转 Jacobian，将 `qfrc_bias − Jᵀ·wrench` 映射到腿部关节力矩前馈。连续步态另加质量矩阵与参考加速度产生的惯性前馈，以及关节参考速度补偿。前馈除以位置 actuator 的 kp 后叠加到 ctrl：

```text
ctrl = IK 位置目标 + 力矩前馈 / kp + kv / kp × 参考关节速度（连续步态）
位置 actuator 力矩 = kp × (ctrl − 实际角度) − kv × 实际速度
```

上肢、躯干、腕部和手指也使用 `qfrc_bias / kp` 作为位置目标前馈，补偿自身重力与速度相关偏置；ctrl 仍受关节范围与力矩限制。

足端力矩按足底支撑尺寸限幅，ctrl 再按 actuator 范围夹紧。所有实际运动都来自 `mj_step`，控制器不向根部施加稳定力或修改真实位姿。测试中有限的外部侧推仅用于恢复能力验证，正常站立/行走中的 `xfrc_applied` 和 `qfrc_applied` 保持零。

步态停止时等待落脚并回到双脚支撑；检测到骨盆高度过低时标记 fallen / failed，需要重置。当前验证范围是默认模型、平坦地面和低速步行；坡地、楼梯、奔跑、任意大幅动作及大扰动恢复需要进一步控制器开发与验证。该模型没有临床生物力学标定。


新增独立的「神经肌肉实验 / 自由站立」场景：双腿 34 个肌肉／功能肌群，串联弹性肌腱、三纤维肌梭及延迟反射；全腿模式关闭 14 个原位置电机，当前限速 0.25 m/s。双眼由真实刚体和每眼六条眼外肌驱动，可做转头注视、集合与弱肌实验。上层仍沿用工程控制器，低层仍保留理想局部肌长伺服；参数未做人体个体标定。[实现、边界和验收](docs/neuromuscular-control.md)。

## GLB 蒙皮

内置 `public/models/human-skinned.glb` 已升级为 V2 二进制 glTF：**92 根蒙皮骨骼、56,952 个顶点、29 个关节/软组织形态键**，包含 UV、四权重蒙皮、逆绑定矩阵和四张嵌入 PNG，无动画片段。51 根绑定骨对应 MuJoCo 人体刚体，16 根原有细节骨包括脊柱、脚趾和眼球；另外 25 根实际参与权重变形的辅助骨包括 6 根前臂扭转骨、4 根肩部骨、4 根脊柱骨，以及 11 根下颌、上下眼睑、眉、颊和口唇骨。

主体皮肤保留原始 **44,996 顶点 / 90,000 三角形的闭合连通拓扑**，V2 雕整面颊、眼眶、鼻与下颌，增加眼睑弧面、耳廓与口唇/口腔几何，并调整掌部及腕肘膝过渡。UV 分缝后主体使用 45,588 个渲染顶点；`_SOURCE_INDEX` 保留分缝前的顶点对应关系，测试按此焊接关系检查每条主体边恰有两个相邻三角形。附属几何不属于主体闭合性统计。全部形态法线重新烘焙，分缝法线合并以避免硬边；GLB 约 12.7 MB。生成统计见 `public/models/surface-report.json`，资产使用 CC0，见同目录 LICENSE.txt。

`DeformationRig` 读取真实前臂旋转、肩部旋转及胸椎角度，分配到辅助骨；它们具有独立逆绑定矩阵和非零蒙皮权重。物理骨骼的名称与直接父子层级保留。右侧「面部与辅助变形」可调整张嘴、微笑、抬眉、闭眼，以及开关辅助变形和自然眨眼。自然眨眼使用仿真时间，暂停时冻结；手动表情在暂停时也可编辑。「恢复自然表情」恢复中性值。

每侧包含肩、肘、膝体积修正、肩前屈、髋屈曲、腕屈/腕伸、四指各自的指节体积、掌心收拢、拇指虎口和上臂软组织共 14 个形态键，另有呼吸形态键。`CorrectiveSkin` 用真实关节角度驱动修正；软组织和呼吸通过弹簧阻尼状态驱动，按物理时间更新，暂停冻结。它们只改变渲染顶点，不能代替真实肌肉体积守恒、皮肤自碰撞或有限元软组织。

`MuscleLayer` 跟随真实刚体显示肌群：启用双肘肌肉后，肱二头肌/肱三头肌读取 MuJoCo 的实际 activation；其他肌群使用关节力矩负载代理。显示层本身不施加力、不改变质量，也不是 EMG 测量。原生驱动机制见下文。

「骨骼连线」额外显示脊柱、锁骨、指骨、趾骨、六对肋骨、胸骨及骨盆轮廓，作为随真实刚体运动的解剖示意，并非临床标定骨架。默认隐藏关节标记，可在显示设置中开启。

`SkinnedHuman` 使用 GLTFLoader 加载，建立 MuJoCo body → Bone 映射。每帧读取 `data.xpos / xquat`，将物理世界姿态转换为 GLB 骨骼局部姿态，再更新辅助变形和表情，由 Three.js 执行线性蒙皮。没有 AnimationMixer 或行走动画片段；物理绑定骨始终跟随仿真，辅助骨只改变外观。

界面支持上传兼容的 `.glb`（最多 20 MB）。必须满足：

- 必须包含与 51 个 MJCF body 同名的物理骨骼，且这些骨骼的直接父子层级一致；允许增加细节子骨骼。
- 米单位，Y-up glTF；绑定姿态与内置 GLB 一致。
- 使用相同骨架比例和绑定空间，不带额外的骨骼父节点变换。
- 内嵌资源；本版不实现 Draco、KTX2 或任意 Mixamo / VRM 骨架自动重定向。

加载失败会显示原因并保留已有模型；可以恢复内置蒙皮。若需接入不同人体比例或骨骼轴的高质量美术模型，应先在 DCC 中对齐骨架或增加明确的重定向适配器。

重新生成内置资产：

```bash
# 用独立 Python 环境安装网格依赖：
python -m pip install -r scripts/mesh-requirements.txt
# 直接从保存的 V1 基底重建 V2（numpy、scipy、Pillow，无需 Blender）：
npm run upgrade:avatar
# 方案 A：本地已安装 Blender，指定可执行文件：
BLENDER=/path/to/blender npm run generate:avatar
# 方案 B：CPython 3.13 环境安装 bpy，然后直接运行：
python -m pip install -r scripts/blender-requirements.txt
npm run generate:avatar
# 修改骨架定义后，同步重建身体、手部、肌肉、站立 keyframe 和 GLB：
npm run generate:anatomy
# 仅改动自由模型腿长或关节结构后，重算初始化 keyframe：
npx tsx scripts/generate-standing-key.ts
```

完整生成需要 Python 网格依赖，以及 Blender 或其 bpy 模块；V2 升级阶段使用 Python 3 的 numpy、scipy 和 Pillow。运行网站直接使用已生成资产，无需 Python 或 Blender。完整流水线先生成 authoring GLB，再由 Blender 写入 `artifacts/avatar-v2-source.glb`，最后由 `upgrade-avatar.py` 精修、重加权、制作贴图并原子替换运行 GLB。`artifacts/avatar-v1/human-skinned.glb` 保存升级前资产，V2 以保存的基底重复生成，不叠加上次雕整结果。

绑定参考使用固定模型的 **A-pose**（左肩 −0.35 rad、右肩 +0.35 rad，其余为零）。自由模型站立 keyframe 可为屈膝姿态，加载后仍由真实物理骨骼驱动。要编辑当前 V2，请在 Blender 导入 `public/models/human-skinned.glb`，其中包含新骨架、权重、UV、贴图和形态键；现有 `artifacts/human-refined.blend` 与 OBJ 是 V1 基底快照，未包含本次 V2 增补。运行时辅助骨控制与散射着色逻辑由应用实现，GLB 自身不附带动作片段。Blender 修改后须保留物理绑定命名、层级、单位和绑定姿态。

## 实体骨架与皮肤显示

「显示设置」新增「实体骨骼」和默认开启的「皮肤细节与柔和高光」。实体骨架包含颅骨与下颌、脊椎、肋骨、胸骨、肩带、骨盆、四肢长骨及手足骨，按现有物理刚体逐帧同步；开启后自动把表皮不透明度设为 18%，可用滑块调整，关闭「GLB 蒙皮外观」可单独观察骨架。关闭实体骨骼时恢复 100% 不透明度。

V2 皮肤使用 1536×1536 的颜色、切线空间法线、打包粗糙度/金属度和厚度/散射权重 PNG，既嵌入 GLB，也输出到 `public/models/skin-v2/`。UV 随蒙皮运动，贴图 mipmap 用于远景过滤，皮肤遮罩使衣服、头发、眼球与口唇保留各自颜色。着色器按真实灯光方向与厚度权重增加柔化漫反射和偏暖背光散射，不靠提高透明度产生效果；耳部与手部具有较高散射权重。「皮肤细节与柔和高光」可对比法线、粗糙度和散射效果。旧版 GLB 仍支持原程序材质。前后对比见 `artifacts/avatar-v2-review/`。

实体骨架仍是解剖结构的可视化近似；V2 的新增辅助骨参与蒙皮变形，不增加动力学质量或约束。皮肤贴图为程序制作，散射是厚度感知的实时近似，未采用扫描皮肤、完整多层 BSSRDF 或有限元组织模拟。当前面部仍为风格化模型，发型和口腔细节尚未达到写实角色资产精度。

## 真实杯子取物

取物前可直接在三维视图中拖动杯子，在台面内调整位置；右侧也提供「杯子 X / Y 位置」滑块，暂停时同样可用。摆放会将杯子直立放回台面并清零杯子速度，不修改人体姿态；取物、持杯、放回和其他动作运行期间禁止摆放。可摆放范围由台面尺寸减去杯底半径和 5 mm 边缘余量决定，目前约为 X ±45 mm、Y ±25 mm（相对默认位置）。重置恢复默认位置。

每次取物都从杯子的实际位置生成接近、对齐和提起目标，接近结束后再次读取杯子位置；放回目标是本次拿起的位置。开始前检查各阶段目标到肩部的距离，并检查杯子是否直立、是否位于台面。距离检查是初步可达性检查，碰撞或关节限位仍可能使动作超时失败。已用台面上四个内部偏移位置和四个边界角点验证实际提起与放回；接触松手可能产生毫米级滑移，内部位置测试使用 15 mm 的落点容差。

点击视图上方「抓取近景」或右侧「查看手与杯子近景」，相机同时跟随右手和杯子，并随两者间距调整取景。可以继续拖拽空白区域旋转、滚轮缩放，点击「默认视角」退出近景。近景适用于接近、收指、持杯和放回全过程。

在「基座模式」选择 **「取物实验 / 自由站立」**，然后点击右侧「接触取物实验」中的 **「拿起杯子」**。人物先抬手避开台边，再调整掌心法向与手指纵向，侧握杯壁。各指读取实际接触法向力：接触后停止快速搜索，以较慢的位置加压建立握力，达到停指阈值后保留目标；持杯阶段冻结手指参考。杯子离台并稳定后显示 `holding`，可以点击 **「放回杯子」**。控制器根据实际杯子相对掌心的位置放回台面，确认支撑后先松拇指，再松四指并侧向撤手。暂停冻结整个物理过程，重置恢复杯子与人体初态。

杯子是 **120 g、杯壁中线半径 22 mm、杯高约 126 mm（含圆角）、壁厚约 6 mm** 的独立自由刚体，由 24 段杯壁胶囊与圆柱杯底组成，内部中空。台面和立柱固定在世界中。杯子显示使用连续的中空旋转曲面，杯壁胶囊保留为碰撞近似，显示层始终跟随实际刚体姿态。杯子没有位置驱动器、mocap、焊接约束或辅助外力；正常动作只修改人体 actuator 参考，实际杯子运动由 `mj_step` 中的接触、摩擦和重力产生。碰撞关闭后杯子会掉落，测试覆盖此反证。

阶段顺序为 `prepare → approach → align → close → lift → holding → lower → open → retreat → done`。接近位置容差分别为 25 / 12 mm；每指接触阈值 0.08 N，停指阈值 2.5 N（阈值不是实际力的上限）。只有拇指及至少两根其他手指持续加载，才开始试提；实际提升超过 6 cm、台面支撑小于 0.05 N 且持续保持接触至少 0.8 秒，才报告持杯成功。放回完成也必须检测到真实台面支撑，失败或滑落会显示 `failed`。

持杯及放回期间启用 MuJoCo 的 3 次 NoSlip 摩擦求解后处理，减少软接触导致的慢滑；结束、失败或重置后恢复原设置。该设置仍受接触与摩擦约束，不锁定杯子位姿，参见 [MuJoCo 软接触与慢滑说明](https://mujoco.readthedocs.io/en/latest/modeling.html#slow-slippage)。接触向量和逐条接触的 WASM 包装对象均及时释放，测试检查持续持杯的 WASM 堆不再增长。

取物场景保留 51 个人体刚体及 81 个关节电机，另加一个杯子刚体和 7 / 6 个广义坐标 / 速度。人体质量统计和体重调整排除杯子；GLB 只绑定人体，杯子与台面保持独立渲染。取物期间姿态、行走和手动关节控制暂停接受新命令，需先放回杯子或重置。`holding` 时顶层动作状态为 `completed`，抓握任务继续维持持杯。

当前验证的是默认体型、台面内多个位置的固定尺寸空杯、右手和静止站立；不是任意物体或障碍环境的通用抓取。手部接触采用原有刚体碰撞几何，尚未使用连续皮肤网格做精确碰撞，也没有液体或杯把操作。截图见 `artifacts/cup-pickup.png`、`artifacts/cup-grip-detail.png` 和偏移抓取近景 `artifacts/movable-cup-closeup.png`。

## 外形与典型姿态检查

舞台新增「头肩细节」视角，可与左右手近景一起检查外形。固定模式可运行「下蹲姿态检查」：通过实际 actuator 屈髋、屈膝和屈踝，检查髋膝附近皮肤。该模式固定骨盆，不代表自由站立时降低骨盆的下蹲已经实现；自由模式拒绝此指令。

`artifacts/pose-review/index.html` 提供头肩、握拳改前改后，以及站立、抬臂、屈肘、握拳和屈髋屈膝的浏览器截图。对比图将两版外观放在同一新版物理骨架上；原始物理/蒙皮备份保留在 `artifacts/refinement-before`。所有姿态通过 MuJoCo 驱动器完成，检查不会在应用中直接写真实 qpos。

```bash
npm run review:poses
# 可选：使用 bpy 对刚导出的姿态进行非相邻三角形相交检查：
python scripts/check-skin-intersections.py
# 重算原始版本的基线：
npm run review:poses -- --before
python scripts/check-skin-intersections.py --before
```

报告记录零面积/非有限三角形、相对绑定姿态的面积与边长分位数，以及实际启用的形态键。BVH 仅生成候选，再双向检测三角边与另一三角形的交点；共享顶点的相邻面、边界触碰及共面重叠不计入。该检查发现并指导缩窄过宽胸廓、大腿与虎口体积，但仍有腋下、握拳和髋部的局部皮肤穿插。穿插数量受拓扑密度影响，不等于穿入深度，也不能证明任意姿态没有自交。进一步消除这些问题仍需要局部重拓扑、姿态雕刻或运行时皮肤自碰撞。

## 协调动作与肌肉驱动

`ReachTask` 在独立、按需分配的 scratch MjData 中进行 6 维阻尼最小二乘求解，每侧使用 9 个肩带/肩/肘/前臂/腕自由度；掌心位置与朝向沿平滑轨迹变化。默认目标随骨盆平移，自定义目标固定在世界坐标系。求解结果只作为 actuator 参考，不改真实 qpos。目标超出肩部 0.57 m 或非有限坐标会拒绝；几何距离检查不能保证所有障碍物条件下可达，实际掌心误差小于 2.5 cm 且关节稳定才完成。手指命令保留当前伸手任务；操作它占用的关节或执行协调转头会交出控制权。默认伸手由已有双腿平衡器维持站立，另有下文的指定杯子取物流程；尚未实现跨步取物和任意物体的通用抓持规划。

每个模型保留 81 个位置 actuator，并增加 **4 个 MuJoCo 原生 muscle actuator、4 个 fixed tendon 和 4 个激活状态**。默认关闭肌肉模式以保留已有控制行为。开启后双肘的位置电机 gain / bias 全部置零，由肱二头肌和肱三头肌施力；关闭后恢复电机。肌肉具有原生激活动力学、主动长度/速度关系和被动拉力，峰值参数 900 N、固定力臂 ±0.03 m；等效肌腱增加 70 N/m 弹性与 1.5 N·s/m 阻尼。控制器从目标力矩反求配对兴奋度，通过 `mj_step` 产生实际运动。机制参考 [MuJoCo 官方肌肉说明](https://mujoco.readthedocs.io/en/stable/modeling.html#muscles)。

疲劳状态 `f` 按 `df/dt = 0.12*a*(1-f) - 0.035*(1-a)*f` 更新（`a` 为实际激活），主动产力能力乘以 `1-0.7*f`；降低激活后逐渐恢复。被动力不随疲劳削弱。面板可以切换疲劳、共同收缩实验或恢复自动控制；重置清空疲劳与手动兴奋度。遥测包含 excitation、activation、force（N）、fatigue、capacity、等效 tendonLength / tendonVelocity 与 motorForce。固定肌腱长度是转动角乘以力臂的广义长度，可能为负，不能当作解剖肌腱长度。

目前真正的肌肉驱动范围是双肘，其他关节仍用位置电机；肌腱为固定力臂的等效传动与并联被动弹性，未实现绕骨空间路径、串联肌腱、全身肌群优化或生理标定。软组织形态键是视觉弹簧模型，并非有限元组织物理。

## 坐标、状态与时间

MJCF 使用 `compiler angle="radian"`。右手世界坐标：**+X 为人体左侧、−Y 为正前方、+Z 向上**。关节轴定义在对应 body 的局部坐标系，遵循右手法则。界面角度与速度显示为度、度/秒；引擎和 ctrl 使用 rad、rad/s，力矩使用 N·m。

| 关节                              | 局部轴 | 范围 rad   |
| --------------------------------- | ------ | ---------- |
| spine                             | +Y     | −0.35…0.35 |
| neck_yaw                          | +Z     | −0.9…0.9   |
| left/right_shoulder               | +Y     | −2.7…2.7   |
| left/right_shoulder_flex          | +X     | −1.5…2.5   |
| left/right_elbow                  | −X     | 0…2.4      |
| left/right_hip                    | +X     | −1.5…1.2   |
| left/right_hip_abduction          | +Y     | −0.5…0.5   |
| left/right_hip_yaw（自由模型）    | +Z     | −0.6…0.6   |
| left/right_knee                   | +X     | 0…2.2      |
| left/right_ankle                  | +X     | −0.55…0.55 |
| left/right_ankle_roll（自由模型） | +Y     | −0.5…0.5   |

新增关节在界面按区域分组。腰胸各三轴、颈部俯仰/侧倾、肩带升降/前后转、肩内外旋、前臂旋转、腕部侧偏和前脚掌屈曲均为真实 MuJoCo hinge；手指范围按骨段分别设置，拇指骨链长度改为 28 / 24 / 20 mm，三段半径为 10 / 9 / 8 mm；拇指屈曲上限为 0.6 / 1.2 / 1.4 rad，四指为 1.5 / 1.7 / 1.4 rad，对掌范围 0–2.1 rad，分指 ±0.22 rad。这些是原型的近似关节与控制参数，未按个体解剖或运动捕捉数据标定。

正颈角向人体左侧转头；左肩负角、右肩正角向侧面抬臂；正肘角向前屈肘；正膝角让小腿向后弯曲，髋前屈为负角。

碰撞几何渲染使用 Z-up Three.js 世界，读取 `geom_xpos / geom_xmat`；行主序旋转矩阵转为 Three.js 四元数。蒙皮使用标准 Y-up 资源，通过 ±90° X 轴转换连接 Z-up 场景。`xquat` 顺序是 w,x,y,z，转换到 Three.js 时使用 x,y,z,w。每步后 `mj_forward` 保证位姿派生量与当前 qpos 一致，重置也立即同步。

物理步长固定为 0.002 秒（500 Hz），RAF 驱动物理累积与渲染，UI 约 10 Hz 更新。每帧最多接受 0.1 秒物理时间，额外时间丢弃并显示统计，以避免切换后台后无界追赶。倍速作用于物理时间；性能不足时会降低相对真实时间的速度。

遥测分别展示关节目标、实际角度、实际速度、ctrl 和实际 actuator 力矩。自由模式腿部目标是 IK 参考角，ctrl 额外包含支撑前馈，二者可以不同；固定模式 ctrl 是经过 Smoothstep 插值的轨迹角加上偏置前馈；自由模式自动摆臂时肩屈伸与肘部显示动态参考。暂停冻结物理状态，正常动作不直接设置真实 qpos。

## Agent / 外部模块入口

```js
window.human.executeAction({ action: "walk_forward", source: "agent" });
window.human.executeAction({ action: "stop_walk", source: "agent" });
window.human.executeAction({
  action: "raise_right_arm",
  duration: 2,
  source: "agent",
});
window.human.executeAction({ action: "close_right_hand", duration: 1 });
window.human.executeAction({ action: "open_hands", duration: 1 });
window.human.executeAction({ action: "rotate_palms", duration: 2 });
window.human.executeAction({ action: "shrug_shoulders", duration: 2 });
window.human.setFinger("right", "index", 0.8); // 0–1，食指三段联动
window.human.executeAction({ action: "reach_right", duration: 2 });
// 可选 target：掌心的世界坐标 [X,Y,Z]，单位米；超范围目标返回 false
window.human.executeAction({ action: "reach_left", target: [0.23, -0.30, 1.20] });
window.human.executeAction({ action: "look_left", duration: 2 });
// 切换到取物场景后：
window.human.placeCup(-0.20, -0.315); // 台面内重新摆放，运行中的动作会拒绝此操作
window.human.executeAction({ action: "pick_up_cup" });
// grasp.stage === "holding" 后：
window.human.executeAction({ action: "put_down_cup" });
window.human.setFace({ jawOpen: 0.3, smile: 0.5, browRaise: 0.2, blink: 0, autoBlink: true });
window.human.getState(); // {status, time, locomotion, joints, body, reach, muscles, grasp, face}
```

`walk_forward` 持续行走至收到 `stop_walk` / `stand`；duration 用于姿态命令。`locomotion` 包含 mode、phase、steps、pelvis 世界位置、实际接触数量、足底最低高度和 stopping 标志。固定模式的 locomotion 为 null。

`grasp` 在普通场景为 null；取物场景包含 stage、error、cupPosition、placementBounds（X / Y 的 min / max）、unavailable（开始取物前的不可用原因）、liftHeight、supportForce、maxPenetration，以及每指的 curl / contactForce / stopped。`placeCup(x, y)` 成功时返回 true，取物中、未站稳或输入超出范围时返回 false。取物命令使用分阶段时长，`duration` 不改变其内部轨迹时序。

`body` 包含 mass（kg）、weight（N）、centerOfMass（世界坐标）和各段质量 segments。`setFinger` 的手指名为 thumb / index / middle / ring / little。

`setFace` 接受部分面部参数：jawOpen / smile / browRaise / blink 为 0–1，autoBlink 为布尔值。输入非法时返回 false；成功时更新界面和面部辅助骨。`face` 返回用户设置，自然眨眼的瞬时权重由仿真时间计算。面部参数不改变物理关节。

新增的演示指令还包括 `nod_head`（低头）、`twist_torso`（腰胸扭转）、`lean_forward`（身体前倾）、`shrug_shoulders`（耸肩）、`rotate_palms`（前臂旋转）、`spread_fingers`（五指展开）。大幅腰胸或上肢动作建议在固定模式中观察；自由站立控制尚未覆盖任意组合姿态。

姿态命令还包括 `raise_left_arm`, `lower_arms`, `turn_head_left`, `turn_head_right`, `bend_left_elbow`, `bend_right_knee`, `reset_pose`。自由模式拒绝单独的大幅屈膝命令，避免和腿部平衡控制权冲突；切换固定模式可用。新姿态命令从当前轨迹目标连续插值，未指定关节保留前一目标。输入时长须为有限正数。

状态：idle / running / completed / failed。上肢/固定模式轨迹结束后，位置误差 <0.14 rad 且速度 <0.12 rad/s 才标记 completed；额外 6 秒未稳定则 failed。步行持续 running，落脚停稳后 completed。没有动作队列、网络 Agent 服务或鉴权层。

## 官方 API 与部署

安装包版本固定为 3.16.0，使用实际类型定义与运行测试核对 API：默认 `loadMujoco({locateFile})`、`MjModel.from_xml_string`、`new MjData(model)`、`mj_step`、`mj_forward`、`mj_resetData` / `mj_resetDataKeyframe`、`mj_kinematics`、`mj_jacBody`、`mj_name2id`、`mj_id2name`。

该版本 `DoubleBuffer` 的实际方法是 **`GetView()`（大写 G）**，与随包 README 部分旧示例的 `getView()` 不同。代码按实际 d.ts 和运行结果实现，并用 `delete()` 释放所有模型、数据与输出缓冲区。

WASM 以 `@mujoco/mujoco/mujoco.wasm?url` 导入，Vite 输出独立哈希资源；MJCF 和 GLB 使用 BASE_URL 下的 models 路径。部署上传完整 dist，正确提供 WASM MIME（application/wasm）并启用 gzip / brotli。单线程不需要 SharedArrayBuffer 或跨源隔离头。WASM 原始大小约 10.8 MB；Vite 对官方绑定的 Node `module` 分支会发出 externalized 提示，浏览器路径不使用此分支，生产浏览器测试覆盖加载。

## 文件结构与验证

```text
public/models/human.xml                  固定基座模型
public/models/human-free.xml             自由基座、81 位置电机 + 4 肌肉和站立 keyframe
public/models/human-neuromuscular.xml    独立全腿肌肉／肌梭与物理眼球实验
public/models/human-skinned.glb          内置带权重的骨骼蒙皮资产
src/physics/                            引擎、加载和固定步长循环
src/human/HumanController.ts             动作、控制权与 Agent 入口
src/human/LocomotionController.ts        重心转移、摆动、停止和跌倒状态
src/human/LegIK.ts                       独立参考数据中的足端 IK
src/human/ReachTask.ts                   肩带、肩肘腕的掌心位置 / 完整朝向 IK
src/human/GraspTask.ts                   接触停指、试提、持杯、放回与松手
src/physics/CupScene.ts                  空心自由杯体、支撑台与初始化坐标扩展
src/rendering/CupRenderer.ts             跟随杯体的连续中空显示曲面
src/human/MuscleController.ts            双肘原生肌肉、激活控制、疲劳与恢复
src/human/neuromuscular/                 全腿肌肉、串联弹性肌腱、三纤维肌梭、物理眼球
scripts/generate-neuromuscular.ts        从原自由模型重建独立实验资产
src/rendering/CorrectiveSkin.ts          关节修正、注视、呼吸与软组织弹簧
src/human/BalanceController.ts           质心 / 根部反馈和 Jacobian 力矩映射
src/rendering/SkinnedHuman.ts            GLB 加载、物理骨骼同步与释放
src/human/Anatomy.ts                     手部骨骼、对掌轴与各段屈曲/限位定义
src/human/MuscleAnatomy.ts               肌群外观位置和关节负载关联
src/rendering/AnatomicalSkeleton.ts      解剖骨架与肋骨可视化
src/rendering/MuscleLayer.ts             肌群负载显示（不施力）
src/rendering/HumanRenderer.ts           碰撞几何、骨架与蒙皮切换
src/rendering/SceneManager.ts            场景、相机跟随和释放
src/components/                         React 控制、遥测和导入面板
tests/physics.test.ts                    原有动作、限位、重置及几何同步
tests/locomotion.test.ts                 自由站立、受推恢复、持续行走与停止
tests/skin.test.ts                       GLB 骨骼、顶点蒙皮及取消加载
tests/anatomy.test.ts                    手指、摆臂、体重/惯量与肌肉显示验证
tests/biomechanics.test.ts               连续网格、修正形变、伸手与原生肌肉验证
tests/grasp.test.ts                      独立杯体、实际取放、持续持杯、掉落与内存验证
tests/browser/app.spec.ts               生产浏览器回归
scripts/generate-body.ts                腰胸、肩带、前臂与前脚掌结构生成
scripts/generate-hands.ts               双轴腕、拇指对掌、分指和屈曲关节生成
scripts/generate-muscles.ts              原生肌肉和等效肌腱生成
scripts/remesh-human.py                  连续闭合皮肤重建、简化和权重扩散
scripts/create-correctives.ts            29 个形态键生成
scripts/upgrade-avatar.py                V2 雕整、25 根辅助骨重加权、UV 和嵌入皮肤贴图
src/rendering/DeformationRig.ts          真实关节驱动辅助骨、眨眼和面部控制
public/models/skin-v2/                   可编辑的颜色、法线、粗糙度和厚度贴图
scripts/refine-avatar-blender.py         Blender 精修、法线烘焙、稀疏形态和 .blend
scripts/review-poses.ts                  五种真实物理姿态的蒙皮质量检查
scripts/check-skin-intersections.py      BVH 候选与三角形穿插检查
artifacts/human-refined.blend            可编辑的人体精修源文件
artifacts/pose-review/index.html         改前改后与典型姿态截图
artifacts/pose-review.json               姿态质量和穿插统计
scripts/                                GLB 和初始化 keyframe 生成工具
```

自动检查包括左右拇指先后闭合、对掌接触与无深度穿透、腰胸/颈/肩带/前臂等独立驱动、左右手特写、手指独立屈曲/张开、腕部动作、对侧摆臂与手动接管、45/100 kg 端点下站立及短程步行、肌群显示不改变物理状态、60 秒自由站立、35 N / 0.1 s 有限侧推后的恢复、130 秒连续步行（约 209 次落脚、64.8 米，左右脚实际离地）、关节限位、停步恢复、重置、蒙皮顶点移动与世界骨骼同步，以及一分钟浏览器 GC 后堆增长 <8 MB 的观察。

卸载时取消 RAF、断开 ResizeObserver、释放 OrbitControls、几何/材质/纹理/骨骼、阴影、WebGL 上下文、MuJoCo 主/参考 MjData、DoubleBuffer 和 MjModel。共享 WASM 模块复用。内存检查是有界测试，不证明任意资产和无限期运行无泄漏。

### 人体标定基准

已接入公开踝部测力/肌电与独立步行数据，支持参数来源配置、分阶段离线拟合、冻结留出验证和原关节执行器、踝部与全腿肌肉同条件对照。当前候选未通过完整人体验证，默认控制器保留工程参数。运行 `npm run calibrate:ankle`、`npm run calibration:compare`，再运行 `python3 scripts/calibration/render_report.py`，打开 `artifacts/calibration/report.html`。范围、坐标、证据限制和复现方法见 [人体标定说明](docs/human-calibration.md)。
