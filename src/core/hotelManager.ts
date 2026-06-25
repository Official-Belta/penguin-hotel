import { RandomSource } from "./contracts/index";
import { GameState } from "./gameState";
import { EconomySystem } from "./systems/economySystem";
import { StaffEffectSystem } from "./systems/staffEffectSystem";
import { MaintenanceSystem } from "./systems/maintenanceSystem";
import { HrSystem } from "./systems/hrSystem";
import { ConstructionSystem } from "./systems/constructionSystem";
import { EventSystem } from "./systems/eventSystem";
import { ProgressionSystem } from "./systems/progressionSystem";
import { InterventionSystem } from "./systems/interventionSystem";
import { WarmthSystem } from "./systems/warmthSystem";
import { GuestStateMachine } from "./systems/guestStateMachine";
import { SpawnSystem } from "./systems/spawnSystem";
import { MvpConfig } from "./config/mvpConfig";
import { Catalog } from "./content/catalog";
import { Building } from "./models/building";
import { Guest } from "./models/guest";
import { Staff } from "./models/staff";
import { BuildingType, GuestPhase, EventType, StaffRole, Rarity } from "./models/enums";

// 코어 루프 오케스트레이터(전체 통합). GameState 하나를 소유하고, 매 tick 모든 도메인 시스템을
// 순서대로 굴린다(CORE_LOOP §1). 엔진 무관 — Unity는 Time.deltaTime을 tick(dt)로 넘기고
// 이벤트를 구독해 그리면 된다.
// tick 순서: 이벤트 → 스폰(영업중) → 건설 → 유지보수 → HR → 직원효과 → 진행 → 경제(난방·인건비·이자) → 손님 → 정리.
// 효과 연결(이슈5 지휘형 TM): 직원이 serveTime↓, 유지보수가 만족도↓, 이벤트가 손님 스폰/식당 지연,
// 진행이 구역 해금, 영업토글이 스폰 차단, 인건비가 코인을 잠식.
export class HotelManager {
  private readonly _state: GameState;

  // 도메인 시스템
  private readonly _staffEffects: StaffEffectSystem;
  private readonly _maintenance: MaintenanceSystem;
  private readonly _hr: HrSystem;
  private readonly _construction: ConstructionSystem;
  private readonly _events: EventSystem;
  private readonly _progression: ProgressionSystem;
  private readonly _intervention: InterventionSystem;

  // 기존(코어) 시스템
  private readonly _warmth: WarmthSystem;
  private readonly _fsm: GuestStateMachine;
  private readonly _spawn: SpawnSystem;

  // FSM 콜백 캐시(매 tick 재할당 방지)
  private readonly _onCheckout: (g: Guest, payout: number, rep: number) => void;
  private readonly _onAngry: (g: Guest, rep: number) => void;

  // 인건비 소수 누적기(coin/min → 정수 차감)
  private _wageAccrual: number = 0;

  // ── 이벤트(렌더러/로그 구독) ──
  // 새 손님 도착.
  onGuestArrived: ((g: Guest) => void) | null = null;
  // 만족 퇴장. (손님, 지급코인, 획득평판)
  onGuestServed: ((g: Guest, payout: number, rep: number) => void) | null = null;
  // 화난 퇴장. (손님, 차감평판)
  onGuestAngry: ((g: Guest, repPenalty: number) => void) | null = null;

  // MVP 호텔을 구성해 시작한다(시작 시설 + 직원 배치).
  // rng: 결정론적 난수(스폰·이벤트). 같은 시드 → 같은 세션.
  constructor(rng: RandomSource, worldBuilder: ((state: GameState) => void) | null = null) {
    if (rng == null) throw new Error("rng");

    this._state = new GameState();
    this._state.rng = rng;
    this._state.economy = new EconomySystem(
      MvpConfig.startCoin,
      MvpConfig.startGem,
      MvpConfig.startReputation,
    );
    // worldBuilder 지정 시 커스텀 월드(밸런스 시나리오용), 아니면 기본 MVP 월드.
    if (worldBuilder != null) worldBuilder(this._state);
    else HotelManager.buildMvpWorld(this._state);

    this._staffEffects = new StaffEffectSystem();
    this._maintenance = new MaintenanceSystem(this._staffEffects);
    this._hr = new HrSystem();
    this._construction = new ConstructionSystem();
    this._events = new EventSystem();
    this._progression = new ProgressionSystem();
    this._intervention = new InterventionSystem();

    this._warmth = new WarmthSystem();
    this._warmth.registerBuildings(this._state.buildings);
    this._spawn = new SpawnSystem(rng);
    // 효과 훅: 직원·이벤트 → serveTime, 유지보수 → 단계 만족도.
    this._fsm = new GuestStateMachine(
      this._warmth,
      (b) => this.serveTimeFor(b),
      (b) => this.stepSatisfactionFor(b),
      null,
    );

    this._onCheckout = (g, payout, repGain) => this.onGuestCheckout(g, payout, repGain);
    this._onAngry = (g, repPenalty) => this.onGuestAngryInternal(g, repPenalty);
  }

