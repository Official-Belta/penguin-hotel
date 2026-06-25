// GameUI — 남극 그랜드 호텔의 HTML/CSS 게임 크롬(헤더·빌드패널·컨텍스트·로그).
// Hay Day / Township 무드: 따뜻한 크림/우드/하늘색, 통통한 라운드 버튼, 부드러운 그림자.
// 프레임워크 없음(순수 DOM/TS). main.ts 가 100ms 마다 update() 호출.
// world/ui 는 GameApp 공개 API 하나만 참조한다.

import type { GameApp } from "../game/gameApp";
import { NEEDS, EVENTS, type BuildCategory } from "../game/display";
import { GuestPhase, BuildingPhase, NeedType, EventType } from "../core/models/enums";
import type { Building } from "../core/models/building";
import type { Guest } from "../core/models/guest";

// 카테고리 메타(좌측 빌드 탭 순서/아이콘/한글명).
const CATEGORIES: { key: BuildCategory; emoji: string; label: string }[] = [
  { key: "room", emoji: "🛏️", label: "객실" },
  { key: "fnb", emoji: "🍤", label: "식음" },
  { key: "amenity", emoji: "🎉", label: "편의" },
  { key: "ops", emoji: "🔥", label: "운영" },
  { key: "circulation", emoji: "🛗", label: "동선" },
];

const STYLE_ID = "hlkr-gameui-style";

export class GameUI {
  private readonly game: GameApp;
  private readonly root: HTMLElement;

  // 빌드 패널 상태(열린 카테고리 / null = 접힘).
  private openCat: BuildCategory | null = null;

  // 캐싱된 DOM 핸들.
  private elCoin!: HTMLElement;
  private elGem!: HTMLElement;
  private elRep!: HTMLElement;
  private elStars!: HTMLElement;
  private elWarmthFill!: HTMLElement;
  private elWarmthChip!: HTMLElement;
  private elUpkeep!: HTMLElement;
  private elBadges!: HTMLElement;
  private elOpenBtn!: HTMLElement;
  private elSpeed: Record<number, HTMLElement> = {};
  private elPauseBtn!: HTMLElement;

  private elBuildTabs!: HTMLElement;
  private elBuildCards!: HTMLElement;

  private elContext!: HTMLElement;
  private elLog!: HTMLElement;

  // 변경 감지로 카드 리스트를 불필요하게 재빌드하지 않기 위한 캐시 키.
  private cardsKey = "";

  constructor(root: HTMLElement, game: GameApp) {
    this.root = root;
    this.game = game;
    this.injectStyle();
    this.build();
    this.update();
  }

