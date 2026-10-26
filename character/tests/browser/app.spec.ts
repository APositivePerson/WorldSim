import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test("real cup pickup, paused holding and placement",async({page})=>{
  test.setTimeout(120000);
  await page.setViewportSize({width:1600,height:1100});
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?avatar=procedural");await page.getByLabel("基座模式").selectOption("grasp");
  await expect(page.getByTestId("skin-status")).toContainText("92 骨骼");
  await expect(page.getByTestId("grasp-stage")).toHaveText("idle");
  await page.getByRole("button",{name:"拿起杯子"}).click();
  await expect(page.getByTestId("grasp-stage")).toHaveText("holding",{timeout:70000});
  await page.getByRole("button",{name:"暂停仿真"}).click();
  const state=await page.evaluate(()=>window.human!.getState());
  expect(state.grasp!.liftHeight).toBeGreaterThan(.07);expect(state.grasp!.supportForce).toBeLessThan(.05);
  expect(state.locomotion!.pelvis[2]).toBeGreaterThan(.88);
  expect(state.grasp!.fingers.some(f=>f.stopped&&f.curl<.6)).toBe(true);
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>window.human!.getState().grasp!.cupPosition)).toEqual(state.grasp!.cupPosition);
  await page.screenshot({path:"artifacts/cup-pickup.png",fullPage:true});
  await page.getByRole("button",{name:"右手细节"}).click();
  await page.locator("canvas").screenshot({path:"artifacts/cup-grip-detail.png"});
  await page.getByRole("button",{name:"继续仿真"}).click();
  await page.getByRole("button",{name:"放回杯子"}).click();
  await expect(page.getByTestId("grasp-stage")).toHaveText("done",{timeout:60000});
  const placed=await page.evaluate(()=>window.human!.getState().grasp!);
  expect(Math.abs(placed.liftHeight)).toBeLessThan(.003);expect(placed.supportForce).toBeGreaterThan(.8);
  await writeFile("artifacts/cup-grasp-state.json",JSON.stringify({held:state.grasp,placed},null,2));
  await page.getByRole("button",{name:"重置物理状态"}).click();
  await expect(page.getByTestId("grasp-stage")).toHaveText("idle");
  expect(errors).toEqual([]);
});
test("refined human pose and detail contact sheet",async({page})=>{
  test.setTimeout(120000);
  await mkdir("artifacts/pose-review",{recursive:true});
  await page.setViewportSize({width:1600,height:1100});
  const errors:string[]=[];page.on("pageerror",(e)=>errors.push(e.message));
  await page.goto("/?avatar=procedural");
  await expect(page.getByTestId("skin-status")).toContainText("92 骨骼");
  await expect(page.getByRole("button",{name:"下蹲姿态检查"})).toBeDisabled();
  await page.getByLabel("基座模式").selectOption("fixed");
  await expect(page.getByTestId("skin-status")).toContainText("92 骨骼");
  const shot=async(name:string)=>page.locator("canvas").screenshot({path:`artifacts/pose-review/${name}.png`});
  // Retain a reproducible visual baseline from the previous asset.
  await page.getByLabel("载入兼容 GLB").setInputFiles("artifacts/refinement-before/human-skinned.glb");
  await expect(page.getByTestId("skin-status")).toContainText("human-skinned.glb");
  await shot("before-standing");
  await page.getByRole("button",{name:"头肩细节"}).click();await shot("before-head");
  await page.getByRole("button",{name:"右手细节"}).click();
  await page.getByRole("button",{name:"右手握拳"}).click();
  await expect(page.getByTestId("action-status")).toHaveText("completed");await shot("before-fist");
  await page.getByRole("button",{name:"恢复内置蒙皮"}).click();
  await expect(page.getByTestId("skin-status")).toContainText("GLB 已绑定");
  await page.getByRole("button",{name:"重置物理状态"}).click();
  await page.getByRole("button",{name:"头肩细节"}).click();await shot("head");
  const cases=[
    ["standing","恢复初始姿态"],["raised-arms","抬右手"],["bent-elbow","弯曲左肘"],
    ["fists","右手握拳"],["squat","下蹲姿态检查"],
  ];
  for(const [name,label] of cases){
    await page.getByRole("button",{name:"重置物理状态"}).click();
    await page.getByRole("button",{name:"默认视角"}).click();
    await page.getByRole("button",{name:label}).click();
    await expect(page.getByTestId("action-status")).toHaveText("completed");await shot(name);
  }
  await page.getByRole("button",{name:"重置物理状态"}).click();
  await page.getByRole("button",{name:"头肩细节"}).click();await shot("head");
  await page.getByRole("button",{name:"右手细节"}).click();await shot("hand-open");
  await page.getByRole("button",{name:"右手握拳"}).click();
  await expect(page.getByTestId("action-status")).toHaveText("completed");await shot("hand-fist");
  await page.getByLabel("关节体积修正").uncheck();await shot("hand-fist-no-correctives");
  expect(errors).toEqual([]);
});

