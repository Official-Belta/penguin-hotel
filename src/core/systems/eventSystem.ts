import { GameSystem } from "../contracts/index";
import { GameState } from "../gameState";
import { Building } from "../models/building";
import { Guest } from "../models/guest";
import { Species, EventType, BuildingPhase } from "../models/enums";
import { Catalog } from "../content/catalog";

// 돌발·러시·시즌 이벤트를 관리하는 시스템. CONTENT §3 참고.
//
// 주기적으로 GameState.rng로 이벤트 발생을 판정하고, GameState.activeEvent에 이벤트 종류를 세팅한다.
// 이벤트 지속 중에는 이벤트별 효과(손님 추가·플래그·시설 비활성화 등)를 적용하고,
// 지속 시간이 끝나면 효과를 원복(시설 isActive 복구 등)한다.
//
// 다른 시스템과의 결합은 query 메서드/프로퍼티로만 한다(enum 의존 최소화):
// 난방·체온은 warmthDrainMultiplier, 식당은 restaurantServeTimeMultiplier,
// 평판 보너스는 auroraRepBonusMultiplier, 평론가는 criticGuestId + computeCriticRepDelta로 묻는다.
//
// 결정론성: 모든 난수는 GameState.rng(RandomSource)를 통해서만 사용한다.
// DateTime.Now / 무시드 Random 금지. 같은 시드 → 같은 이벤트 시퀀스.
export class EventSystem implements GameSystem {
  // ════════════════════════════════════════════════════════════
  //  튜닝 상수 (전부 시작값 — 밸런싱으로 조정 전제)
  // ════════════════════════════════════════════════════════════

  // ── 발생 주기/확률 ───────────────────────────────────────────
  // 이벤트 발생 체크 주기(초). 이 간격마다 새 이벤트 트리거를 시도한다.
  private static readonly TriggerCheckInterval = 30;

  // 이벤트 발생 기본 확률(체크 1회당). 30초마다 약 30%.
  private static readonly BaseTriggerChance = 0.3;

  // 이벤트 종료 후 다음 이벤트까지의 쿨다운(초). 연속 이벤트 방지.
  private static readonly EventCooldown = 45;

  // ── 이벤트 지속 시간(초) ─────────────────────────────────────
  // TourBusRush 지속 시간(초). 단체 손님이 쏟아지는 시간.
  private static readonly DurationTourBusRush = 30;

  // AuroraSeason 지속 시간(초). 유입↑+만족 평판 보너스 기간.
  private static readonly DurationAuroraSeason = 120;

  // VipVisit 지속 시간(초). VIP 손님 1명 체류 여유.
  private static readonly DurationVipVisit = 90;

  // Blizzard 지속 시간(초). 난방 부하 급증.
  private static readonly DurationBlizzard = 60;

  // PowerOutage 지속 시간(초). 시설 일부 정지.
  private static readonly DurationPowerOutage = 30;

  // MysteryCritic 지속 시간(초). 특수 평론가 손님 체류·판정 시간.
  private static readonly DurationMysteryCritic = 90;

  // FoodShortage 지속 시간(초). 식당 효율 저하.
  private static readonly DurationFoodShortage = 60;

  // ── 이벤트별 수치 ────────────────────────────────────────────
  // TourBusRush 때 한 번에 스폰되는 단체 손님 수.
  private static readonly TourBusGroupSize = 6;

  // AuroraSeason 중 추가 유입 스폰 간격(초). 이 간격마다 손님 1명을 더 불러온다.
  private static readonly AuroraInflowInterval = 6;

  // AuroraSeason 중 만족 시 평판 보너스 배율(1.0=기본). 체크아웃 평판에 곱한다.
  private static readonly AuroraRepBonus = 1.5;

  // Blizzard 중 야외 체온 하락/온기 페널티 가중 배율(기본 1.0).
  private static readonly BlizzardWarmthDrainMult = 2.0;

  // FoodShortage 중 식당(Restaurant/Bar/Cafe) serveTime 배율(느려짐, 기본 1.0).
  private static readonly FoodShortageServeTimeMult = 1.75;

  // PowerOutage 때 비활성화할 시설 비율(0~1). 가동 시설 중 이 비율(올림)만큼 정지.
  private static readonly PowerOutageDisableRatio = 0.5;

  // MysteryCritic 만족 임계치(0~100). 이 이상이면 평판 대박, 미만이면 폭락.
  private static readonly CriticSatisfactionThreshold = 80;

