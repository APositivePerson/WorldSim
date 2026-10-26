# 本地真人扫描资产

来源：[Renderpeople 免费人物](https://renderpeople.com/free-3d-people/)，`rp_eric_rigged_001`，带骨骼 FBX。许可：[供应商条款](https://renderpeople.com/general-terms-and-conditions/)。免费资产仍受供应商条款约束，不是 CC0。项目未将扫描原件、纹理或派生网格纳入可发布资产。不要把本地私有目录作为项目附件或静态站点上传。

## 本机重建

从供应商取得免费 rigged FBX 包，解开其中 Eric 的独立压缩包到 `artifacts/scanned-private/`，该目录应直接包含：

```text
rp_eric_rigged_001_yup_a.fbx
tex/rp_eric_rigged_001_dif.jpg
tex/rp_eric_rigged_001_norm.jpg
tex/rp_eric_rigged_001_gloss.jpg
```

安装项目 npm 依赖及 Python 的 numpy、scipy、Pillow 后执行：

```bash
npm run prepare:scan
npm run dev
```

脚本将扫描骨架的姿态、单位和各段起止点对齐到项目绑定骨架，重新计算网格及法线，并将原权重映射到物理骨骼与辅助骨。端点对齐失败会中止生成；`fitting-report.json` 记录拟合比例与误差。输出为 `artifacts/scanned-private/runtime/eric.glb`，内嵌四张 4K 贴图和来源说明。该转换改变了人体比例，不能拿来声称原始扫描的测量精度。

`vite.config.ts` 只在本地开发/预览服务中提供此文件及可用性状态。`public/models/local-scan-status.json` 的静态值始终为 false，独立部署的 dist 默认显示程序人物，不请求私有扫描文件。

## 验证

`npm test` 包含扫描权重归一化、51 根物理骨绑定、手指变形与面部控制验证；本地资产缺失时该项跳过。`tests/browser/scanned-avatar.spec.ts` 在有本地资产时生成全身、脸部、闭眼、手部与实际持杯截图，并核对物理提杯结果。渲染截图保存在私有目录，供应商模型不进入普通项目制品。

扫描皮肤使用摄影颜色及法线；粗糙度从源光泽转换，散射厚度是美术估计。毛发、衣服使用扫描曲面和贴图，未实现独立发丝、布料动力学或扫描级内部骨骼。面部保留简单骨骼控制，不是完整表情捕捉系统。

手部拟合会同步缩放掌部和指骨横截面，避免只缩短长度造成的宽扁比例。默认手势由真实关节力矩驱动，掌心朝向身体内侧、各指轻曲；近景相机从身体外侧观察。当前行走仍是基于接触和平衡的简化慢速步态，未接入真人动作捕捉或训练得到的行走策略。