  // ── 공개 상태 ──
  // 게임 전역 상태.
  get state(): GameState {
    return this._state;
  }
  // 경제(코인·젬·평판·대출).
  get economy(): EconomySystem {
    return this._state.economy;
  }
  // 시설 목록.
  get buildings(): ReadonlyArray<Building> {
    return this._state.buildings;
  }
  // 손님 목록.
  get guests(): ReadonlyArray<Guest> {
    return this._state.guests;
  }
  // 직원 목록.
  get staff(): ReadonlyArray<Staff> {
    return this._state.staff;
  }
  // 러시 웨이브 중인가.
  get isRushActive(): boolean {
    return this._spawn.isRushActive;
  }
  // 영업 중인가(영업/휴장 토글).
  get isOpen(): boolean {
    return this._state.isOpen;
  }
  // 세션 경과(초).
  get elapsedSeconds(): number {
    return this._state.elapsedSeconds;
  }
  // 현재 진행 중 이벤트(없으면 null).
  get activeEvent(): EventType | null {
    return this._state.activeEvent;
  }

  // ── 시스템 접근(개입 명령·검증용) ──
  // 플레이어 개입(재배정·엔터투입·젬증설·영업토글).
  get intervention(): InterventionSystem {
    return this._intervention;
  }
  // 건설/업그레이드.
  get construction(): ConstructionSystem {
    return this._construction;
  }
  // 유지보수(청결·마모·청소·수리).
  get maintenance(): MaintenanceSystem {
    return this._maintenance;
  }
  // 직원 효과(serveTime·이동·난방효율·청결보정).
  get staffEffects(): StaffEffectSystem {
    return this._staffEffects;
  }
  // HR(사기·체력·번아웃).
  get hr(): HrSystem {
    return this._hr;
  }
  // 진행/구역 해금.
  get progression(): ProgressionSystem {
    return this._progression;
  }
  // 이벤트.
  get events(): EventSystem {
    return this._events;
  }

  // 코어 루프 1 tick.
  // dt: 경과 시간(초).
  tick(dt: number): void {
    if (dt <= 0) return;
    this._state.elapsedSeconds += dt;

    // ① 이벤트(손님 스폰·시설 정전·평판 변수 등)
    this._events.tick(this._state, dt);

    // ② 일반 스폰 — 영업 중일 때만(휴장이면 신규 차단, 이슈3)
    if (this._state.isOpen) {
      const arrived = this._spawn.trySpawn(dt, this._state.economy.reputation);
      if (arrived != null) {
        this._state.guests.push(arrived);
        if (this.onGuestArrived != null) this.onGuestArrived(arrived);
      }
    }

    // ③ 건설/업그레이드 타이머
    this._construction.tick(this._state, dt);

    // ④ 유지보수(청결·마모 하락)
    this._maintenance.tick(this._state, dt);

    // ⑤ HR(체력·사기)
    this._hr.tick(this._state, dt);

    // ⑥ 직원 효과(엔터테이너 patience 회복 등)
    this._staffEffects.tick(this._state, dt);

    // ⑦ 진행/해금
    this._progression.tick(this._state, dt);

    // ⑧ 경제: 난방 운영비 + 인건비 + 대출 이자(현실 시간으로 코인 잠식 = 추위 vs 흑자)
    this._state.economy.tickUpkeep(dt, this._state.buildings);
    this.tickWages(dt);
    this._state.economy.tickLoanInterest(dt);

    // ⑨ 손님: 각자 여정 상태머신 전진(효과 반영)
    for (let i = 0; i < this._state.guests.length; i++) {
      this._fsm.tick(this._state.guests[i], dt, this._state.buildings, this._onCheckout, this._onAngry);
    }

    // ⑩ 퇴장(Done) 손님 정리
    this.removeDoneGuests();
  }