  // ── 셸 구성 ────────────────────────────────────────────────
  private build(): void {
    const wrap = document.createElement("div");
    wrap.className = "hlkr-ui";
    wrap.innerHTML = this.shellHTML();
    this.root.appendChild(wrap);

    // 핸들 바인딩.
    const q = <T extends HTMLElement = HTMLElement>(s: string) => wrap.querySelector(s) as T;
    this.elCoin = q(".hlkr-coin .v");
    this.elGem = q(".hlkr-gem .v");
    this.elRep = q(".hlkr-rep .v");
    this.elStars = q(".hlkr-stars");
    this.elWarmthFill = q(".hlkr-warmth-fill");
    this.elWarmthChip = q(".hlkr-warmth");
    this.elUpkeep = q(".hlkr-upkeep .v");
    this.elBadges = q(".hlkr-badges");
    this.elOpenBtn = q(".hlkr-open");
    this.elPauseBtn = q(".hlkr-pause");
    this.elBuildTabs = q(".hlkr-build-tabs");
    this.elBuildCards = q(".hlkr-build-cards");
    this.elContext = q(".hlkr-context");
    this.elLog = q(".hlkr-log");

    // 배속 버튼.
    for (const n of [1, 2, 3]) {
      const b = q<HTMLElement>(`.hlkr-spd[data-n="${n}"]`);
      this.elSpeed[n] = b;
      b.addEventListener("click", () => this.game.setSpeed(n));
    }
    this.elPauseBtn.addEventListener("click", () => this.game.togglePause());
    this.elOpenBtn.addEventListener("click", () => this.game.toggleOpen());

    // 빌드 탭.
    for (const c of CATEGORIES) {
      const tab = document.createElement("button");
      tab.className = "hlkr-tab";
      tab.dataset.cat = c.key;
      tab.innerHTML = `<span class="ic">${c.emoji}</span><span class="lb">${c.label}</span>`;
      tab.addEventListener("click", () => {
        this.openCat = this.openCat === c.key ? null : c.key;
        this.cardsKey = ""; // 강제 재빌드
        this.renderBuildPanel();
      });
      this.elBuildTabs.appendChild(tab);
    }

    // 컨텍스트 닫기(이벤트 위임).
    this.elContext.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".hlkr-ctx-close")) this.game.clearSelection();
      else if (t.closest(".hlkr-act-up")) this.game.upgradeSelected();
      else if (t.closest(".hlkr-act-clean")) {
        const b = this.game.selectedBuilding();
        if (b) this.game.manager.maintenance.clean(b);
      } else if (t.closest(".hlkr-act-fix")) {
        const b = this.game.selectedBuilding();
        if (b) this.game.manager.maintenance.repair(b);
      }
    });
  }

  private shellHTML(): string {
    return `
      <!-- 상단 자원바 -->
      <div class="hlkr-topbar">
        <div class="hlkr-res">
          <div class="hlkr-chip hlkr-coin"><span class="e">💰</span><span class="v">0</span></div>
          <div class="hlkr-chip hlkr-gem"><span class="e">💎</span><span class="v">0</span></div>
          <div class="hlkr-chip hlkr-rep">
            <span class="e">⭐</span><span class="v">0</span>
            <span class="hlkr-stars"></span>
          </div>
        </div>
        <div class="hlkr-mid">
          <div class="hlkr-chip hlkr-warmth">
            <span class="e">❄️</span>
            <div class="hlkr-warmth-bar"><div class="hlkr-warmth-fill"></div></div>
          </div>
          <div class="hlkr-chip hlkr-upkeep"><span class="e">🪙</span><span class="v">0</span><span class="u">/분</span></div>
          <div class="hlkr-badges"></div>
        </div>
        <div class="hlkr-ctrls">
          <button class="hlkr-open">영업</button>
          <div class="hlkr-speeds">
            <button class="hlkr-spd" data-n="1">1×</button>
            <button class="hlkr-spd" data-n="2">2×</button>
            <button class="hlkr-spd" data-n="3">3×</button>
            <button class="hlkr-pause">⏸</button>
          </div>
        </div>
      </div>

      <!-- 좌측 빌드 패널 -->
      <div class="hlkr-build">
        <div class="hlkr-build-tabs"></div>
        <div class="hlkr-build-cards"></div>
      </div>

      <!-- 우측 컨텍스트 패널 -->
      <div class="hlkr-context"></div>

      <!-- 하단 로그 -->
      <div class="hlkr-log"></div>
    `;
  }

  // ── 매 100ms 갱신 ──────────────────────────────────────────
  update(): void {
    const g = this.game;

    // 자원.
    this.elCoin.textContent = fmt(g.coin);
    this.elGem.textContent = fmt(g.gem);
    this.elRep.textContent = fmt(g.reputation);
    this.renderStars(g.stars);

    // 난방 게이지.
    const cov = g.warmthCoverage;
    this.elWarmthFill.style.width = Math.round(cov * 100) + "%";
    const cold = cov < 0.34;
    this.elWarmthFill.classList.toggle("warn", cold);
    this.elWarmthChip.classList.toggle("warn", cold);

    // 운영비.
    this.elUpkeep.textContent = fmt(g.upkeepPerMin);

    // 배지(러시/이벤트).
    this.renderBadges();

    // 영업 토글.
    const open = g.isOpen;
    this.elOpenBtn.textContent = open ? "영업중" : "휴장";
    this.elOpenBtn.classList.toggle("on", open);
    this.elOpenBtn.classList.toggle("off", !open);

    // 배속/일시정지.
    for (const n of [1, 2, 3]) {
      this.elSpeed[n].classList.toggle("active", !g.paused && g.speed === n);
    }
    this.elPauseBtn.classList.toggle("active", g.paused);

    // 빌드 카드(코인 변동에 따른 활성/비활성 반영).
    this.renderBuildPanel();

    // 컨텍스트.
    this.renderContext();

    // 로그.
    this.renderLog();
  }

  // ── 별 ────────────────────────────────────────────────────
  private renderStars(stars: number): void {
    let s = "";
    for (let i = 0; i < 5; i++) s += i < stars ? "★" : "☆";
    if (this.elStars.textContent !== s) this.elStars.textContent = s;
  }

  // ── 배지 ──────────────────────────────────────────────────
  private renderBadges(): void {
    const parts: string[] = [];
    if (this.game.isRush) parts.push(`<span class="hlkr-badge rush">🔥 러시</span>`);
    const ev = this.game.activeEvent;
    if (ev != null) {
      const meta = EVENTS[ev as EventType];
      if (meta) parts.push(`<span class="hlkr-badge event">${meta.emoji} ${meta.name}</span>`);
    }
    const html = parts.join("");
    if (this.elBadges.innerHTML !== html) this.elBadges.innerHTML = html;
  }

  // ── 좌측 빌드 패널 ─────────────────────────────────────────
  private renderBuildPanel(): void {
    // 탭 활성 표시.
    for (const tab of Array.from(this.elBuildTabs.children) as HTMLElement[]) {
      tab.classList.toggle("active", tab.dataset.cat === this.openCat);
    }

    if (this.openCat == null) {
      if (this.elBuildCards.classList.contains("open")) {
        this.elBuildCards.classList.remove("open");
        this.elBuildCards.innerHTML = "";
        this.cardsKey = "";
      }
      return;
    }

    const coin = this.game.coin;
    const opts = this.game.buildOptions().filter((o) => o.category === this.openCat);

    // 구조 키(카테고리+해금 상태)가 같으면 카드 재생성 생략, 상태 클래스만 갱신.
    const structKey = this.openCat + "|" + opts.map((o) => o.key + (o.unlocked ? "1" : "0")).join(",");
    if (structKey !== this.cardsKey) {
      this.cardsKey = structKey;
      this.elBuildCards.classList.add("open");
      this.elBuildCards.innerHTML = "";
      for (const o of opts) {
        const card = document.createElement("button");
        card.className = "hlkr-card";
        card.dataset.key = o.key;
        if (!o.unlocked) {
          card.classList.add("locked");
          card.innerHTML =
            `<span class="ce">${o.emoji}</span>` +
            `<span class="cn">${o.name}</span>` +
            `<span class="cc lock">🔒 ★${o.unlockRep}</span>`;
        } else {
          card.innerHTML =
            `<span class="ce">${o.emoji}</span>` +
            `<span class="cn">${o.name}</span>` +
            `<span class="cc">💰${fmt(o.cost)}</span>`;
          card.addEventListener("click", () => this.game.tryBuild(o.key));
        }
        this.elBuildCards.appendChild(card);
      }
    }

    // 매 프레임: 코인 부족 비활성 토글.
    const byKey = new Map(opts.map((o) => [o.key, o]));
    for (const card of Array.from(this.elBuildCards.children) as HTMLElement[]) {
      const o = byKey.get(card.dataset.key || "");
      if (!o || !o.unlocked) continue;
      card.classList.toggle("poor", coin < o.cost);
    }
  }

  // ── 우측 컨텍스트 패널 ─────────────────────────────────────
  private renderContext(): void {
    const b = this.game.selectedBuilding();
    const guest = this.game.selectedGuest();

    if (!b && !guest) {
      if (this.elContext.classList.contains("show")) {
        this.elContext.classList.remove("show");
        this.elContext.innerHTML = "";
      }
      return;
    }
    this.elContext.classList.add("show");
    if (b) this.elContext.innerHTML = this.buildingCtxHTML(b);
    else if (guest) this.elContext.innerHTML = this.guestCtxHTML(guest);
  }

  private buildingCtxHTML(b: Building): string {
    const look = this.game.describeBuilding(b);
    const clean = Math.round(b.cleanliness);
    const wear = Math.round(b.wear);
    const phase = b.phase;
    const busy = phase !== BuildingPhase.Active;
    const phaseLabel =
      phase === BuildingPhase.UnderConstruction
        ? "🚧 건설중"
        : phase === BuildingPhase.Upgrading
          ? "⬆️ 업그레이드중"
          : "";
    const cleanWarn = clean < 50 ? "warn" : "";
    const wearWarn = wear > 60 ? "warn" : "";

    return `
      <div class="hlkr-ctx-head">
        <span class="hlkr-ctx-emoji">${look.emoji}</span>
        <div class="hlkr-ctx-title">
          <div class="n">${look.name}</div>
          <div class="s">Lv.${b.level}${phaseLabel ? " · " + phaseLabel : ""}</div>
        </div>
        <button class="hlkr-ctx-close">✕</button>
      </div>
      <div class="hlkr-ctx-body">
        <div class="hlkr-stat"><span class="k">점유</span><span class="vv">${b.occupancy} / ${b.capacity}</span></div>
        <div class="hlkr-stat"><span class="k">응대시간</span><span class="vv">${b.serveTime.toFixed(1)}s</span></div>
        <div class="hlkr-gaugerow ${cleanWarn}">
          <span class="gk">🧹 청결</span>
          <div class="hlkr-gauge"><div class="gf clean" style="width:${clean}%"></div></div>
          <span class="gv">${clean}</span>
        </div>
        <div class="hlkr-gaugerow ${wearWarn}">
          <span class="gk">🔧 마모</span>
          <div class="hlkr-gauge"><div class="gf wear" style="width:${wear}%"></div></div>
          <span class="gv">${wear}</span>
        </div>
      </div>
      <div class="hlkr-ctx-acts">
        <button class="hlkr-act hlkr-act-up" ${busy ? "disabled" : ""}>⬆️ 업그레이드 <b>💰${fmt(b.upgradeCost)}</b></button>
        <div class="hlkr-act-row">
          <button class="hlkr-act sm hlkr-act-clean">🧹 청소</button>
          <button class="hlkr-act sm hlkr-act-fix">🔧 수리</button>
        </div>
      </div>
    `;
  }

  private guestCtxHTML(g: Guest): string {
    const name = this.game.speciesName(g);
    const need = g.currentNeed;
    const needMeta = need ? NEEDS[need.type as NeedType] : null;
    const total = g.itinerary ? g.itinerary.length : 0;
    const step = Math.min(g.stepIndex + 1, total);
    const pat = g.maxPatience > 0 ? Math.max(0, Math.min(1, g.patience / g.maxPatience)) : 0;
    const patWarn = pat < 0.34 ? "warn" : "";
    const warmth = Math.max(0, Math.min(100, Math.round(g.bodyWarmth)));
    const warmthWarn = warmth < 40 ? "warn" : "";
    const phaseLabel = GUEST_PHASE_LABEL[g.phase] ?? "";

    const needHTML = needMeta
      ? `<span class="needpill">${needMeta.emoji} ${needMeta.name}</span>`
      : `<span class="needpill done">✅ 여정완료</span>`;

    return `
      <div class="hlkr-ctx-head">
        <span class="hlkr-ctx-emoji">${SPECIES_EMOJI(g)}</span>
        <div class="hlkr-ctx-title">
          <div class="n">${name}</div>
          <div class="s">${phaseLabel}</div>
        </div>
        <button class="hlkr-ctx-close">✕</button>
      </div>
      <div class="hlkr-ctx-body">
        <div class="hlkr-stat"><span class="k">현재 욕구</span><span class="vv">${needHTML}</span></div>
        <div class="hlkr-stat"><span class="k">여정</span><span class="vv">${step} / ${total || "-"}</span></div>
        <div class="hlkr-gaugerow ${patWarn}">
          <span class="gk">⏳ 인내심</span>
          <div class="hlkr-gauge"><div class="gf pat" style="width:${Math.round(pat * 100)}%"></div></div>
        </div>
        <div class="hlkr-gaugerow ${warmthWarn}">
          <span class="gk">🌡️ 체온</span>
          <div class="hlkr-gauge"><div class="gf warm" style="width:${warmth}%"></div></div>
          <span class="gv">${warmth}</span>
        </div>
      </div>
    `;
  }

  // ── 하단 로그 ──────────────────────────────────────────────
  private renderLog(): void {
    const log = this.game.log;
    const last = log.slice(-6);
    const html = last.map((l) => `<div class="hlkr-logline">${escapeHTML(l)}</div>`).join("");
    if (this.elLog.innerHTML !== html) {
      this.elLog.innerHTML = html;
    }
  }

  // ── CSS 주입 ───────────────────────────────────────────────
  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
}

