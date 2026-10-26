"""用 pygame 画出银行场景、人物、对话气泡和对话记录。"""
from __future__ import annotations

import math

import pygame

from env.world import World2D
from protocol import ACTION_LABELS

MAP_W, MAP_H = 760, 560
PANEL_W = 420
INPUT_H = 44
WIN_W, WIN_H = MAP_W + PANEL_W, MAP_H + INPUT_H

BG = (245, 242, 235)
FLOOR_LINE = (225, 220, 210)
SPOT = (210, 225, 240)
SPOT_EDGE = (120, 150, 180)
TEXT = (40, 40, 40)
MUTED = (120, 120, 120)
CUSTOMER = (230, 120, 60)
ROBOT = (70, 130, 200)
PANEL_BG = (32, 36, 44)
PANEL_TEXT = (225, 225, 225)
ROBOT_TEXT = (130, 180, 240)
CUSTOMER_TEXT = (245, 170, 120)
SYS_TEXT = (150, 200, 150)
ERR_TEXT = (240, 110, 110)

TELLER = (120, 160, 110)
TELLER_TEXT = (160, 210, 140)


def load_font(size: int) -> pygame.font.Font:
    for name in ("microsoftyahei", "simhei", "simsun", "notosanscjksc", "pingfangsc"):
        path = pygame.font.match_font(name)
        if path:
            return pygame.font.Font(path, size)
    return pygame.font.Font(None, size)


def wrap(font: pygame.font.Font, text: str, width: int) -> list[str]:
    """按像素宽度逐字换行（中文没有空格，只能逐字）。"""
    lines, cur = [], ""
    for ch in text:
        if ch == "\n" or font.size(cur + ch)[0] > width:
            lines.append(cur)
            cur = "" if ch == "\n" else ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines or [""]