test("continuous skin, corrective shapes, coordinated reaching/gaze and native elbow muscle drive", async ({page}) => {
  await page.setViewportSize({width:1600,height:1100});
  const errors:string[]=[];page.on("pageerror",(e)=>errors.push(e.message));
  await page.goto("/?avatar=procedural");
  await expect(page.getByTestId("skin-status")).toContainText("92 骨骼");
  await expect(page.getByLabel("关节体积修正")).toBeChecked();
  await expect(page.getByLabel("呼吸与软组织动态")).toBeChecked();
  await page.screenshot({path:"test-results/continuous-human.png",fullPage:true});
  await page.getByRole("button",{name:"协调向左看"}).click();
  await expect(page.getByTestId("action-status")).toHaveText("completed");
  await page.getByRole("button",{name:"恢复初始姿态"}).click();
  await expect(page.getByTestId("action-status")).toHaveText("completed");
  await page.getByRole("button",{name:"右手向前伸"}).click();
  await expect.poll(()=>page.evaluate(()=>window.human!.getState().reach?.error??1),{timeout:15000}).toBeLessThan(0.025);
  await expect(page.getByTestId("action-status")).toHaveText("completed");
  await page.screenshot({path:"test-results/coordinated-reach.png",fullPage:true});
  await page.getByRole("button",{name:"恢复初始姿态"}).click();
  await expect(page.getByTestId("action-status")).toHaveText("completed");
  await page.getByLabel("双肘肌肉驱动").check();
  await page.getByRole("button",{name:"弯曲左肘"}).click();
  await expect.poll(()=>page.evaluate(()=>window.human!.getState().joints.find((j)=>j.name==="left_elbow")!.actual)).toBeGreaterThan(1.5);
  const bio=await page.evaluate(()=>window.human!.getState().muscles);
  expect(bio.enabled).toBe(true);
  const flex=bio.muscles.find((m)=>m.name==="bio_left_biceps")!;
  expect(flex.force).toBeGreaterThan(5);expect(Math.abs(flex.motorForce)).toBeLessThan(1e-6);
  await page.screenshot({path:"test-results/native-muscle-drive.png",fullPage:true});
  await page.getByText("手动肌肉激活实验",{exact:true}).click();
  await page.getByRole("button",{name:"左肘共收缩",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.human!.getState().muscles.muscles.find((m)=>m.name==="bio_left_biceps")!.activation)).toBeGreaterThan(0.5);
  await page.getByRole("button",{name:"左肘放松恢复",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.human!.getState().muscles.muscles.find((m)=>m.name==="bio_left_biceps")!.activation)).toBeLessThan(0.01);
  await page.getByRole("button",{name:"左肘恢复自动跟踪",exact:true}).click();
  expect(errors).toEqual([]);
});
test("left and right thumbs remain visible in open-hand and closed-fist closeups", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/?avatar=procedural");
  await page.getByLabel("基座模式").selectOption("fixed");
  await expect(page.getByTestId("skin-status")).toContainText("92 骨骼");
  for (const [side, title] of [["right", "右"], ["left", "左"]] as const) {
    await page.getByRole("button", { name: `${title}手细节` }).click();
    await page.getByRole("button", { name: "张开双手" }).click();
    await expect(page.getByTestId("action-status")).toHaveText("completed");
    await page.locator("canvas").screenshot({ path: `test-results/${side}-hand-open.png` });
    await page.getByRole("button", { name: `${title}手握拳` }).click();
    await expect(page.getByTestId("action-status")).toHaveText("completed");
    const state = await page.evaluate(() => window.human!.getState());
    expect(state.joints.find((j) => j.name === `${side}_thumb_opposition`)!.actual).toBeGreaterThan(1.5);
    await page.locator("canvas").screenshot({ path: `test-results/${side}-hand-fist.png` });
  }
  await page.getByRole("button", { name: "默认视角" }).click();
  await page.getByLabel("关节区域").selectOption("trunk");
  await expect(page.getByLabel("chest_twist", { exact: true })).toBeVisible();
  await page.getByLabel("关节区域").selectOption("right_arm");
  await expect(page.getByLabel("right_forearm_rotation", { exact: true })).toBeVisible();
});
test("detailed anatomical avatar loads and skeleton overlay can be inspected", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/?avatar=procedural");
  await expect(page.getByTestId("skin-status")).toContainText("92 骨骼");
  await page.getByRole("button", { name: "暂停仿真" }).click();
  await page.screenshot({ path: "test-results/anatomy-avatar.png", fullPage: true });
  await page.getByLabel("骨骼连线").check();
  await page.screenshot({ path: "test-results/anatomy-skeleton.png", fullPage: true });
});
test("physical hand controls, body weight, muscle view and walking arm swing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/?avatar=procedural");
  await expect(page.getByTestId("skin-status")).toContainText("92 骨骼");
  await page.getByLabel("右手食指弯曲", { exact: true }).fill("100");
  const angle = (name: string) => page.evaluate((name) =>
    window.human!.getState().joints.find((j) => j.name === name)!.actual, name);
  await expect.poll(() => angle("right_index_1_flex")).toBeGreaterThan(0.7);
  expect(Math.abs(await angle("right_little_1_flex"))).toBeLessThan(0.1);
  await page.getByRole("button", { name: "右手握拳" }).click();
  await expect.poll(() => angle("right_middle_2_flex")).toBeGreaterThan(1);
  await page.getByRole("button", { name: "张开双手" }).click();
  await expect.poll(async () => Math.abs(await angle("right_index_1_flex"))).toBeLessThan(0.1);
  await page.getByLabel("体重 (kg)", { exact: true }).fill("80");
  await page.getByRole("button", { name: "应用体重并重置" }).click();
  await expect(page.getByTestId("body-mass")).toHaveText("80.00 kg");
  await page.getByLabel("肌肉负载示意").check();
  await page.getByRole("button", { name: "向前行走" }).click();
  await expect.poll(async () => Math.abs(await angle("left_shoulder_flex")), { timeout: 20000 }).toBeGreaterThan(0.12);
  const state = await page.evaluate(() => window.human!.getState());
  const l = state.joints.find((j) => j.name === "left_shoulder_flex")!.actual;
  const r = state.joints.find((j) => j.name === "right_shoulder_flex")!.actual;
  expect(Math.abs(l + r)).toBeLessThan(0.12);
  expect(state.body.mass).toBeCloseTo(80, 6);
  await page.getByRole("button", { name: "停步并站稳" }).click();
  await expect(page.getByTestId("gait-mode")).toHaveText("stand", { timeout: 15000 });
  await page.getByRole("button", { name: "弯曲左肘" }).click();
  await page.getByRole("button", { name: "右手握拳" }).click();
  await expect.poll(() => angle("right_index_1_flex")).toBeGreaterThan(0.7);
  await page.getByRole("button", { name: "暂停仿真" }).click();
  await page.screenshot({ path: "test-results/human-muscle-load.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("production WASM, physical actions, telemetry, pause/reset and WebGL synchronization", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?avatar=procedural");
  await expect(page.getByText("● 引擎在线")).toBeVisible();
  await page.getByLabel("基座模式").selectOption("fixed");
  await expect(page.getByText("● 引擎在线")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => window.human?.getState().time ?? 0))
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "抬右手" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          window.human
            ?.getState()
            .joints.find((j) => j.name === "right_shoulder")?.actual ?? 0,
      ),
    )
    .toBeGreaterThan(1.5);
  await expect(page.getByTestId("action-status")).toHaveText("completed");
  const right = await page.evaluate(() =>
    window.human!.getState().joints.find((j) => j.name === "right_shoulder")!,
  );
  expect(Math.abs(right.actual - right.target)).toBeLessThan(0.14);
  await page.getByRole("button", { name: "向左转头" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          window.human!.getState().joints.find((j) => j.name === "neck_yaw")!
            .actual,
      ),
    )
    .toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "暂停仿真" }).click();
  const time = await page.evaluate(() => window.human!.getState().time);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.human!.getState().time)).toBe(time);
  await page.getByRole("button", { name: "重置物理状态" }).click();
  expect(await page.evaluate(() => window.human!.getState().time)).toBe(0);
  expect(
    await page.evaluate(() =>
      window
        .human!.getState()
        .joints.every(
          (j) => j.actual === 0 && j.velocity === 0 && j.control === 0,
        ),
    ),
  ).toBe(true);
  await page.getByLabel("骨骼连线").check();
  await page.getByLabel("关节标记").uncheck();
  await page.getByLabel("世界坐标轴").uncheck();
  await page.getByRole("button", { name: "默认视角" }).click();
  await page.getByRole("button", { name: "继续仿真" }).click();
  await page.getByLabel("right_elbow", { exact: true }).fill("65");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          window.human!.getState().joints.find((j) => j.name === "right_elbow")!
            .actual,
      ),
    )
    .toBeGreaterThan(0.8);
  await page.screenshot({ path: "test-results/human-lab.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("renderer resources plateau during a minute of running", async ({
  page,
}) => {
  await page.goto("/?avatar=procedural");
  await expect(page.getByText("● 引擎在线")).toBeVisible();
  // CDP collects heap after forced GC. This is a bounded smoke check, not a proof of no leaks.
  const client = await page.context().newCDPSession(page);
  await client.send("HeapProfiler.enable");
  await page.waitForTimeout(2000);
  await client.send("HeapProfiler.collectGarbage");
  const before = await client.send("Runtime.getHeapUsage");
  await page.waitForTimeout(60000);
  await client.send("HeapProfiler.collectGarbage");
  const after = await client.send("Runtime.getHeapUsage");
  expect(after.usedSize - before.usedSize).toBeLessThan(8 * 1024 * 1024);
  expect(
    await page.evaluate(() =>
      window.human!.getState().joints.every((j) => Number.isFinite(j.actual)),
    ),
  ).toBe(true);
});