  // ── 효과 provider (FSM에 주입) ──

  // 시설 실효 serveTime: 배치된 직원(셰프) + 이벤트(식재료 품귀) 반영.
  private serveTimeFor(b: Building): number {
    let t = this._staffEffects.effectiveServeTime(b, this._state);
    if (b.type === BuildingType.Restaurant) {
      t *= this._events.restaurantServeTimeMultiplier();
    }
    return t;
  }

  // 단계 실효 만족도: 시설 기본 satisfaction에서 유지보수 방치 페널티를 뺀 값(0 이상).
  private stepSatisfactionFor(b: Building): number {
    const s = b.satisfaction - this._maintenance.satisfactionPenalty(b);
    return s < 0 ? 0 : s;
  }

  // ── 콜백(상태머신 → 경제·이벤트) ──

  private onGuestCheckout(g: Guest, payout: number, repGain: number): void {
    this._state.economy.addCoin(payout);
    this._state.economy.addReputation(repGain);
    if (this.onGuestServed != null) this.onGuestServed(g, payout, repGain);
  }

  private onGuestAngryInternal(g: Guest, repPenalty: number): void {
    this._state.economy.applyAngryPenalty(repPenalty);
    if (this.onGuestAngry != null) this.onGuestAngry(g, repPenalty);
  }

  // ── 내부 ──

  // 인건비: onDuty 직원 wage 합(coin/min)을 dt만큼 코인에서 차감(소수 누적).
  private tickWages(dt: number): void {
    let perMin = 0.0;
    for (let i = 0; i < this._state.staff.length; i++) {
      const s = this._state.staff[i];
      if (s != null && s.onDuty) perMin += s.wage;
    }
    if (perMin <= 0.0) return;

    this._wageAccrual += perMin * (dt / 60.0);
    const charge = Math.floor(this._wageAccrual);
    if (charge > 0) {
      this._wageAccrual -= charge;
      this._state.economy.addCoin(-charge);
    }
  }

  // MVP 시작 호텔: 이글루·식당·핫초코카페·난방실 + 직원 4명 배치.
  private static buildMvpWorld(state: GameState): void {
    const igloo = MvpConfig.newIglooRoom("igloo1");
    const rest = MvpConfig.newRestaurant("rest1");
    const cafe = MvpConfig.newHotChocolateCafe("cafe1");
    const heat = MvpConfig.newHeatingRoom("heat1");
    state.buildings.push(igloo);
    state.buildings.push(rest);
    state.buildings.push(cafe);
    state.buildings.push(heat);

    // 직원 배치(assignedBuildingId ↔ Building.assignedStaffIds 양방향)
    HotelManager.assignStaff(state, Catalog.createStaff(StaffRole.Chef, Rarity.Common, "s_chef"), rest);
    HotelManager.assignStaff(state, Catalog.createStaff(StaffRole.Entertainer, Rarity.Common, "s_ent"), igloo);
    HotelManager.assignStaff(state, Catalog.createStaff(StaffRole.Engineer, Rarity.Common, "s_eng"), heat);
    HotelManager.assignStaff(state, Catalog.createStaff(StaffRole.Housekeeping, Rarity.Common, "s_keep"), cafe);
  }

  private static assignStaff(state: GameState, s: Staff, b: Building): void {
    s.assignedBuildingId = b.id;
    s.onDuty = true;
    if (!b.assignedStaffIds.includes(s.id)) b.assignedStaffIds.push(s.id);
    state.staff.push(s);
  }

  // phase==Done 손님을 뒤에서부터 제거(인덱스 안정).
  private removeDoneGuests(): void {
    for (let i = this._state.guests.length - 1; i >= 0; i--) {
      if (this._state.guests[i].phase === GuestPhase.Done) {
        this._state.guests.splice(i, 1);
      }
    }
  }
}