  // MysteryCritic 대박 평판(만족 ≥ 임계치).
  private static readonly CriticRepJackpot = 120;

  // MysteryCritic 폭락 평판(만족 < 임계치). 음수.
  private static readonly CriticRepCrash = -100;

  // ════════════════════════════════════════════════════════════
  //  런타임 상태
  // ════════════════════════════════════════════════════════════

  // 이벤트 발생 체크까지 남은 시간(초).
  private _triggerTimer = EventSystem.TriggerCheckInterval;

  // 현재 이벤트 남은 지속 시간(초). 이벤트 없으면 0.
  private _eventTimer = 0;

  // 이벤트 종료 후 쿨다운 남은 시간(초).
  private _cooldownTimer = 0;

  // AuroraSeason 추가 유입 스폰까지 남은 시간(초).
  private _auroraInflowTimer = 0;

  // 스폰한 이벤트 손님 누적 수. 스폰 id 충돌 방지용("ev0","ev1",...).
  private _eventSpawnCount = 0;

  // PowerOutage 때 비활성화한 시설 id 목록. 종료 시 isActive 복구에 사용.
  private readonly _outageDisabledIds: string[] = [];

  // GameState.activeEvent(EventType | null)를 미러링한 캐시.
  // query 프로퍼티들이 매번 비교할 수 있도록 둔다(GameState.activeEvent와 항상 동기).
  private _activeEventType: EventType | null = null;

  // 현재 호텔에 있는 미스터리 평론가 손님 id. 이벤트 진행 중이 아니면 null.
  private _criticGuestId: string | null = null;

  // ════════════════════════════════════════════════════════════
  //  GameSystem
  // ════════════════════════════════════════════════════════════

