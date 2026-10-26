import { test, expect } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";

test("cup sliders, canvas drag, tracking closeup and pickup at a new position", async ({ page }) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/?avatar=procedural");
  await page.getByLabel("基座模式").selectOption("grasp");
  await expect(page.getByTestId("skin-status")).toContainText("92 骨骼");
  await page.getByRole("button", { name: "暂停仿真" }).click();
  await page.getByLabel("杯子 X 位置").fill("-0.2");
  await page.getByLabel("杯子 Y 位置").fill("-0.315");
  const cup = await page.evaluate(() => window.human!.getState().grasp!.cupPosition);
  const pausedTime = await page.evaluate(() => window.human!.getState().time);
  expect(cup[0]).toBeCloseTo(-.2, 5);
  expect(cup[1]).toBeCloseTo(-.315, 5);

  // Project the actual cup into the default camera, then exercise native pointer dragging.
  await page.getByRole("button", { name: "默认视角" }).click();
  const pelvis = await page.evaluate(() => window.human!.getState().locomotion!.pelvis);
  const canvas = page.locator("canvas"), rect = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(38, rect.width / rect.height, .01, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(pelvis[0] + 2, pelvis[1] - 3, 2);
  camera.lookAt(pelvis[0], pelvis[1], 1);
  camera.updateMatrixWorld();
  const projected = new Vector3(...cup).project(camera);
  const x = rect.x + (projected.x + 1) * rect.width / 2;
  const y = rect.y + (1 - projected.y) * rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y - 5, { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate(() => window.human!.getState().grasp!.cupPosition);
  expect(Math.hypot(moved[0] - cup[0], moved[1] - cup[1])).toBeGreaterThan(.005);
  expect(await page.evaluate(() => window.human!.getState().time)).toBe(pausedTime);

  await page.getByLabel("杯子 X 位置").fill("-0.2");
  await page.getByLabel("杯子 Y 位置").fill("-0.315");
  await page.getByRole("button", { name: "查看手与杯子近景" }).click();
  await expect(page.getByRole("button", { name: "抓取近景", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "继续仿真" }).click();
  await page.getByRole("button", { name: "拿起杯子" }).click();
  await expect(page.getByLabel("杯子 X 位置")).toBeDisabled();
  await expect(page.getByTestId("grasp-stage")).toHaveText("holding", { timeout: 80000 });
  await page.getByRole("button", { name: "暂停仿真" }).click();
  const state = await page.evaluate(() => window.human!.getState());
  expect(state.grasp!.liftHeight).toBeGreaterThan(.06);
  expect(state.grasp!.supportForce).toBeLessThan(.05);
  expect(await page.evaluate(() => window.human!.placeCup(-.23, -.3))).toBe(false);
  await canvas.screenshot({ path: "artifacts/movable-cup-closeup.png" });
  await page.getByRole("button", { name: "继续仿真" }).click();
  await page.getByRole("button", { name: "放回杯子" }).click();
  await expect(page.getByTestId("grasp-stage")).toHaveText("done", { timeout: 60000 });
  const placed = await page.evaluate(() => window.human!.getState().grasp!);
  // Contact-driven release can slide a few millimetres; use the physical test's 15 mm tolerance.
  expect(Math.hypot(placed.cupPosition[0] + .2, placed.cupPosition[1] + .315)).toBeLessThan(.015);
  expect(Math.abs(placed.liftHeight)).toBeLessThan(.003);
  expect(placed.supportForce).toBeGreaterThan(.8);
  await expect(page.getByLabel("杯子 X 位置")).toBeEnabled();
  expect(errors).toEqual([]);
});
