"""Render the frozen pilot report and standalone scientific comparison plots."""
import json,pathlib,html,os
os.environ.setdefault('MPLCONFIGDIR','/tmp/human-calibration-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/calibration'
r=json.loads((OUT/'report.json').read_text());pred=json.loads((OUT/'predictions.json').read_text())
held=[p for p in pred if p['split']=='holdout']
fig,axes=plt.subplots(len(held),1,figsize=(11,3*len(held)),layout='constrained')
for ax,p in zip(axes,held):
 a,b=p['baseline'],p['candidate'];ax.plot(a['time'],a['observed'],color='black',lw=1,label='Human dynamometer')
 ax.plot(a['time'],a['prediction'],lw=1,label='Engineering + same observation offset')
 ax.plot(b['time'],b['prediction'],lw=1,label='Frozen candidate + observation offset')
 ax.set(title=p['id'],xlabel='Source clock (s)',ylabel='Dorsiflexion torque (N m)')
 ax.legend(fontsize=8);ax.grid(alpha=.2)
fig.savefig(OUT/'heldout-torque.png',dpi=150);plt.close(fig)
fig,axes=plt.subplots(1,len(r['gait']),figsize=(12,4),layout='constrained')
for ax,g in zip(axes,r['gait']):
 ax.plot(g['phase'],g['targetNmPerKg'],color='black',label='Measured target')
 for p in g['profiles']:ax.fill_between(g['phase'],p['minNmPerKg'],p['maxNmPerKg'],alpha=.2,label=p['profile'])
 ax.set(title=f"{g['id']} ({g['speedMps']:.2f} m/s)",xlabel='Gait phase (not seconds)',ylabel='DF torque (N m/kg)');ax.legend(fontsize=7)
fig.savefig(OUT/'gait-capacity.png',dpi=150);plt.close(fig)
legrows=''.join(f"<tr><td>{html.escape(g['id'])}</td><td>{html.escape(p['profile'])}</td><td>{p['rmseNmPerKg']['hip']:.3f}</td><td>{p['rmseNmPerKg']['knee']:.3f}</td><td>{p['rmseNmPerKg']['ankle']:.3f}</td></tr>" for g in r['fullLeg'] for p in g['profiles'])
rows=''.join(f"<tr><td>{html.escape(v['id'])}</td><td>{v['baseline']['rmseNm']:.2f}</td><td>{v['candidate']['rmseNm']:.2f}</td><td>{v['rawBaseline']['rmseNm']:.2f}</td><td>{v['rawCandidate']['rmseNm']:.2f}</td><td>{v['candidate']['samples']}</td><td>{'通过' if v['pass'] else '未通过'}</td></tr>" for v in r['validation'])
comparison='尚未运行；执行 npm run calibration:compare 后重新生成报告。'
cp=OUT/'controller-comparison.json'
if cp.exists():
 c=json.loads(cp.read_text())
 if c['profileSha256']==r['profileSha256']:
  comparison='<table><tr><th>条件</th><th>控制器</th><th>完成</th><th>最低骨盆 m</th><th>位移 m</th><th>步数</th></tr>'+''.join(f"<tr><td>{v['condition']}</td><td>{v['mode']}</td><td>{not v['failed']}</td><td>{v['minHeight']:.3f}</td><td>{v['distanceM']:.2f}</td><td>{v['steps']}</td></tr>" for v in c['results'])+'</table>'
 else: comparison='已有控制器报告对应其他配置，必须重跑对照。'
page=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>踝部人体标定：冻结候选与留出验证</title>
<style>body{{max-width:1100px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui;color:#182a38;background:#f7f9fc}}h1{{font-size:28px}}section{{background:white;padding:24px;margin:20px 0;border:1px solid #d7e1ea;border-radius:12px}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{text-align:left;padding:9px;border-bottom:1px solid #d7e1ea}}img{{width:100%;height:auto}}code{{overflow-wrap:anywhere}}.status{{color:#9e3a10}}pre{{white-space:pre-wrap}}</style>
<h1>踝部人体标定 · 第一版基准</h1><p class="status">研究候选，尚未通过完整人体标定；未替换运行时默认控制器。</p>
<section><h2>范围与冻结记录</h2><p>RUB 参与者 1，伸膝踝部实验。被动 5°/s 与慢、中速收缩用于拟合；30°/s、120°/s、快速收缩、非对称收缩和正弦任务整体留出。主动任务固定选用前 16 秒，被动任务最多前 80 秒。排除首秒、模型活动范围外和被动任务肌电过高的样本；完整曲线仍展示。</p><p>配置 SHA-256：<code>{r['profileSha256']}</code></p><pre>{html.escape(json.dumps(r['values'],indent=2))}</pre><p>forceScale 是共享主动输出倍率，与肌电映射混淆，不能解释为每条肌肉的真实最大肌力。measurementBiasNm 仅为训练得到的观测偏置，不进入运行时肌肉或辅助力。</p></section>
<section><h2>留出任务力矩误差</h2><p>单位 N·m。公平对照对两种模型使用相同观测偏置；另列不加偏置的原始误差。阈值在 protocol.json 预先指定，仅为工程门槛。不能只选择改善的任务报告。</p><table><tr><th>试次</th><th>原模型+偏置</th><th>候选+偏置</th><th>原模型无偏置</th><th>候选无偏置</th><th>有效样本</th><th>门槛</th></tr>{rows}</table><img src="heldout-torque.png" alt="五个留出实验的实测与预测力矩"></section>
<section><h2>训练敏感性与不确定性</h2><p>只用训练数据对各参数做有限差分，检查局部输出敏感性。共享肌腱比例、被动力系数、主动倍率与观测偏置仍可能混淆；没有每条肌肉力或 γ 驱动的唯一解，也没有统计置信区间。完整敏感性矩阵见 report.json。</p></section><section><h2>反射与步行证据限制</h2><p>{html.escape(r['stages']['reflex']['status'])}：当前数据没有经过核实的扰动起始与独立基线驱动，保留原 Ia/II/γ 参数。双向滤波肌电不能用于推断神经延迟。</p><p>WBDS 另一参与者的两个速度只用于静态力矩可达范围检查。其 101 点平均曲线是步态相位，没有真实周期时长和肌电，因此不能当作动态步行预测、功率验证或反射拟合。</p><img src="gait-capacity.png" alt="独立步行速度的静态容量对照"></section>
<section><h2>膝、髋与全腿扩展</h2><p>独立步行数据同时提供髋、膝、踝三个矢状面力矩需求；用双关节肌肉共享的非负力范围做联合静态分配，避免三个关节分别“够力”却互相冲突。下表为联合分配后各轴残差 N·m/kg。未观测额状面、横断面及脚趾需求，分配不唯一，不代表真实肌肉力或完整步行可行性。膝髋参数仍冻结，不用这些留出数据反向调参。</p><table><tr><th>任务</th><th>配置</th><th>髋</th><th>膝</th><th>踝</th></tr>{legrows}</table></section><section><h2>同条件闭环控制器对照</h2><p>同一模型、初始状态、0.25 m/s 指令与 35 N / 120 ms 侧推。原位置控制、原/候选踝部肌肉、原/候选全腿肌肉分别运行；这些是工程稳定性测试，不是人体实验。各方案保留相同上层控制器及理想局部肌长伺服。</p>{comparison}</section>
<section><h2>数据来源与复现</h2><p><a href="https://doi.org/10.6084/m9.figshare.26502868">van der Zee 等踝部数据</a>；<a href="https://doi.org/10.6084/m9.figshare.5722711">Fukuchi 等步行数据</a>，均为 CC BY 4.0。来源文件哈希与处理方式见 assets/calibration/provenance.json 和归一化数据。</p><p>执行 npm run calibrate:ankle，再执行 npm run calibration:compare，最后 python3 scripts/calibration/render_report.py。报告与冻结配置对应同一哈希；禁止根据留出结果继续调参后沿用同一验证结论。</p></section></html>'''
(OUT/'report.html').write_text(page)
print(OUT/'report.html')