class Renderer:
    def __init__(self, screen: pygame.Surface):
        self.screen = screen
        self.f_small = load_font(14)
        self.f = load_font(16)
        self.f_big = load_font(18)
        self.log: list[tuple[str, str]] = []      # (类别, 文本)
        self.bubbles: dict[str, tuple[str, float]] = {}   # 谁 -> (文本, 结束时间)；谁 = customer / 员工key / 员工key@地点
        self.scroll = 0
        self.hint = ""

    def add_log(self, kind: str, text: str) -> None:
        self.log.append((kind, text))
        self.scroll = 0

    def say(self, who: str, text: str, now: float, duration: float | None = None) -> None:
        dur = (duration + 1.5) if duration else 3 + len(text) * 0.25
        self.bubbles[who] = (text, now + dur)

    def _bubble_of(self, who: str, now: float) -> str:
        text, until = self.bubbles.get(who, ("", 0.0))
        return text if now < until else ""

    # ---------- 绘制 ----------
    def draw(self, world: World2D, input_text: str, composing: str, thinking: bool, persona_name: str):
        self.screen.fill(BG)
        self._draw_map(world)
        self._draw_staff(world)
        self._draw_customer(world, persona_name)
        self._draw_status(world, thinking)
        self._draw_panel()
        self._draw_input(input_text, composing)

    def _draw_map(self, world: World2D):
        for x in range(0, MAP_W, 40):
            pygame.draw.line(self.screen, FLOOR_LINE, (x, 0), (x, MAP_H))
        for y in range(0, MAP_H, 40):
            pygame.draw.line(self.screen, FLOOR_LINE, (0, y), (MAP_W, y))
        # 场景装饰（柜台台面、座椅……）来自场景文件的 draw2d
        for item in world.scenario.data.get("draw2d", []):
            color = tuple(item.get("color", (200, 200, 200)))
            if "rect" in item:
                pygame.draw.rect(self.screen, color, item["rect"], border_radius=4)
            if "grid" in item:
                x0, y0, w, h, cols, rows, dx, dy = item["grid"]
                for i in range(cols):
                    for j in range(rows):
                        pygame.draw.rect(self.screen, color, (x0 + i * dx, y0 + j * dy, w, h), border_radius=5)
        seats = set((world.scenario.workflow or {}).get("seat_places", []))
        for key, (x, y) in world.positions.items():
            r = pygame.Rect(0, 0, 96, 30)
            r.center = (x, y + (70 if key in seats else 34))
            pygame.draw.rect(self.screen, SPOT, r, border_radius=6)
            pygame.draw.rect(self.screen, SPOT_EDGE, r, 1, border_radius=6)
            label = world.place_label(key).split("（")[0]
            s = self.f_small.render(label, True, TEXT)
            self.screen.blit(s, s.get_rect(center=r.center))
            pygame.draw.circle(self.screen, SPOT_EDGE, (x, y), 4)

    def _draw_staff(self, world: World2D):
        """迎宾（一般是服务机器人）画成机器人；其他员工在每个岗位画一个圆点。"""
        now, sc = world.time, world.scenario
        for key, staff in sc.staff.items():
            for place, (x, y) in staff.get("pos2d", {}).items():
                text = self._bubble_of(key, now) if key == sc.greeter else self._bubble_of(f"{key}@{place}", now)
                if key == sc.greeter:
                    pygame.draw.rect(self.screen, ROBOT, (x - 14, y - 18, 28, 36), border_radius=8)
                    pygame.draw.circle(self.screen, (255, 255, 255), (x - 5, y - 8), 3)
                    pygame.draw.circle(self.screen, (255, 255, 255), (x + 5, y - 8), 3)
                    if text:
                        self._bubble(text, (x, y - 24), ROBOT)
                else:
                    pygame.draw.circle(self.screen, TELLER, (x, y), 9)
                    if text:
                        # 柜员在最上面一排，气泡放到左边，不挡住柜台前的顾客
                        self._bubble(text, (x - 14, y), TELLER, side=True)

    def _draw_customer(self, world: World2D, name: str):
        x, y = world.pos
        act = world.current.action
        t = world.time
        dy = 0.0
        if act == "walk_to" and world.walk_target:
            dy = abs(math.sin(t * 10)) * 3          # 走路时上下颠
        body_h = 22 if world.posture == "sitting" else 34
        head_y = y - body_h - 8 - dy
        if act == "nod":
            head_y += abs(math.sin(t * 12)) * 4
        head_x = x + (math.sin(t * 14) * 4 if act == "shake_head" else 0)

        pygame.draw.ellipse(self.screen, (200, 195, 185), (x - 14, y - 4, 28, 10))   # 影子
        pygame.draw.rect(self.screen, CUSTOMER, (x - 10, y - body_h - dy, 20, body_h), border_radius=6)
        pygame.draw.circle(self.screen, (250, 210, 170), (int(head_x), int(head_y)), 10)

        # 朝向：一条短线指向正在看的方向
        fx, fy = world.facing
        ang = math.atan2(fy - y, fx - x)
        pygame.draw.line(self.screen, TEXT, (head_x, head_y),
                         (head_x + math.cos(ang) * 14, head_y + math.sin(ang) * 14), 2)

        # 手臂动作
        shoulder = (x + 10, y - body_h + 6 - dy)
        if act == "wave":
            a = -math.pi / 2 + math.sin(t * 10) * 0.6
            pygame.draw.line(self.screen, CUSTOMER, shoulder,
                             (shoulder[0] + math.cos(a) * 18, shoulder[1] + math.sin(a) * 18), 4)
        elif act in ("point_to", "hand_over", "take"):
            target = world.look_positions.get(world.current.target or "", world.facing) if act == "point_to" else world.facing
            a = math.atan2(target[1] - shoulder[1], target[0] - shoulder[0])
            pygame.draw.line(self.screen, CUSTOMER, shoulder,
                             (shoulder[0] + math.cos(a) * 20, shoulder[1] + math.sin(a) * 20), 4)
            if act in ("hand_over", "take"):
                pygame.draw.rect(self.screen, (255, 255, 255),
                                 (shoulder[0] + math.cos(a) * 20 - 5, shoulder[1] + math.sin(a) * 20 - 3, 10, 7))

        s = self.f_small.render(name, True, TEXT)
        self.screen.blit(s, s.get_rect(center=(x, y + 12)))
        if act in ACTION_LABELS:
            s = self.f_small.render(f"[{ACTION_LABELS[act]}]", True, MUTED)
            self.screen.blit(s, s.get_rect(center=(x, head_y - 20)))

        text = self._bubble_of("customer", t)
        if text:
            self._bubble(text, (x, head_y - 30), CUSTOMER, below=(x, y + 22))

    def _bubble(self, text: str, anchor, color, below=None, side=False):
        lines = wrap(self.f, text, 200 if side else 220)
        h = len(lines) * 20 + 12
        w = max(self.f.size(l)[0] for l in lines) + 16
        r = pygame.Rect(0, 0, w, h)
        if side:                     # 柜员在最上面一排，气泡放到左边，不挡住柜台前的顾客
            r.topright = anchor
        else:
            r.midbottom = anchor
        if not side and r.top < 4 and below:      # 上面放不下（比如在柜台前），改放到人物下方
            r.midtop = below
        r.clamp_ip(pygame.Rect(4, 4, MAP_W - 8, MAP_H - 8))
        pygame.draw.rect(self.screen, (255, 255, 255), r, border_radius=8)
        pygame.draw.rect(self.screen, color, r, 2, border_radius=8)
        for i, line in enumerate(lines):
            self.screen.blit(self.f.render(line, True, TEXT), (r.x + 8, r.y + 6 + i * 20))

    def _draw_status(self, world: World2D, thinking: bool):
        loc = "移动中" if world.walk_target else world.place_label(world.location).split("（")[0]
        parts = [f"t={world.time:5.1f}s", f"位置：{loc}", "坐着" if world.posture == "sitting" else "站着"]
        if world.ticket_no:
            parts.append(f"号码：{world.ticket_no}")
        if thinking:
            parts.append("思考中…")
        if world.finished:
            parts.append("【已结束】")
        s = self.f_small.render("   ".join(parts), True, TEXT)
        self.screen.blit(s, (8, MAP_H - 22))

    def _draw_panel(self):
        x0 = MAP_W
        pygame.draw.rect(self.screen, PANEL_BG, (x0, 0, PANEL_W, WIN_H))
        self.screen.blit(self.f_big.render("对话与事件记录", True, PANEL_TEXT), (x0 + 12, 10))
        colors = {"robot": ROBOT_TEXT, "customer": CUSTOMER_TEXT, "sys": SYS_TEXT,
                  "event": MUTED, "thought": (170, 170, 200), "error": ERR_TEXT, "teller": TELLER_TEXT}
        rows: list[tuple[str, tuple]] = []
        for kind, text in self.log:
            for line in wrap(self.f_small, text, PANEL_W - 24):
                rows.append((line, colors.get(kind, PANEL_TEXT)))
        visible = (MAP_H - 50) // 19
        end = len(rows) - self.scroll
        for i, (line, col) in enumerate(rows[max(0, end - visible):end]):
            self.screen.blit(self.f_small.render(line, True, col), (x0 + 12, 42 + i * 19))

    def _draw_input(self, text: str, composing: str):
        r = pygame.Rect(0, MAP_H, MAP_W, INPUT_H)
        pygame.draw.rect(self.screen, (255, 255, 255), r)
        pygame.draw.line(self.screen, (180, 180, 180), r.topleft, r.topright, 2)
        hint = self.hint
        shown = text + (f"[{composing}]" if composing else "")
        s = self.f.render(shown or hint, True, TEXT if shown else MUTED)
        self.screen.blit(s, (10, MAP_H + 12))
        if pygame.time.get_ticks() // 500 % 2 == 0:
            cx = 10 + self.f.size(shown)[0] + 2 if shown else 10
            pygame.draw.line(self.screen, TEXT, (cx, MAP_H + 12), (cx, MAP_H + 32), 1)
