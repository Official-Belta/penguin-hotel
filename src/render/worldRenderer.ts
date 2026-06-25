// WorldRenderer — 2.5D 아이소 월드의 '그리기' 전담. 코어/허브는 import 만, 수정 없음.
// 카메라(팬/줌) · 바닥 · 시설 · 손님 · 팝(떠오르는 숫자) · 앰비언트(눈/러시) 를 매 프레임 동기.
// 깊이정렬은 손님/시설 모두 화면 y 기준 zIndex 로 통일(앞에 있는 게 위에).

import {
  Application,
  Container,
  Graphics,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import type { GameApp } from "../game/gameApp";
import type { Building } from "../core/models/building";
import type { Guest } from "../core/models/guest";
import { BuildingPhase, GuestPhase } from "../core/models/enums";
import { SPECIES, NEEDS } from "../game/display";
import {
  makeGroundTile,
  makeSelectionTile,
  makePenguin,
  makeBuildingSprite,
  makeShadow,
  makeSnowflake,
} from "./art";
import {
  cellToScreen,
  lerpPt,
  smoothK,
  TILE_H,
  type Pt,
} from "./iso";

// ── 튜닝 상수 ─────────────────────────────────────────────────
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.2;
const ZOOM_STEP = 0.0015; // 휠 한 노치당 줌 변화율
const POP_RISE = 38; // 팝이 떠오르는 px
const POP_LIFE = 1100; // 팝 수명(ms)
const SNOW_COUNT = 70; // 앰비언트 눈송이 수
const LABEL_FONT = "-apple-system, 'Noto Sans KR', sans-serif";

// 라벨/배지 공통 텍스트 스타일 헬퍼.
function label(text: string, size: number, fill: number, weight: "400" | "600" | "700" = "600"): Text {
  const t = new Text({
    text,
    style: { fontFamily: LABEL_FONT, fontSize: size, fill, fontWeight: weight, align: "center" },
  });
  t.anchor.set(0.5, 0.5);
  return t;
}

// ── 시설 뷰(시설 1동의 영속 컨테이너 + 자식 핸들 캐시) ──────────
interface BuildingView {
  root: Container; // entityLayer 자식. position = 시설 베이스 스크린좌표
  sprite: Container; // makeBuildingSprite 결과(틴트/알파 조절 대상)
  selection: Graphics; // makeSelectionTile (선택 시만 visible)
  badge: Text; // 점유 N/N
  nameLabel: Text; // 이모지 + 이름
  progress: Container; // 건설/업그레이드 진행 오버레이
  progBar: Graphics; // 진행 바(매 프레임 redraw)
  progDim: Graphics; // 건설중 반투명 덮개
  lastPhase: BuildingPhase | null;
}

// ── 손님 뷰 ───────────────────────────────────────────────────
interface GuestView {
  root: Container; // entityLayer 자식
  sprite: Container; // makePenguin (waddle 대상)
  shadow: Graphics;
  bubble: Container; // 머리 위 욕구 말풍선 + patience 바
  bubbleEmoji: Text;
  patienceBar: Graphics;
  cold: Text; // 🥶 (저체온 시)
  serveRing: Graphics; // BeingServed 진행 링
  pos: Pt; // 현재 보간된 스크린좌표(목표로 lerp)
  target: Pt; // 목표 스크린좌표
  wobble: number; // waddle 위상
  fade: number; // 0~1, 사라질 때 페이드아웃
  removing: boolean;
  scale: number; // 종 체구
  bornAt: number;
}

// ── 팝 입자 ───────────────────────────────────────────────────
interface PopFx {
  text: Text;
  x: number;
  y: number;
  age: number;
}

// ── 눈송이 입자 ───────────────────────────────────────────────
interface Snow {
  g: Graphics;
  x: number;
  y: number;
  vy: number;
  vx: number;
  sway: number;
  swaySpeed: number;
}

export class WorldRenderer {
  private readonly app: Application;
  private readonly game: GameApp;

  // 카메라 = world 컨테이너. 그 안에 깊이 레이어들.
  private readonly world = new Container();
  private readonly groundLayer = new Container();
  private readonly entityLayer = new Container(); // 시설+손님 (y정렬)
  private readonly fxLayer = new Container(); // 팝(월드 좌표, 정렬 위)
  private readonly snowLayer = new Container(); // 화면 고정 앰비언트(스테이지 직속)

  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly guestViews = new Map<string, GuestView>();
  private readonly pops: PopFx[] = [];
  private readonly snow: Snow[] = [];

  // 카메라 상태
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragCamX = 0;
  private dragCamY = 0;
  private dragMoved = false;
  private fitted = false;

  // 핀치 줌
  private pinchDist = 0;

  private elapsed = 0; // 누적 ms (앰비언트 위상용)

  constructor(app: Application, game: GameApp) {
    this.app = app;
    this.game = game;

    app.stage.eventMode = "static";
    app.stage.sortableChildren = true;

    this.world.sortableChildren = true;
    this.groundLayer.sortableChildren = true;
    this.entityLayer.sortableChildren = true;

    this.groundLayer.zIndex = 0;
    this.entityLayer.zIndex = 10;
    this.fxLayer.zIndex = 20;
    this.world.addChild(this.groundLayer, this.entityLayer, this.fxLayer);

    app.stage.addChild(this.world);
    this.snowLayer.zIndex = 100;
    app.stage.addChild(this.snowLayer);

    this.buildGround();
    this.buildSnow();
    this.bindCamera();
  }

  // ── 바닥 타일 ───────────────────────────────────────────────
  private buildGround(): void {
    for (const cell of this.game.layout.groundCells()) {
      const p = cellToScreen(cell.col, cell.row);
      const tile = makeGroundTile();
      tile.position.set(p.x, p.y);
      tile.zIndex = p.y; // 화면 y 깊이정렬
      this.groundLayer.addChild(tile);
    }
  }

  // ── 앰비언트 눈 ─────────────────────────────────────────────
  private buildSnow(): void {
    for (let i = 0; i < SNOW_COUNT; i++) {
      const g = makeSnowflake();
      const s: Snow = {
        g,
        x: Math.random(),
        y: Math.random(),
        vy: 14 + Math.random() * 26,
        vx: -6 + Math.random() * 12,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.5 + Math.random() * 1.2,
      };
      this.snow.push(s);
      this.snowLayer.addChild(g);
    }
  }

  // ── 카메라 입력(팬/줌/핀치) ─────────────────────────────────
  private bindCamera(): void {
    const stage = this.app.stage;

    stage.on("pointerdown", (e: FederatedPointerEvent) => {
      // 멀티터치 핀치 시작 무시(브라우저 기본 핀치는 별도 처리 안 함 — 단일 포인터 팬)
      this.dragging = true;
      this.dragMoved = false;
      this.dragStartX = e.global.x;
      this.dragStartY = e.global.y;
      this.dragCamX = this.camX;
      this.dragCamY = this.camY;
    });

    stage.on("pointermove", (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      const dx = e.global.x - this.dragStartX;
      const dy = e.global.y - this.dragStartY;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.dragMoved = true;
      this.camX = this.dragCamX + dx;
      this.camY = this.dragCamY + dy;
    });

    const endDrag = () => {
      this.dragging = false;
    };
    stage.on("pointerup", endDrag);
    stage.on("pointerupoutside", endDrag);

    // 빈 바닥 탭 → 선택 해제(드래그가 아니었을 때만).
    stage.on("pointertap", () => {
      if (!this.dragMoved) this.game.clearSelection();
    });

    // 휠 줌 — 커서 지점을 기준으로 줌(앵커 유지).
    this.app.canvas.addEventListener(
      "wheel",
      (ev: WheelEvent) => {
        ev.preventDefault();
        const rect = this.app.canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        this.zoomAt(px, py, Math.exp(-ev.deltaY * ZOOM_STEP));
      },
      { passive: false },
    );

    // 핀치 줌(터치 2점).
    this.app.canvas.addEventListener("touchmove", (ev: TouchEvent) => {
      if (ev.touches.length !== 2) return;
      ev.preventDefault();
      const [a, b] = [ev.touches[0], ev.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const rect = this.app.canvas.getBoundingClientRect();
      const cx = (a.clientX + b.clientX) / 2 - rect.left;
      const cy = (a.clientY + b.clientY) / 2 - rect.top;
      if (this.pinchDist > 0) this.zoomAt(cx, cy, dist / this.pinchDist);
      this.pinchDist = dist;
      this.dragging = false; // 핀치 중 팬 취소
    }, { passive: false });
    this.app.canvas.addEventListener("touchend", () => { this.pinchDist = 0; });

    // 우클릭 메뉴 억제(드래그 편의)
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // 화면 (px,py) 지점을 기준으로 factor 만큼 줌(앵커 고정).
  private zoomAt(px: number, py: number, factor: number): void {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * factor));
    const k = next / this.zoom;
    if (k === 1) return;
    // 앵커 유지: cam' = anchor - k*(anchor - cam)
    this.camX = px - k * (px - this.camX);
    this.camY = py - k * (py - this.camY);
    this.zoom = next;
  }

  // 초기 1회: 맵 전체가 보이도록 줌/센터 맞춤.
  private fitToScreen(): void {
    const cells = this.game.layout.groundCells();
    if (cells.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of cells) {
      const p = cellToScreen(c.col, c.row);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    // 타일/건물 높이 여유 패딩.
    const padX = 140;
    const padTop = 160; // 건물이 위로 솟음
    const padBot = 80;
    const w = maxX - minX + padX * 2;
    const h = maxY - minY + padTop + padBot;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(sw / w, sh / h)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.camX = sw / 2 - cx * this.zoom;
    this.camY = sh / 2 - cy * this.zoom;
    this.fitted = true;
  }

  // ── 메인 프레임 ─────────────────────────────────────────────
  update(dtMS: number): void {
    this.elapsed += dtMS;
    if (!this.fitted) this.fitToScreen();

    // 카메라 적용
    this.world.position.set(this.camX, this.camY);
    this.world.scale.set(this.zoom);

    this.syncBuildings();
    this.syncGuests(dtMS);
    this.drainPops();
    this.updatePops(dtMS);
    this.updateSnow(dtMS);
  }

  // ── 시설 동기 ───────────────────────────────────────────────
  private syncBuildings(): void {
    const sel = this.game.selection;
    const seen = new Set<string>();

    for (const b of this.game.manager.buildings) {
      seen.add(b.id);
      let view = this.buildingViews.get(b.id);
      const screen = this.game.layout.screenOf(b.id);
      if (!screen) continue;

      if (!view) view = this.createBuildingView(b, screen);
      this.updateBuildingView(view, b, screen, sel.kind === "building" && sel.id === b.id);
    }

    // 사라진 시설 제거(현재 코어는 철거 없음이지만 방어적으로).
    for (const [id, view] of this.buildingViews) {
      if (!seen.has(id)) {
        view.root.destroy({ children: true });
        this.buildingViews.delete(id);
      }
    }
  }

  private createBuildingView(b: Building, screen: Pt): BuildingView {
    const look = this.game.describeBuilding(b);
    const root = new Container();
    root.position.set(screen.x, screen.y);

    const selection = makeSelectionTile();
    selection.visible = false;
    root.addChild(selection);

    const sprite = makeBuildingSprite(look);
    root.addChild(sprite);

    // 이름 라벨(건물 위). 베이스 기준 위로.
    const nameLabel = new Text({
      text: look.emoji + " " + look.name,
      style: {
        fontFamily: LABEL_FONT,
        fontSize: 12,
        fill: 0xffffff,
        fontWeight: "700",
        align: "center",
        stroke: { color: 0x0b1f3a, width: 3 }, // 가독성 외곽선
      },
    });
    nameLabel.anchor.set(0.5, 0.5);
    nameLabel.position.set(0, -118);
    nameLabel.resolution = 2;
    root.addChild(nameLabel);

    // 점유 배지(베이스 아래쪽).
    const badge = label("0/0", 11, 0xffffff, "700");
    badge.position.set(0, 14);
    badge.resolution = 2;
    root.addChild(badge);

    // 진행 오버레이(건설/업그레이드).
    const progress = new Container();
    const progDim = new Graphics();
    const progBar = new Graphics();
    progress.addChild(progDim, progBar);
    progress.visible = false;
    root.addChild(progress);

    const view: BuildingView = {
      root,
      sprite,
      selection,
      badge,
      nameLabel,
      progress,
      progBar,
      progDim,
      lastPhase: null,
    };

    // 상호작용 — 스프라이트 영역 탭으로 선택.
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.game.select("building", b.id);
    });

    this.entityLayer.addChild(root);
    this.buildingViews.set(b.id, view);
    return view;
  }

  private updateBuildingView(view: BuildingView, b: Building, screen: Pt, selected: boolean): void {
    view.root.position.set(screen.x, screen.y);
    view.root.zIndex = screen.y; // 화면 y 깊이정렬

    const active = b.phase === BuildingPhase.Active && b.isActive;
    const constructing = b.phase !== BuildingPhase.Active;

    // 점유 배지
    view.badge.text = b.capacity > 0 ? `${b.occupancy}/${b.capacity}` : "";
    view.badge.visible = active && b.capacity > 0;

    // 선택 강조
    view.selection.visible = selected;

    // 진행 오버레이(건설/업그레이드)
    if (constructing) {
      const total = b.buildTime > 0 ? b.buildTime : 1;
      const done = Math.max(0, Math.min(1, 1 - b.buildTimer / total));
      view.progress.visible = true;
      // 반투명 덮개(시설 전체를 살짝 덮음)
      if (view.lastPhase !== b.phase) {
        view.progDim.clear();
        view.progDim.roundRect(-46, -132, 92, 150, 10).fill({ color: 0x0b1f3a, alpha: 0.32 });
      }
      // 진행 바
      view.progBar.clear();
      const bw = 64;
      const bx = -bw / 2;
      const by = -150;
      view.progBar.roundRect(bx - 2, by - 2, bw + 4, 12, 4).fill({ color: 0x0b1f3a, alpha: 0.55 });
      view.progBar.roundRect(bx, by, bw, 8, 3).fill({ color: 0x274a73, alpha: 0.9 });
      view.progBar.roundRect(bx, by, bw * done, 8, 3).fill(0x5fe3a0);
      view.sprite.alpha = 0.6;
      view.sprite.tint = 0xaccbe6;
    } else {
      view.progress.visible = false;
      view.sprite.alpha = 1;
      // 청결/마모 낮으면 칙칙하게. cleanliness 낮거나 wear 높으면 회색 틴트.
      const grime = Math.max((100 - b.cleanliness) / 100, b.wear / 100);
      if (grime > 0.35) {
        // 흰색 1.0 → 칙칙한 회청색으로 보간
        const t = Math.min(0.45, (grime - 0.35) * 0.8);
        const c = 255 - Math.round(t * 90);
        view.sprite.tint = (c << 16) | (c << 8) | Math.max(c - 10, 0);
      } else {
        view.sprite.tint = 0xffffff;
      }
    }
    view.lastPhase = b.phase;
  }

  // ── 손님 동기 ───────────────────────────────────────────────
  private syncGuests(dtMS: number): void {
    const sel = this.game.selection;
    const seen = new Set<string>();
    const entrance = this.game.layout.entranceScreen();

    for (const g of this.game.manager.guests) {
      seen.add(g.id);
      let view = this.guestViews.get(g.id);
      if (!view) view = this.createGuestView(g, entrance);
      this.updateGuestView(view, g, entrance, dtMS, sel.kind === "guest" && sel.id === g.id);
    }

    // 목록에서 사라진 손님 → 페이드아웃 후 제거.
    for (const [id, view] of this.guestViews) {
      if (!seen.has(id)) view.removing = true;
      if (view.removing) {
        view.fade -= dtMS / 360;
        view.root.alpha = Math.max(0, view.fade);
        view.root.y -= dtMS * 0.02; // 살짝 떠오르며 사라짐
        if (view.fade <= 0) {
          view.root.destroy({ children: true });
          this.guestViews.delete(id);
        }
      }
    }
  }

  private createGuestView(g: Guest, entrance: Pt): GuestView {
    const skin = SPECIES[g.species] ?? SPECIES[0];
    const root = new Container();

    const shadow = makeShadow(26 * skin.scale, 12 * skin.scale);
    shadow.alpha = 0.9;
    root.addChild(shadow);

    const sprite = makePenguin({ body: skin.body, belly: skin.belly, accent: skin.accent, scale: skin.scale });
    root.addChild(sprite);

    // 머리 위 욕구 말풍선 + patience 바.
    const bubble = new Container();
    const bubbleBg = new Graphics();
    bubbleBg.roundRect(-13, -13, 26, 22, 8).fill({ color: 0xffffff, alpha: 0.92 });
    bubbleBg.poly([-4, 8, 4, 8, 0, 14]).fill({ color: 0xffffff, alpha: 0.92 });
    bubble.addChild(bubbleBg);
    const bubbleEmoji = label("❓", 14, 0x000000, "400");
    bubbleEmoji.position.set(0, -2);
    bubble.addChild(bubbleEmoji);
    const patienceBar = new Graphics();
    bubble.addChild(patienceBar);
    const headY = -40 * skin.scale - 14;
    bubble.position.set(0, headY);
    root.addChild(bubble);

    const cold = label("🥶", 13, 0x000000, "400");
    cold.position.set(13, headY);
    cold.visible = false;
    root.addChild(cold);

    const serveRing = new Graphics();
    serveRing.position.set(0, -20 * skin.scale);
    serveRing.visible = false;
    root.addChild(serveRing);

    const view: GuestView = {
      root,
      sprite,
      shadow,
      bubble,
      bubbleEmoji,
      patienceBar,
      cold,
      serveRing,
      pos: { x: entrance.x, y: entrance.y },
      target: { x: entrance.x, y: entrance.y },
      wobble: Math.random() * Math.PI * 2,
      fade: 1,
      removing: false,
      scale: skin.scale,
      bornAt: this.elapsed,
    };

    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.game.select("guest", g.id);
    });

    this.entityLayer.addChild(root);
    this.guestViews.set(g.id, view);
    return view;
  }

  private updateGuestView(view: GuestView, g: Guest, entrance: Pt, dtMS: number, selected: boolean): void {
    // 목표 위치 결정 — phase 별.
    const target = this.guestTarget(g, entrance);
    view.target = target;

    // 부드러운 follow.
    const k = smoothK(dtMS, 0.011);
    view.pos = lerpPt(view.pos, target, k);

    view.root.position.set(view.pos.x, view.pos.y);
    view.root.zIndex = view.pos.y + 1; // 같은 y면 손님이 시설보다 약간 위

    // 이동 속도 → waddle 강도.
    const dx = target.x - view.pos.x;
    const dy = target.y - view.pos.y;
    const speed = Math.hypot(dx, dy);
    const moving = g.phase === GuestPhase.Moving || g.phase === GuestPhase.Leaving || g.phase === GuestPhase.AngryLeaving;
    const waddleAmp = moving ? Math.min(1, speed / 30) : 0.18;
    view.wobble += (dtMS / 1000) * (moving ? 12 : 4);
    view.sprite.rotation = Math.sin(view.wobble) * 0.14 * waddleAmp;
    const bob = Math.abs(Math.sin(view.wobble)) * 0.05 * waddleAmp;
    view.sprite.scale.set(view.scale * (1 + bob), view.scale * (1 - bob));
    // 진행 방향에 따라 좌우 반전(오른쪽 이동이면 그대로).
    if (Math.abs(dx) > 2) view.sprite.scale.x = Math.abs(view.sprite.scale.x) * (dx < 0 ? -1 : 1);

    // 저체온 → 파랗게 틴트 + 🥶
    const cold = g.bodyWarmth < 45;
    view.cold.visible = cold && (g.phase === GuestPhase.Waiting || g.phase === GuestPhase.Arriving || g.phase === GuestPhase.Moving);
    view.sprite.tint = cold ? 0x9fd0ff : 0xffffff;

    // 말풍선(현재 욕구) — Waiting/Arriving 에서만.
    const need = g.currentNeed;
    const showBubble =
      (g.phase === GuestPhase.Waiting || g.phase === GuestPhase.Arriving) && need != null;
    view.bubble.visible = showBubble;
    if (showBubble && need) {
      const skin = NEEDS[need.type];
      view.bubbleEmoji.text = skin ? skin.emoji : "❓";
      // patience 바: 초록→빨강.
      const ratio = g.maxPatience > 0 ? Math.max(0, Math.min(1, g.patience / g.maxPatience)) : 1;
      view.patienceBar.clear();
      const bw = 22;
      const bx = -bw / 2;
      const by = 11;
      view.patienceBar.roundRect(bx - 1, by - 1, bw + 2, 5, 2).fill({ color: 0x0b1f3a, alpha: 0.5 });
      const col = this.lerpColor(0xff4d4d, 0x49d17a, ratio);
      view.patienceBar.roundRect(bx, by, bw * ratio, 3, 1.5).fill(col);
    }

    // BeingServed → 서빙 진행 링.
    const serving = g.phase === GuestPhase.BeingServed;
    view.serveRing.visible = serving;
    if (serving && g.currentBuilding) {
      const total = g.currentBuilding.serveTime > 0 ? g.currentBuilding.serveTime : 1;
      const prog = Math.max(0, Math.min(1, 1 - g.stepTimer / total));
      view.serveRing.clear();
      const r = 9;
      view.serveRing.circle(0, 0, r).stroke({ width: 3, color: 0x0b1f3a, alpha: 0.4 });
      // 진행 호를 다각형으로 근사.
      const segs = 24;
      const pts: number[] = [0, 0];
      const end = Math.floor(segs * prog);
      for (let i = 0; i <= end; i++) {
        const a = -Math.PI / 2 + (i / segs) * Math.PI * 2;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      if (end >= 1) view.serveRing.poly(pts).fill({ color: 0x5fe3a0, alpha: 0.85 });
    }

    // 선택 표시 — 발밑 그림자를 노랗게 키워 강조.
    view.shadow.tint = selected ? 0xffd23f : 0xffffff;
    view.shadow.scale.set(selected ? 1.25 : 1);
  }

  // phase → 목표 스크린좌표.
  private guestTarget(g: Guest, entrance: Pt): Pt {
    switch (g.phase) {
      case GuestPhase.Arriving:
      case GuestPhase.Waiting: {
        // 입구 근처 로비에 안정적 슬롯(guestId 해시).
        const slot = this.hashSlot(g.id);
        return { x: entrance.x + slot.dx, y: entrance.y + slot.dy };
      }
      case GuestPhase.Moving:
      case GuestPhase.BeingServed: {
        const b = g.currentBuilding;
        if (b) {
          const s = this.game.layout.screenOf(b.id);
          if (s) {
            // 시설 앞 살짝 아래(입구 쪽)에 정지.
            const off = this.hashSlot(g.id, 18);
            return { x: s.x + off.dx * 0.5, y: s.y + 16 + off.dy * 0.3 };
          }
        }
        return { x: entrance.x, y: entrance.y };
      }
      case GuestPhase.Checkout:
      case GuestPhase.Leaving:
      case GuestPhase.AngryLeaving:
      case GuestPhase.Done:
      default: {
        // 입구 너머 아래로 퇴장.
        return { x: entrance.x + 10, y: entrance.y + 70 };
      }
    }
  }

  // guestId 해시 → 입구 주변 안정적 클러스터 오프셋.
  private hashSlot(id: string, radius = 40): { dx: number; dy: number } {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = h >>> 0;
    const ring = (h & 3) + 1; // 1~4 줄
    const ang = ((h >>> 2) % 360) * (Math.PI / 180);
    const r = radius * 0.5 + ring * (radius * 0.28);
    return { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r * (TILE_H / 124) * 2.2 - ring * 4 };
  }

  // ── 팝(떠오르는 숫자) ───────────────────────────────────────
  private drainPops(): void {
    const entrance = this.game.layout.entranceScreen();
    const popped = this.game.pops.splice(0, this.game.pops.length);
    for (const p of popped) {
      const view = this.guestViews.get(p.guestId);
      const at = view ? view.pos : entrance;
      const isCoin = p.kind === "coin";
      const txt = label(
        isCoin ? `+${p.amount}💰` : `-${p.amount}⭐`,
        16,
        isCoin ? 0xffd23f : 0xff5a5a,
        "700",
      );
      txt.resolution = 2;
      txt.position.set(at.x, at.y - 44);
      txt.zIndex = 9999;
      this.fxLayer.addChild(txt);
      this.pops.push({ text: txt, x: at.x, y: at.y - 44, age: 0 });
    }
  }

  private updatePops(dtMS: number): void {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dtMS;
      const t = p.age / POP_LIFE;
      if (t >= 1) {
        p.text.destroy();
        this.pops.splice(i, 1);
        continue;
      }
      p.text.position.set(p.x, p.y - POP_RISE * t);
      p.text.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const s = 0.8 + Math.min(t * 3, 1) * 0.25;
      p.text.scale.set(s);
    }
  }

  // ── 앰비언트 눈 + 러시 톤 ───────────────────────────────────
  private updateSnow(dtMS: number): void {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const rush = this.game.isRush;
    const dt = dtMS / 1000;
    const speedMul = rush ? 1.7 : 1;

    for (const s of this.snow) {
      s.sway += s.swaySpeed * dt;
      s.y += s.vy * dt * speedMul;
      s.x += (s.vx + Math.sin(s.sway) * 14) * dt / sw;
      // 픽셀로 환산해 화면 밖이면 위로 리셋.
      let py = s.y;
      if (py > sh + 10) {
        s.y = -10;
        s.x = Math.random();
        py = -10;
      } else {
        s.y = py;
      }
      // x 는 0~1 정규화로 다루다가 픽셀 변환(가로 래핑).
      let nx = s.x;
      if (nx < -0.05) nx += 1.1;
      if (nx > 1.05) nx -= 1.1;
      s.x = nx;
      s.g.position.set(nx * sw, py);
      s.g.alpha = rush ? 0.5 : 0.7;
    }

    // 러시 중 살짝 따뜻한 톤 오버레이(스테이지 배경은 못 바꾸니 스노레이어 알파로 분위기).
    // (배경 자체는 main.ts 가 고정 — 과한 연출 지양)
  }

  // 색 보간(0~1).
  private lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const c = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | c;
  }
}
