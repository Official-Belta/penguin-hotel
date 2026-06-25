// GameApp — 게임 허브(통합 백본). HotelManager(코어)를 소유하고, 루프·선택·플레이어 액션·
// 표시 헬퍼를 한곳에 모은다. WorldRenderer 와 GameUI 는 이 객체 하나만 참조한다(Unity 의
// GameController.Instance 허브 패턴과 동일 의도).

import { HotelManager } from "../core/hotelManager";
import { DeterministicRandom } from "../core/contracts/deterministicRandom";
import { Catalog } from "../core/content/catalog";
import { MvpConfig } from "../core/config/mvpConfig";
import { Building } from "../core/models/building";
import { Guest } from "../core/models/guest";
import { BuildingType } from "../core/models/enums";
import { Layout } from "./layout";
import {
  BUILDINGS,
  BUILDING_BY_KEY,
  SPECIES,
  STARTING_BUILDING_DEF,
  TYPE_FALLBACK,
  starRating,
  BuildCategory,
} from "./display";

export type SelKind = "building" | "guest" | null;
export interface Selection {
  kind: SelKind;
  id: string | null;
}

// 월드 렌더러가 소비(drain)하는 떠오르는 숫자 팝.
export interface Pop {
  kind: "coin" | "angry";
  guestId: string;
  amount: number;
}

export interface BuildOption {
  key: string;
  name: string;
  emoji: string;
  category: BuildCategory;
  cost: number;
  unlockRep: number;
  unlocked: boolean;
}

export interface BuildingLook {
  name: string;
  emoji: string;
  roof: number;
  wall: number;
  category: BuildCategory;
}

export class GameApp {
  readonly manager: HotelManager;
  readonly layout = new Layout();

  speed = 1; // 1·2·3배속
  paused = false;
  selection: Selection = { kind: null, id: null };

  readonly log: string[] = [];
  readonly pops: Pop[] = []; // WorldRenderer 가 매 프레임 비움

  private buildCounter = 0;
  private readonly defKeyById = new Map<string, string>();
  private readonly costCache = new Map<string, number>();

  constructor() {
    const seed = (Date.now() & 0x7fffffff) || 1;
    this.manager = new HotelManager(new DeterministicRandom(seed));

    this.manager.onGuestArrived = (g) => this.onArrived(g);
    this.manager.onGuestServed = (g, payout, rep) => this.onServed(g, payout, rep);
    this.manager.onGuestAngry = (g, pen) => this.onAngry(g, pen);

    // 시작 시설 → 셀 배정 + defKey 매핑.
    for (const b of this.manager.buildings) {
      this.layout.ensure(b.id);
      const def = STARTING_BUILDING_DEF[b.id];
      if (def) this.defKeyById.set(b.id, def);
    }
    this.pushLog("🐧 남극 그랜드 호텔 개장!");
  }

  // ── 루프 ──────────────────────────────────────────────────
  update(realDt: number): void {
    if (this.paused) return;
    const dt = Math.min(realDt, 0.1) * this.speed; // 프레임 스파이크 클램프
    this.manager.tick(dt);
    // 새로 건설된 시설에 셀 배정.
    for (const b of this.manager.buildings) {
      if (!this.layout.cellOf(b.id)) this.layout.ensure(b.id);
    }
  }

  // ── 자원/상태 getter (UI 편의) ────────────────────────────
  get coin(): number {
    return this.manager.economy.coin;
  }
  get gem(): number {
    return this.manager.economy.gem;
  }
  get reputation(): number {
    return this.manager.economy.reputation;
  }
  get peakRep(): number {
    return Math.max(this.reputation, this.manager.state.peakReputation);
  }
  get stars(): number {
    return starRating(this.peakRep);
  }
  get isOpen(): boolean {
    return this.manager.isOpen;
  }
  get isRush(): boolean {
    return this.manager.isRushActive;
  }
  get activeEvent() {
    return this.manager.activeEvent;
  }
  get guestCount(): number {
    return this.manager.guests.length;
  }

  // ❄️ 난방 커버리지 0~1 (HUD 게이지). 활성 난방 warmthOutput 합 / 기준값.
  get warmthCoverage(): number {
    let w = 0;
    for (const b of this.manager.buildings) if (b.isActive && b.warmthOutput > 0) w += b.warmthOutput;
    return Math.max(0, Math.min(1, w / 120));
  }

  // 운영비/분(추정): 난방 upkeep×배율 + 기타 upkeep + 인건비. HUD 표시용.
  get upkeepPerMin(): number {
    let cost = 0;
    for (const b of this.manager.buildings) {
      if (!b.isActive) continue;
      if (b.type === BuildingType.HeatingRoom) cost += b.upkeep * MvpConfig.heatingUpkeepMultiplier;
      else cost += b.upkeep;
    }
    for (const s of this.manager.staff) if (s.onDuty) cost += s.wage;
    return Math.round(cost);
  }

