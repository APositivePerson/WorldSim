import { test, expect } from "@playwright/test";

test("cerebellum panel runs a cued physical experiment, pauses and clears memory", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?avatar=procedural");
  await expect(page.getByRole("heading", { name: "小脑学习实验" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.human?.getState().locomotion?.settled)).toBe(true);
  await page.getByRole("button", { name: "持续学习", exact: true }).click();
  await expect(page.getByTestId("cerebellum-state")).toContainText("进行中");
  await expect(page.getByTestId("training-hud")).toBeVisible();
  await expect(page.getByRole("button", { name: "清除学习记忆" })).toBeDisabled();
  await page.getByRole("button", { name: /暂停仿真/ }).click();
  const before = await page.evaluate(() => window.human!.getState());
  await page.waitForTimeout(200);
  expect((await page.evaluate(() => window.human!.getState())).time).toBe(before.time);
  await page.getByRole("button", { name: "停止实验", exact: true }).click();
  await expect(page.getByTestId("cerebellum-state")).toContainText("未运行");
  await page.getByRole("button", { name: "清除学习记忆" }).click();
  await expect(page.getByTestId("cerebellum-state")).toContainText("0 轮");
  await page.getByRole("button", { name: /继续仿真/ }).click();
  await expect.poll(() => page.evaluate(() => window.human!.getState().locomotion!.settled)).toBe(true);
  await page.getByRole("combobox", { name: "仿真速度", exact: true }).selectOption("0.25");
  expect(await page.evaluate(() => window.human!.startCerebellumExperiment("learn", 1))).toBe(true);
  // Pause inside the actual force pulse to inspect the stable 3-D arrow and HUD.
  await page.waitForFunction(() => {
    const trial = window.human?.getState().cerebellumExperiment;
    if (trial && trial.elapsed > .95 && trial.force > 0) {
      Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("暂停仿真"))?.click();
      return true;
    }
    return false;
  }, undefined, { polling: 10, timeout: 15000 });
  await expect(page.getByTestId("training-hud")).toContainText("100 N");
  await page.locator(".viewport").screenshot({ path: "artifacts/cerebellum-push-visible.png" });
  await page.getByRole("combobox", { name: "仿真速度", exact: true }).selectOption("1");
  await page.getByRole("button", { name: /继续仿真/ }).click();
  await expect.poll(() => page.evaluate(() => window.human!.getState().locomotion!.cerebellum.trials.length), { timeout: 20000 }).toBe(1);
  expect(await page.evaluate(() => window.human!.getState().locomotion!.cerebellum.learnedPeak)).toBeGreaterThan(0);
  await expect(page.getByTestId("training-stage")).toContainText("本组已完成");
  await page.getByRole("region", { name: "小脑学习实验" }).screenshot({ path: "artifacts/cerebellum-panel.png" });
  await expect(page.getByTestId("cerebellum-live-trace")).not.toHaveAttribute("d", "");
  const trace = await page.evaluate(() => window.human!.getState().cerebellumExperiment!.trace);
  expect(Math.max(...trace.map(point => Math.abs(point.displacement)))).toBeGreaterThan(.015);
  await page.getByLabel("训练过程监视器").screenshot({ path: "artifacts/cerebellum-training-monitor.png" });
  await page.getByLabel("侧推档位").selectOption("standard");
  expect(await page.evaluate(() => window.human!.getState().locomotion!.cerebellum.trials.length)).toBe(0);
  expect(errors).toEqual([]);
});