test("free standing, physical walking/stopping, GLB skin and compatible-asset loading", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?avatar=procedural");
  await expect(page.getByTestId("skin-status")).toContainText("GLB 已绑定");
  await expect(page.getByTestId("gait-mode")).toHaveText("stand");
  expect(
    await page.evaluate(() => window.human!.getState().locomotion!.pelvis[2]),
  ).toBeGreaterThan(0.88);
  await page.getByRole("button", { name: "向前行走" }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.human!.getState().locomotion!.steps),
      { timeout: 45000 },
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(() => window.human!.getState().locomotion!.pelvis[1]),
  ).toBeLessThan(-0.06);
  await page.getByRole("button", { name: "停步并站稳" }).click();
  await expect(page.getByTestId("gait-mode")).toHaveText("stand", {
    timeout: 15000,
  });
  expect(
    await page.evaluate(() => window.human!.getState().locomotion!.pelvis[2]),
  ).toBeGreaterThan(0.88);
  await page.getByRole("button", { name: "抬右手" }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            window
              .human!.getState()
              .joints.find((j) => j.name === "right_shoulder")!.actual,
        ),
      { timeout: 10000 },
    )
    .toBeGreaterThan(1.5);
  await page.getByLabel("GLB 蒙皮外观").uncheck();
  await page.getByLabel("GLB 蒙皮外观").check();
  await page
    .getByLabel("载入兼容 GLB")
    .setInputFiles("public/models/human-skinned.glb");
  await expect(page.getByTestId("skin-status")).toContainText(
    "human-skinned.glb",
  );
  await page
    .getByLabel("载入兼容 GLB")
    .setInputFiles({
      name: "invalid.glb",
      mimeType: "model/gltf-binary",
      buffer: Buffer.from("invalid"),
    });
  await expect(page.getByTestId("skin-status")).toContainText("GLB 加载失败");
  await page.getByRole("button", { name: "恢复内置蒙皮" }).click();
  await expect(page.getByTestId("skin-status")).toContainText("GLB 已绑定");
  await page.getByRole("button", { name: "暂停仿真" }).click();
  await page.screenshot({
    path: "test-results/free-human-skinned.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "重置物理状态" }).click();
  expect(await page.evaluate(() => window.human!.getState().time)).toBe(0);
  expect(
    await page.evaluate(() => window.human!.getState().locomotion!.steps),
  ).toBe(0);
  expect(
    await page.evaluate(() => window.human!.getState().locomotion!.pelvis[2]),
  ).toBeCloseTo(0.925, 6);
  expect(errors).toEqual([]);
});