  // ── 플레이어 액션 ─────────────────────────────────────────
  setSpeed(n: number): void {
    this.speed = n;
  }
  togglePause(): void {
    this.paused = !this.paused;
  }
  toggleOpen(): void {
    this.manager.intervention.toggleBusiness(this.manager.state, !this.manager.isOpen);
    this.pushLog(this.isOpen ? "🟢 영업 시작" : "🚫 휴장 (유지비는 계속)");
  }

  select(kind: SelKind, id: string | null): void {
    this.selection = { kind, id };
  }
  clearSelection(): void {
    this.selection = { kind: null, id: null };
  }
  selectedBuilding(): Building | null {
    if (this.selection.kind !== "building" || !this.selection.id) return null;
    return this.manager.state.findBuilding(this.selection.id);
  }
  selectedGuest(): Guest | null {
    if (this.selection.kind !== "guest" || !this.selection.id) return null;
    for (const g of this.manager.guests) if (g.id === this.selection.id) return g;
    return null;
  }

  // 건설 메뉴 옵션(비용·해금 포함).
  buildOptions(): BuildOption[] {
    const peak = this.peakRep;
    return BUILDINGS.map((def) => ({
      key: def.key,
      name: def.name,
      emoji: def.emoji,
      category: def.category,
      cost: this.costOf(def.key),
      unlockRep: def.unlockRep,
      unlocked: peak >= def.unlockRep,
    }));
  }

  private costOf(key: string): number {
    const c = this.costCache.get(key);
    if (c != null) return c;
    let cost = 0;
    try {
      cost = Catalog.createBuilding(key, "_preview").buildCost;
    } catch {
      cost = 0;
    }
    this.costCache.set(key, cost);
    return cost;
  }

  tryBuild(defKey: string): boolean {
    const def = BUILDING_BY_KEY[defKey];
    if (!def) return false;
    if (this.peakRep < def.unlockRep) {
      this.pushLog("🔒 아직 잠김: " + def.name);
      return false;
    }
    const id = "b" + ++this.buildCounter + "_" + defKey;
    let b: Building;
    try {
      b = Catalog.createBuilding(defKey, id);
    } catch {
      this.pushLog("⚠️ 생성 실패: " + def.name);
      return false;
    }
    const ok = this.manager.construction.startBuild(this.manager.state, b);
    if (ok) {
      this.defKeyById.set(b.id, defKey);
      this.layout.ensure(b.id);
      this.pushLog(def.emoji + " " + def.name + " 건설 시작");
    } else {
      this.pushLog("💰 코인 부족: " + def.name);
    }
    return ok;
  }

  upgradeSelected(): boolean {
    const b = this.selectedBuilding();
    if (!b) return false;
    const ok = this.manager.construction.startUpgrade(this.manager.state, b);
    this.pushLog(ok ? "⬆️ 업그레이드 시작" : "⚠️ 업그레이드 불가(코인/상태)");
    return ok;
  }

  // ── 표시 헬퍼 ─────────────────────────────────────────────
  describeBuilding(b: Building): BuildingLook {
    const key = this.defKeyById.get(b.id);
    const def = key ? BUILDING_BY_KEY[key] : undefined;
    if (def) return { name: def.name, emoji: def.emoji, roof: def.roof, wall: def.wall, category: def.category };
    const fb = TYPE_FALLBACK[b.type];
    if (fb) return { name: fb.name, emoji: fb.emoji, roof: fb.roof, wall: fb.wall, category: fb.category };
    return { name: "시설", emoji: "🏠", roof: 0xcccccc, wall: 0x999999, category: "ops" };
  }

  speciesName(g: Guest): string {
    return SPECIES[g.species]?.name ?? "손님";
  }

  // ── 이벤트 핸들러(코어 → 로그/팝) ─────────────────────────
  private onArrived(g: Guest): void {
    this.pushLog(SPECIES[g.species]?.emoji + " " + this.speciesName(g) + " 도착");
  }
  private onServed(g: Guest, payout: number, _rep: number): void {
    this.pushLog("✅ " + this.speciesName(g) + " 만족 +" + payout + "💰");
    this.pops.push({ kind: "coin", guestId: g.id, amount: payout });
  }
  private onAngry(g: Guest, pen: number): void {
    this.pushLog("😡 " + this.speciesName(g) + " 화나서 퇴장 -" + pen + "⭐");
    this.pops.push({ kind: "angry", guestId: g.id, amount: pen });
  }

  private pushLog(msg: string): void {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }
}