  // 1 tick 처리. 진행 중 이벤트가 있으면 지속 효과(오로라 유입 등)를 적용하고 타이머를 줄이며,
  // 없으면 쿨다운 후 주기적으로 새 이벤트 발생을 판정한다. 지속 시간 종료 시 효과를 원복한다.
  // state: 게임 전역 상태(읽고 변경). dt: 경과 시간(초). 0 이하면 아무 일도 하지 않는다.
  tick(state: GameState, dt: number): void {
    if (state == null || dt <= 0) return;

    // 진행 중 이벤트가 있으면: 지속 효과 적용 + 타이머 카운트다운.
    if (this._activeEventType != null) {
      this.tickActiveEvent(state, dt);

      this._eventTimer -= dt;
      if (this._eventTimer <= 0) {
        this.endEvent(state);
      }
      return; // 이벤트 중에는 새 이벤트를 트리거하지 않는다.
    }

    // 이벤트 없음: 쿨다운부터 소진.
    if (this._cooldownTimer > 0) {
      this._cooldownTimer -= dt;
      if (this._cooldownTimer < 0) this._cooldownTimer = 0;
      return;
    }

    // 쿨다운 끝 → 주기적으로 발생 판정.
    this._triggerTimer -= dt;
    if (this._triggerTimer <= 0) {
      this._triggerTimer = EventSystem.TriggerCheckInterval;
      this.tryTriggerEvent(state);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  Query — 다른 시스템이 현재 이벤트 효과를 묻는 표면
  // ════════════════════════════════════════════════════════════

  // 현재 진행 중인 이벤트 종류(없으면 null). GameState.activeEvent와 동일.
  get activeEvent(): EventType | null {
    return this._activeEventType;
  }

  // 현재 이벤트 남은 지속 시간(초). UI 표시용. 이벤트 없으면 0.
  get eventTimeRemaining(): number {
    return this._eventTimer > 0 ? this._eventTimer : 0;
  }

  // 현재 단체 관광버스 러시(TourBusRush)가 진행 중인가.
  get isTourBusRush(): boolean {
    return this._activeEventType === EventType.TourBusRush;
  }

  // 현재 오로라 시즌(AuroraSeason)이 진행 중인가. 유입↑·평판 보너스 기간.
  get isAuroraSeason(): boolean {
    return this._activeEventType === EventType.AuroraSeason;
  }

  // 현재 VIP 방문(VipVisit)이 진행 중인가.
  get isVipVisit(): boolean {
    return this._activeEventType === EventType.VipVisit;
  }

  // 현재 눈보라(Blizzard)가 진행 중인가. WarmthSystem/체온 처리에서 참조.
  get isBlizzard(): boolean {
    return this._activeEventType === EventType.Blizzard;
  }

  // 현재 정전(PowerOutage)이 진행 중인가.
  get isPowerOutage(): boolean {
    return this._activeEventType === EventType.PowerOutage;
  }

  // 현재 미스터리 평론가(MysteryCritic) 이벤트가 진행 중인가.
  get isMysteryCritic(): boolean {
    return this._activeEventType === EventType.MysteryCritic;
  }

  // 현재 식재료 품귀(FoodShortage)가 진행 중인가. 식당 효율 처리에서 참조.
  get isFoodShortage(): boolean {
    return this._activeEventType === EventType.FoodShortage;
  }

  // 야외 체온 하락/온기 페널티에 곱할 가중 배율. Blizzard 중에는 BlizzardWarmthDrainMult,
  // 평상시 1.0. WarmthSystem 호출 측이 dt나 drain에 곱한다.
  warmthDrainMultiplier(): number {
    return this.isBlizzard ? EventSystem.BlizzardWarmthDrainMult : 1;
  }

  // 식당 계열(Restaurant/Bar/Cafe) serveTime에 곱할 배율. FoodShortage 중에는
  // FoodShortageServeTimeMult(느려짐), 평상시 1.0. 응대 처리 측이 serveTime에 곱한다.
  restaurantServeTimeMultiplier(): number {
    return this.isFoodShortage ? EventSystem.FoodShortageServeTimeMult : 1;
  }

  // 체크아웃 평판 획득에 곱할 보너스 배율. AuroraSeason 중에는 AuroraRepBonus,
  // 평상시 1.0. 정산 측이 repGain에 곱한다.
  auroraRepBonusMultiplier(): number {
    return this.isAuroraSeason ? EventSystem.AuroraRepBonus : 1;
  }

  // 현재 미스터리 평론가 손님 id. 이벤트가 없거나 평론가가 없으면 null.
  // 정산 측이 "이 손님이 평론가인가?"를 id 비교로 판정할 때 쓴다.
  get criticGuestId(): string | null {
    return this._criticGuestId;
  }

  // 주어진 손님이 현재 미스터리 평론가인지 여부. 평론가면 true.
  isCriticGuest(guest: Guest): boolean {
    return guest != null && this._criticGuestId != null && guest.id === this._criticGuestId;
  }

  // 미스터리 평론가의 체크아웃 만족도에 따른 평판 증감을 반환한다.
  // 만족 ≥ CriticSatisfactionThreshold면 대박(+), 미만이면 폭락(−).
  // 정산 측이 평론가 손님 퇴장 시 이 값을 평판에 가산한다(일반 repGain 대체).
  // satisfaction: 평론가의 최종 만족도(0~100). 반환: 평판 증감량(대박 양수 / 폭락 음수).
  computeCriticRepDelta(satisfaction: number): number {
    return satisfaction >= EventSystem.CriticSatisfactionThreshold
      ? EventSystem.CriticRepJackpot
      : EventSystem.CriticRepCrash;
  }

  // ════════════════════════════════════════════════════════════
  //  내부 — 트리거 / 시작 / 종료
  // ════════════════════════════════════════════════════════════

  // 발생 확률을 판정하고, 통과 시 7종 중 하나를 균등 추첨해 시작한다(결정론: rng).
  private tryTriggerEvent(state: GameState): void {
    if (state.rng == null) return;
    if (state.rng.nextFloat() >= EventSystem.BaseTriggerChance) return;

    const roll = state.rng.nextInt(7);
    let picked: EventType;
    switch (roll) {
      case 0:
        picked = EventType.TourBusRush;
        break;
      case 1:
        picked = EventType.AuroraSeason;
        break;
      case 2:
        picked = EventType.VipVisit;
        break;
      case 3:
        picked = EventType.Blizzard;
        break;
      case 4:
        picked = EventType.PowerOutage;
        break;
      case 5:
        picked = EventType.MysteryCritic;
        break;
      default:
        picked = EventType.FoodShortage;
        break;
    }

    this.startEvent(state, picked);
  }

  // 이벤트를 시작한다. activeEvent 세팅 + 지속시간 설정 + 즉시 효과(스폰/정전) 적용.
  private startEvent(state: GameState, eventType: EventType): void {
    this._activeEventType = eventType;
    state.activeEvent = eventType;
    this._eventTimer = EventSystem.getDuration(eventType);
    this._auroraInflowTimer = EventSystem.AuroraInflowInterval;

    switch (eventType) {
      case EventType.TourBusRush:
        this.spawnGroupRush(state);
        break;

      case EventType.VipVisit:
        this.spawnVipGuest(state);
        break;

      case EventType.MysteryCritic:
        this.spawnMysteryCritic(state);
        break;

      case EventType.PowerOutage:
        this.applyPowerOutage(state);
        break;

      case EventType.AuroraSeason:
      case EventType.Blizzard:
      case EventType.FoodShortage:
        // 즉시 스폰 없음 — query 플래그(배율)로 다른 시스템이 효과를 본다.
        // (AuroraSeason은 tick에서 추가 유입을 흘려보낸다.)
        break;
    }
  }

  // 진행 중 이벤트의 매-틱 지속 효과를 적용한다. 현재는 AuroraSeason 추가 유입.
  private tickActiveEvent(state: GameState, dt: number): void {
    if (this._activeEventType !== EventType.AuroraSeason) return;

    // 오로라 시즌: 일정 간격마다 손님을 추가로 불러온다(유입↑). 결정론: rng로 종 선택.
    this._auroraInflowTimer -= dt;
    if (this._auroraInflowTimer <= 0) {
      this._auroraInflowTimer += EventSystem.AuroraInflowInterval;
      this.spawnUnlockedGuest(state);
    }
  }

  // 이벤트를 종료하고 효과를 원복한다(정전 복구·평론가 표식 해제 등).
  private endEvent(state: GameState): void {
    if (this._activeEventType === EventType.PowerOutage) {
      this.restorePowerOutage(state);
    }

    // 평론가는 이벤트가 끝나면 표식을 내린다. (정산 측은 체류 중 id 비교로 이미 판정)
    this._criticGuestId = null;

    this._activeEventType = null;
    state.activeEvent = null;
    this._eventTimer = 0;
    this._auroraInflowTimer = 0;
    this._cooldownTimer = EventSystem.EventCooldown;
    this._triggerTimer = EventSystem.TriggerCheckInterval;
  }

  // ════════════════════════════════════════════════════════════
  //  내부 — 스폰 (Catalog 사용, 결정론)
  // ════════════════════════════════════════════════════════════

  // 다음 이벤트 손님 id("ev{n}")를 발급한다.
  private nextEventId(): string {
    const id = "ev" + this._eventSpawnCount;
    this._eventSpawnCount++;
    return id;
  }

  // TourBusRush/SchoolTrip 성격의 단체 손님 다수를 스폰한다(CONTENT §3.1·§3.5).
  // 단체 손님 종(SchoolTrip·SeaLionFamily)과 기본 손님을 결정론적으로 섞어
  // "객실·식당 동시 폭주"를 만든다. 평판 게이트 무시(이벤트 강제 유입).
  private spawnGroupRush(state: GameState): void {
    for (let i = 0; i < EventSystem.TourBusGroupSize; i++) {
      const species = this.pickGroupSpecies(state);
      state.guests.push(Catalog.createGuest(species, this.nextEventId()));
    }
  }

  // 단체 러시용 손님 종을 결정론적으로 고른다(수학여행단·바다사자 가족 비중↑).
  private pickGroupSpecies(state: GameState): Species {
    // 0,1: 수학여행단(러시 시그니처) / 2: 바다사자 가족(단체) / 3: 여행펭귄(채움)
    const roll = state.rng != null ? state.rng.nextInt(4) : 0;
    switch (roll) {
      case 0:
      case 1:
        return Species.SchoolTrip;
      case 2:
        return Species.SeaLionFamily;
      default:
        return Species.TravelPenguin;
    }
  }

  // VipVisit: VIP 손님 1명을 스폰한다(CONTENT §3.1 "고래·유명 손님 1명, 까다롭지만 큰 코인·평판").
  // 종은 D그룹 VIP 중 결정론적으로 선택. 평판 게이트 무시(이벤트 강제 방문).
  private spawnVipGuest(state: GameState): void {
    let species: Species;
    const roll = state.rng != null ? state.rng.nextInt(4) : 0;
    switch (roll) {
      case 0:
        species = Species.Whale;
        break;
      case 1:
        species = Species.Orca;
        break;
      case 2:
        species = Species.EmperorPenguin;
        break;
      default:
        species = Species.Narwhal;
        break;
    }
    state.guests.push(Catalog.createGuest(species, this.nextEventId()));
  }

  // MysteryCritic: 특수 평론가 손님 1명을 스폰하고 id를 표식한다(CONTENT §3.3).
  // 만족=평판 대박 / 실패=폭락은 computeCriticRepDelta로 정산 측이 적용한다.
  private spawnMysteryCritic(state: GameState): void {
    const id = this.nextEventId();
    state.guests.push(Catalog.createGuest(Species.MysteryCritic, id));
    this._criticGuestId = id;
  }

  // 현재 평판(peakReputation)으로 해금된 종 중 하나를 결정론적으로 골라 1명 스폰한다.
  // AuroraSeason 추가 유입에 쓴다. 해금된 종이 없으면(이론상 항상 1종 이상) 여행펭귄을 쓴다.
  private spawnUnlockedGuest(state: GameState): void {
    const all: ReadonlyArray<Species> = Catalog.allGuestSpecies;
    const peak = state.peakReputation;

    // 해금된 종 인덱스를 모은다(작은 임시 리스트 — 종 수가 적어 비용 무시 가능).
    const unlocked: Species[] = [];
    for (let i = 0; i < all.length; i++) {
      if (Catalog.guestUnlockRep(all[i]) <= peak) {
        unlocked.push(all[i]);
      }
    }

    let species: Species;
    if (unlocked.length > 0) {
      const idx = state.rng != null ? state.rng.nextInt(unlocked.length) : 0;
      species = unlocked[idx];
    } else {
      species = Species.TravelPenguin;
    }

    state.guests.push(Catalog.createGuest(species, this.nextEventId()));
  }

  // ════════════════════════════════════════════════════════════
  //  내부 — PowerOutage (시설 비활성/복구)
  // ════════════════════════════════════════════════════════════

  // PowerOutage 시작: 가동 중(isActive && phase==Active)인 시설 중
  // PowerOutageDisableRatio(올림)만큼을 무작위로 isActive=false 처리하고 id를 기록한다.
  // Fisher–Yates 셔플로 무작위 선택(결정론: rng).
  private applyPowerOutage(state: GameState): void {
    this._outageDisabledIds.length = 0;

    const candidates: Building[] = [];
    for (let i = 0; i < state.buildings.length; i++) {
      const b = state.buildings[i];
      if (b != null && b.isActive && b.phase === BuildingPhase.Active) {
        candidates.push(b);
      }
    }
    if (candidates.length === 0) return;

    // 비활성화 개수: 비율 × 후보 수(올림).
    let disableCount = Math.ceil(candidates.length * EventSystem.PowerOutageDisableRatio);
    if (disableCount > candidates.length) disableCount = candidates.length;

    // Fisher–Yates 셔플(결정론: rng).
    if (state.rng != null) {
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = state.rng.nextInt(i + 1);
        const tmp = candidates[i];
        candidates[i] = candidates[j];
        candidates[j] = tmp;
      }
    }

    for (let i = 0; i < disableCount; i++) {
      candidates[i].isActive = false;
      this._outageDisabledIds.push(candidates[i].id);
    }
  }

  // PowerOutage 종료: 이벤트 중 비활성화했던 시설을 isActive=true로 원상복구한다.
  private restorePowerOutage(state: GameState): void {
    for (let i = 0; i < this._outageDisabledIds.length; i++) {
      const b = state.findBuilding(this._outageDisabledIds[i]);
      if (b != null) {
        b.isActive = true;
      }
    }
    this._outageDisabledIds.length = 0;
  }

  // ════════════════════════════════════════════════════════════
  //  내부 — 유틸
  // ════════════════════════════════════════════════════════════

  // 이벤트 종류별 지속 시간(초)을 반환한다.
  private static getDuration(eventType: EventType): number {
    switch (eventType) {
      case EventType.TourBusRush:
        return EventSystem.DurationTourBusRush;
      case EventType.AuroraSeason:
        return EventSystem.DurationAuroraSeason;
      case EventType.VipVisit:
        return EventSystem.DurationVipVisit;
      case EventType.Blizzard:
        return EventSystem.DurationBlizzard;
      case EventType.PowerOutage:
        return EventSystem.DurationPowerOutage;
      case EventType.MysteryCritic:
        return EventSystem.DurationMysteryCritic;
      case EventType.FoodShortage:
        return EventSystem.DurationFoodShortage;
      default:
        return 60;
    }
  }
}