// ── 헬퍼 ────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n == null || isNaN(n)) return "0";
  return Math.round(n).toLocaleString("ko-KR");
}
function escapeHTML(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

// 손님 종 이모지(display SPECIES 직접 참조는 game 헬퍼 우회 — 이모지만 필요).
import { SPECIES } from "../game/display";
function SPECIES_EMOJI(g: Guest): string {
  return SPECIES[g.species]?.emoji ?? "🐧";
}

const GUEST_PHASE_LABEL: Partial<Record<GuestPhase, string>> = {
  [GuestPhase.Arriving]: "🚶 도착 중",
  [GuestPhase.Waiting]: "⏳ 대기 중",
  [GuestPhase.Moving]: "🚶 이동 중",
  [GuestPhase.BeingServed]: "🛎️ 이용 중",
  [GuestPhase.Checkout]: "🧾 체크아웃",
  [GuestPhase.Leaving]: "👋 만족 퇴장",
  [GuestPhase.AngryLeaving]: "😡 화나서 퇴장",
  [GuestPhase.Done]: "—",
};

// 미사용 import 가드(트리쉐이킹 대비 — NeedType/EventType 은 위에서 캐스팅에 사용).
void NeedType;
void EventType;

// ── CSS (Hay Day 무드) ─────────────────────────────────────
const CSS = `
.hlkr-ui{
  position:absolute; inset:0; pointer-events:none;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR",sans-serif;
  color:#4a3b2a; -webkit-font-smoothing:antialiased;
  --cream:#fff7e6; --cream2:#ffeecb; --wood:#a9743f; --wood-d:#8a5a2c;
  --sky:#bfe6ff; --sky-d:#7cc4f0; --ink:#4a3b2a; --ink-soft:#7a6a52;
  --green:#7ed29a; --green-d:#46b06f; --red:#ff6b5e; --gold:#ffc23a;
  --shadow:0 6px 0 rgba(120,80,30,.18), 0 10px 22px rgba(60,40,10,.22);
  --panel:rgba(255,250,238,.92);
}
.hlkr-ui *{ box-sizing:border-box; margin:0; padding:0; }
.hlkr-ui button{ font-family:inherit; cursor:pointer; border:none; }

/* ── 상단 자원바 ── */
.hlkr-topbar{
  pointer-events:none;
  position:absolute; top:10px; left:10px; right:10px;
  display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
  flex-wrap:wrap;
}
.hlkr-topbar > *{ pointer-events:auto; }
.hlkr-res,.hlkr-mid,.hlkr-ctrls{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

.hlkr-chip{
  display:flex; align-items:center; gap:6px;
  height:44px; padding:0 14px;
  background:var(--panel); backdrop-filter:blur(6px);
  border-radius:16px; border:2px solid rgba(255,255,255,.7);
  box-shadow:var(--shadow);
  font-weight:800; font-size:16px; color:var(--ink);
  white-space:nowrap;
}
.hlkr-chip .e{ font-size:18px; }
.hlkr-chip .v{ font-variant-numeric:tabular-nums; min-width:14px; }
.hlkr-coin{ background:linear-gradient(180deg,#fff8e4,#ffe9b8); }
.hlkr-gem{ background:linear-gradient(180deg,#eafaff,#cdeeff); }
.hlkr-rep{ background:linear-gradient(180deg,#fff3da,#ffe2ad); }
.hlkr-stars{ color:var(--gold); font-size:14px; letter-spacing:1px; text-shadow:0 1px 0 rgba(150,90,0,.25); }

.hlkr-upkeep{ background:linear-gradient(180deg,#fff8ec,#ffedcf); color:var(--ink-soft); font-size:15px; }
.hlkr-upkeep .u{ font-size:12px; color:var(--ink-soft); font-weight:700; margin-left:1px; }

/* 난방 게이지 */
.hlkr-warmth{ gap:8px; background:linear-gradient(180deg,#eef9ff,#d6f0ff); }
.hlkr-warmth-bar{ width:84px; height:14px; border-radius:8px; background:rgba(120,90,40,.16); overflow:hidden; box-shadow:inset 0 1px 2px rgba(0,0,0,.12); }
.hlkr-warmth-fill{ height:100%; width:0%; border-radius:8px; background:linear-gradient(90deg,#7cc4f0,#46b06f); transition:width .25s ease; }
.hlkr-warmth-fill.warn{ background:linear-gradient(90deg,#ff9a3d,#ff5e52); }
.hlkr-warmth.warn{ animation:hlkr-pulse 1s ease-in-out infinite; border-color:rgba(255,107,94,.6); }
@keyframes hlkr-pulse{ 0%,100%{ box-shadow:var(--shadow);} 50%{ box-shadow:0 0 0 3px rgba(255,107,94,.35),var(--shadow);} }

/* 배지 */
.hlkr-badges{ display:flex; gap:6px; }
.hlkr-badge{
  display:inline-flex; align-items:center; height:44px; padding:0 12px;
  border-radius:14px; font-weight:800; font-size:14px; color:#fff;
  box-shadow:var(--shadow); white-space:nowrap;
}
.hlkr-badge.rush{ background:linear-gradient(180deg,#ff8a5b,#ff5e52); }
.hlkr-badge.event{ background:linear-gradient(180deg,#9b7be0,#6f54b0); animation:hlkr-bob 1.4s ease-in-out infinite; }
@keyframes hlkr-bob{ 0%,100%{ transform:translateY(0);} 50%{ transform:translateY(-2px);} }

/* 우측 컨트롤 */
.hlkr-open{
  height:44px; min-width:78px; padding:0 16px; border-radius:16px;
  font-weight:900; font-size:16px; color:#fff;
  box-shadow:var(--shadow); border:2px solid rgba(255,255,255,.6);
}
.hlkr-open.on{ background:linear-gradient(180deg,#86dca0,#46b06f); }
.hlkr-open.off{ background:linear-gradient(180deg,#ffb199,#ff6b5e); }
.hlkr-open:active{ transform:translateY(2px); }

.hlkr-speeds{
  display:flex; gap:4px; align-items:center; height:44px; padding:4px;
  background:var(--panel); border-radius:16px; box-shadow:var(--shadow);
  border:2px solid rgba(255,255,255,.7);
}
.hlkr-spd,.hlkr-pause{
  height:36px; min-width:40px; padding:0 8px; border-radius:11px;
  font-weight:800; font-size:15px; color:var(--ink-soft);
  background:transparent;
}
.hlkr-spd.active,.hlkr-pause.active{
  background:linear-gradient(180deg,#ffe08a,#ffc23a); color:#5a3d00;
  box-shadow:inset 0 -2px 0 rgba(150,90,0,.2);
}
.hlkr-spd:active,.hlkr-pause:active{ transform:translateY(1px); }

/* ── 좌측 빌드 패널 ── */
.hlkr-build{
  pointer-events:none;
  position:absolute; left:10px; top:50%; transform:translateY(-50%);
  display:flex; align-items:center; gap:10px; max-height:78vh;
}
.hlkr-build > *{ pointer-events:auto; }
.hlkr-build-tabs{
  display:flex; flex-direction:column; gap:8px;
  padding:8px; background:var(--panel); border-radius:20px;
  box-shadow:var(--shadow); border:2px solid rgba(255,255,255,.7);
}
.hlkr-tab{
  width:58px; height:58px; border-radius:16px;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;
  background:linear-gradient(180deg,#fff8e9,#ffe9c4); color:var(--ink);
  box-shadow:0 3px 0 rgba(150,100,40,.18);
}
.hlkr-tab .ic{ font-size:24px; line-height:1; }
.hlkr-tab .lb{ font-size:11px; font-weight:800; }
.hlkr-tab.active{ background:linear-gradient(180deg,#ffd98a,#ffbe3c); box-shadow:0 0 0 3px rgba(255,194,58,.4),0 3px 0 rgba(150,100,40,.2); }
.hlkr-tab:active{ transform:translateY(1px); }

.hlkr-build-cards{
  display:none; flex-direction:column; gap:8px;
  max-height:78vh; overflow-y:auto; padding:4px 2px;
  width:0; opacity:0; transition:opacity .18s ease;
  scrollbar-width:thin;
}
.hlkr-build-cards.open{ display:flex; width:auto; opacity:1; animation:hlkr-slidein .2s ease; }
@keyframes hlkr-slidein{ from{ transform:translateX(-10px); opacity:0;} to{ transform:translateX(0); opacity:1;} }

.hlkr-card{
  display:flex; align-items:center; gap:10px;
  width:206px; min-height:56px; padding:8px 12px; border-radius:16px;
  background:var(--panel); backdrop-filter:blur(6px);
  border:2px solid rgba(255,255,255,.7); box-shadow:var(--shadow);
  text-align:left; color:var(--ink);
}
.hlkr-card .ce{ font-size:26px; line-height:1; flex:0 0 auto; }
.hlkr-card .cn{ flex:1 1 auto; font-weight:800; font-size:15px; }
.hlkr-card .cc{ font-weight:900; font-size:14px; color:var(--wood-d); white-space:nowrap; }
.hlkr-card .cc.lock{ color:#a99; }
.hlkr-card:active{ transform:translateY(2px); }
.hlkr-card.locked{ filter:grayscale(.7); opacity:.7; cursor:not-allowed; }
.hlkr-card.poor{ opacity:.55; }
.hlkr-card.poor .cc{ color:var(--red); }

/* ── 우측 컨텍스트 패널 ── */
.hlkr-context{
  pointer-events:none;
  position:absolute; right:10px; top:50%; transform:translateY(-50%);
  width:268px; display:none;
}
.hlkr-context.show{ display:block; pointer-events:auto;
  background:var(--panel); backdrop-filter:blur(8px);
  border-radius:22px; border:2px solid rgba(255,255,255,.75);
  box-shadow:var(--shadow); padding:14px; animation:hlkr-pop .18s ease;
}
@keyframes hlkr-pop{ from{ transform:translate(8px,-50%); opacity:0;} to{ transform:translate(0,-50%); opacity:1;} }

.hlkr-ctx-head{ display:flex; align-items:center; gap:10px; margin-bottom:12px; }
.hlkr-ctx-emoji{ font-size:34px; line-height:1; flex:0 0 auto; }
.hlkr-ctx-title{ flex:1 1 auto; min-width:0; }
.hlkr-ctx-title .n{ font-weight:900; font-size:17px; color:var(--ink); }
.hlkr-ctx-title .s{ font-weight:700; font-size:12px; color:var(--ink-soft); margin-top:1px; }
.hlkr-ctx-close{
  flex:0 0 auto; width:30px; height:30px; border-radius:10px;
  background:rgba(150,100,40,.12); color:var(--ink-soft); font-weight:900; font-size:14px;
}
.hlkr-ctx-close:active{ transform:scale(.92); }

.hlkr-ctx-body{ display:flex; flex-direction:column; gap:9px; margin-bottom:12px; }
.hlkr-stat{ display:flex; align-items:center; justify-content:space-between; font-size:14px; }
.hlkr-stat .k{ color:var(--ink-soft); font-weight:700; }
.hlkr-stat .vv{ font-weight:900; color:var(--ink); }
.needpill{ display:inline-flex; align-items:center; gap:4px; padding:2px 9px; border-radius:10px; font-size:13px; font-weight:800; background:linear-gradient(180deg,#fff3da,#ffe2ad); color:#7a5418; }
.needpill.done{ background:linear-gradient(180deg,#dff7e6,#bfeccd); color:#2f7a4a; }

.hlkr-gaugerow{ display:flex; align-items:center; gap:8px; }
.hlkr-gaugerow .gk{ font-size:12px; font-weight:800; color:var(--ink-soft); flex:0 0 64px; }
.hlkr-gauge{ flex:1 1 auto; height:12px; border-radius:7px; background:rgba(120,90,40,.16); overflow:hidden; box-shadow:inset 0 1px 2px rgba(0,0,0,.12); }
.hlkr-gauge .gf{ height:100%; border-radius:7px; transition:width .25s ease; }
.hlkr-gauge .gf.clean{ background:linear-gradient(90deg,#7fd6e6,#46b0c0); }
.hlkr-gauge .gf.wear{ background:linear-gradient(90deg,#ffd083,#ff9a3d); }
.hlkr-gauge .gf.pat{ background:linear-gradient(90deg,#9fe6b3,#46b06f); }
.hlkr-gauge .gf.warm{ background:linear-gradient(90deg,#ffb27a,#ff7043); }
.hlkr-gaugerow .gv{ flex:0 0 auto; font-size:12px; font-weight:900; color:var(--ink); min-width:22px; text-align:right; }
.hlkr-gaugerow.warn .gk{ color:var(--red); }
.hlkr-gaugerow.warn .gf{ filter:saturate(1.2); }

.hlkr-ctx-acts{ display:flex; flex-direction:column; gap:8px; }
.hlkr-act{
  height:46px; border-radius:15px; font-weight:900; font-size:15px; color:#fff;
  background:linear-gradient(180deg,#86dca0,#46b06f);
  box-shadow:0 4px 0 rgba(40,120,70,.35); border:2px solid rgba(255,255,255,.45);
  display:flex; align-items:center; justify-content:center; gap:6px;
}
.hlkr-act b{ font-weight:900; }
.hlkr-act:active{ transform:translateY(2px); box-shadow:0 2px 0 rgba(40,120,70,.35); }
.hlkr-act[disabled]{ filter:grayscale(.6); opacity:.55; pointer-events:none; }
.hlkr-act-row{ display:flex; gap:8px; }
.hlkr-act.sm{ flex:1 1 0; height:44px; font-size:14px;
  background:linear-gradient(180deg,#fff3da,#ffd98a); color:#6b4910;
  box-shadow:0 4px 0 rgba(150,100,40,.28); }
.hlkr-act.sm:active{ box-shadow:0 2px 0 rgba(150,100,40,.28); }

/* ── 하단 로그 ── */
.hlkr-log{
  pointer-events:none;
  position:absolute; left:50%; bottom:12px; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center; gap:3px;
  max-width:min(560px,80vw);
}
.hlkr-logline{
  font-size:12.5px; font-weight:700; color:#fff;
  background:rgba(40,28,12,.42); backdrop-filter:blur(3px);
  padding:3px 12px; border-radius:11px; white-space:nowrap;
  max-width:100%; overflow:hidden; text-overflow:ellipsis;
}
.hlkr-logline:last-child{ background:rgba(40,28,12,.6); }

/* 작은 화면 보정 */
@media (max-height:520px){
  .hlkr-build-cards{ max-height:66vh; }
  .hlkr-context{ width:248px; }
}
`;
