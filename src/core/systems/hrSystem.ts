import { GameSystem } from "../contracts/index";
import { GameState } from "../gameState";
import { Building } from "../models/building";
import { Staff } from "../models/staff";
import { BuildingType, BuildingPhase } from "../models/enums";

// HR(인사관리) 시스템. CONTENT §1.5.
// 매 Tick마다:
//   - OnDuty 직원 Energy 소모.
//   - StaffLounge 배치(휴식) 직원 Energy 회복.
//   - 임금·근무강도·환경 온기를 반영해 Morale 서서히 변동.
//   - Morale 저임계 지속 → 퇴사(GameState.staff 및 assignedStaffIds 정리).
//
// EfficiencyOf 는 외부 시스템이 선택적으로 조회할 수 있는 보조 쿼리이다
// (morale·energy 기반 효율 배수 0~1). 현재 배선상 호출자는 없으며,
// 효율을 실제 능력치에 반영하는 주체는 StaffEffectSystem이 자체 공식(선형 가중평균)으로
// 별도 수행한다. 두 효율 정의가 다른 이유는 설계 결정으로 CLAUDE.md에 기록되어 있다.
export class HrSystem implements GameSystem {
  // ── 에너지 드레인/회복 (초당) ──────────────────────────────────
  // 근무 중 초당 Energy 소모량.
  private static readonly EnergyDrainPerSec = 0.5;

  // StaffLounge 휴식 중 초당 Energy 회복량.
  private static readonly EnergyRecoverPerSec = 1.5;

  // ── Morale 변동 파라미터 ────────────────────────────────────────
  // 임금이 기준(WageReference) 이상일 때 초당 Morale 상승.
  private static readonly MoraleGoodWageGainPerSec = 0.05;

  // 임금이 기준 미만일 때 초당 Morale 하락.
  private static readonly MoraleLowWageDrainPerSec = 0.08;

  // 번아웃(Energy=0) 상태 초당 추가 Morale 하락.
  private static readonly MoraleBurnoutDrainPerSec = 0.15;

  // 환경 온기가 부족할 때 초당 Morale 하락(추위 페널티).
  private static readonly MoraleColdDrainPerSec = 0.1;

  // 난방이 충분할 때 초당 Morale 소폭 회복.
  private static readonly MoraleWarmGainPerSec = 0.03;

  // 임금 "적정" 기준선(coin/min). 이 이상이면 임금 Morale+, 미만이면 -.
  private static readonly WageReference = 3;

  // 온기 충분 기준. 활성 HeatingRoom WarmthOutput 합이 이 이상이면 따뜻함으로 판정.
  private static readonly SufficientWarmthThreshold = 40;

  // ── 퇴사 판정 ───────────────────────────────────────────────────
  // 이 Morale 이하로 떨어지면 퇴사 카운트다운 시작.
  private static readonly ResignMoraleThreshold = 20;

  // Morale 저임계 지속 시간(초)이 이 값을 넘으면 퇴사.
  private static readonly ResignTimeLimit = 60;

  // ── 효율 계산 경계 ──────────────────────────────────────────────
  // 번아웃 효율 최저 배수. Energy=0일 때 이 비율로 효율 급감.
  private static readonly BurnoutEfficiencyFloor = 0.1;

  // Morale 이 이 값 이하면 효율 페널티 시작.
  private static readonly MoralePenaltyThreshold = 40;

  // ── 퇴사 카운터 (staffId → 저임계 누적 시간) ───────────────────
  private readonly _lowMoraleTimers = new Map<string, number>();

  // ── 퇴사 후보 임시 목록(Tick 중 컬렉션 변경 방지) ──────────────
  private readonly _resignQueue: string[] = [];

  // ── 살아있는 직원 Id 스크래치 집합(매 Tick 재사용, 할당 방지) ──
  private readonly _liveStaffIds = new Set<string>();

  // ── stale 타이머 키 수집용 임시 목록(딕셔너리 순회 중 제거 방지) ──
  private readonly _staleTimerKeys: string[] = [];

  // 1 tick 전진. dt(초) 동안 모든 직원의 Energy·Morale을 갱신하고
  // 퇴사 조건을 판정한다.
  tick(state: GameState, dt: number): void {
    if (dt <= 0) {
      return;
    }

    // 외부 시스템(InterventionSystem 등)이 state.staff에서 직원을 제거하면
    // 그 직원의 _lowMoraleTimers 엔트리가 남아 (1) 딕셔너리 무한 증가(누수)와
    // (2) Id 재사용 시 stale 누적 타이머로 인한 첫 Tick 즉시 퇴사를 유발한다.
    // → 매 Tick 시작부에서 현재 살아있지 않은 키를 정리한다.
    //   (Set으로 살아있는 Id를 모은 뒤, 임시 목록에 stale 키를 모아
    //    딕셔너리 순회 중 수정 없이 제거한다.)
    this.sweepStaleTimers(state);

    // 현재 활성 HeatingRoom WarmthOutput 합산
    const totalWarmth = HrSystem.computeTotalWarmth(state.buildings);
    const isWarm = totalWarmth >= HrSystem.SufficientWarmthThreshold;

    this._resignQueue.length = 0;

    for (let i = 0; i < state.staff.length; i++) {
      const s = state.staff[i];

      HrSystem.tickEnergy(s, state.buildings, dt);
      HrSystem.tickMorale(s, isWarm, dt);
      this.tickResignTimer(state, s, dt);

      if (this.shouldResign(state, s)) {
        this._resignQueue.push(s.id);
      }
    }

    // 퇴사 처리: staff 목록 및 배치 assignedStaffIds 정리
    for (let r = 0; r < this._resignQueue.length; r++) {
      this.fireStaff(state, this._resignQueue[r]);
    }
  }

  // morale·energy 기반 효율 배수(0~1)를 반환하는 보조 쿼리.
  // 외부 시스템이 선택적으로 조회할 수 있으나, 현재 배선상 호출자는 없다.
  // 실제 능력치 조정은 StaffEffectSystem이 자체 효율 공식으로 별도 수행한다
  // (이 메서드를 호출하지 않는다). 두 공식이 다른 이유는 CLAUDE.md 설계 결정 참고.
  //   - Energy=0(번아웃) → BurnoutEfficiencyFloor(0.1) 고정.
  //   - Energy 정상, Morale < MoralePenaltyThreshold →
  //     Morale 비율로 효율 선형 감소(최저 0.3).
  //   - 정상 → 1.0.
  efficiencyOf(s: Staff | null): number {
    if (s == null) {
      return 0;
    }

    // 번아웃: 효율 급감
    if (s.energy <= 0) {
      return HrSystem.BurnoutEfficiencyFloor;
    }

    // Morale 페널티 구간
    if (s.morale < HrSystem.MoralePenaltyThreshold) {
      // Morale 0 → 0.3, Morale MoralePenaltyThreshold → 1.0 선형 보간
      const t = s.morale / HrSystem.MoralePenaltyThreshold; // 0~1
      return HrSystem.lerp(0.3, 1.0, t);
    }

    return 1.0;
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────────

  // 활성 HeatingRoom의 WarmthOutput 합을 구한다.
  private static computeTotalWarmth(buildings: Building[]): number {
    let total = 0;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (
        b != null &&
        b.type === BuildingType.HeatingRoom &&
        b.isActive &&
        b.phase === BuildingPhase.Active
      ) {
        total += b.warmthOutput;
      }
    }
    return total;
  }

  // 직원의 Energy를 dt만큼 갱신한다.
  // OnDuty=true → 소모, OnDuty=false + StaffLounge 배치 → 회복.
  // 결과는 0~100으로 clamp.
  private static tickEnergy(s: Staff, buildings: Building[], dt: number): void {
    if (s.onDuty) {
      s.energy -= HrSystem.EnergyDrainPerSec * dt;
    } else {
      // 휴식 중: StaffLounge에 배치되어 있어야 회복
      if (HrSystem.isInStaffLounge(s, buildings)) {
        s.energy += HrSystem.EnergyRecoverPerSec * dt;
      }
      // StaffLounge 외 비번 → 에너지 변화 없음
    }

    s.energy = HrSystem.clamp(s.energy, 0, 100);
  }

  // 직원의 Morale을 dt만큼 갱신한다.
  // 영향 요인: 임금 수준, 번아웃(Energy=0), 환경 온기.
  // 결과는 0~100으로 clamp.
  private static tickMorale(s: Staff, isWarm: boolean, dt: number): void {
    let delta = 0;

    // (1) 임금 수준
    if (s.wage >= HrSystem.WageReference) {
      delta += HrSystem.MoraleGoodWageGainPerSec * dt;
    } else {
      delta -= HrSystem.MoraleLowWageDrainPerSec * dt;
    }

    // (2) 번아웃 페널티
    if (s.energy <= 0) {
      delta -= HrSystem.MoraleBurnoutDrainPerSec * dt;
    }

    // (3) 환경 온기 (추위 vs 흑자 연결)
    if (isWarm) {
      delta += HrSystem.MoraleWarmGainPerSec * dt;
    } else {
      delta -= HrSystem.MoraleColdDrainPerSec * dt;
    }

    s.morale = HrSystem.clamp(s.morale + delta, 0, 100);
  }

  // 현재 state.staff에 존재하지 않는 직원 Id의 _lowMoraleTimers 엔트리를 정리한다.
  // 외부 시스템의 직원 제거로 인한 타이머 누수·오염(Id 재사용 시 즉시 퇴사)을 방지한다.
  private sweepStaleTimers(state: GameState): void {
    // 타이머가 비어 있으면 할 일 없음(흔한 경우의 빠른 반환).
    if (this._lowMoraleTimers.size === 0) {
      return;
    }

    // (1) 현재 살아있는 직원 Id를 스크래치 집합에 모은다.
    this._liveStaffIds.clear();
    const staff = state.staff;
    for (let i = 0; i < staff.length; i++) {
      const s = staff[i];
      if (s != null && s.id != null) {
        this._liveStaffIds.add(s.id);
      }
    }

    // (2) 살아있지 않은 키를 임시 목록에 모은다(딕셔너리 순회 중 제거 금지).
    this._staleTimerKeys.length = 0;
    for (const key of this._lowMoraleTimers.keys()) {
      if (!this._liveStaffIds.has(key)) {
        this._staleTimerKeys.push(key);
      }
    }

    // (3) 수집된 stale 키를 제거한다.
    for (let i = 0; i < this._staleTimerKeys.length; i++) {
      this._lowMoraleTimers.delete(this._staleTimerKeys[i]);
    }
  }

  // Morale 저임계 지속 타이머를 갱신한다.
  // 임계 초과 시 타이머를 리셋한다. state.findStaff로 유효성을 재확인해
  // 이미 제거된 직원의 타이머가 되살아나지 않게 한다.
  private tickResignTimer(state: GameState, s: Staff, dt: number): void {
    // 살아있는 직원만 타이머 갱신(이중 안전장치).
    if (state.findStaff(s.id) == null) {
      this._lowMoraleTimers.delete(s.id);
      return;
    }

    if (s.morale <= HrSystem.ResignMoraleThreshold) {
      if (!this._lowMoraleTimers.has(s.id)) {
        this._lowMoraleTimers.set(s.id, 0);
      }
      this._lowMoraleTimers.set(s.id, this._lowMoraleTimers.get(s.id)! + dt);
    } else {
      // 임계 벗어나면 타이머 리셋
      if (this._lowMoraleTimers.has(s.id)) {
        this._lowMoraleTimers.set(s.id, 0);
      }
    }
  }

  // 직원이 퇴사 조건을 충족했는지 확인한다.
  // state.findStaff로 살아있는 직원인지 재확인하여, stale 타이머에 의한 오판을 막는다.
  private shouldResign(state: GameState, s: Staff): boolean {
    if (state.findStaff(s.id) == null) {
      return false;
    }
    if (!this._lowMoraleTimers.has(s.id)) {
      return false;
    }
    return this._lowMoraleTimers.get(s.id)! >= HrSystem.ResignTimeLimit;
  }

  // 직원을 퇴사 처리한다. GameState.staff에서 제거하고
  // 모든 Building의 assignedStaffIds에서도 해당 id를 정리한다.
  private fireStaff(state: GameState, staffId: string): void {
    // staff 목록에서 제거
    for (let i = state.staff.length - 1; i >= 0; i--) {
      if (state.staff[i].id === staffId) {
        state.staff.splice(i, 1);
        break;
      }
    }

    // 건물 배치 목록 정리
    for (let b = 0; b < state.buildings.length; b++) {
      const ids = state.buildings[b].assignedStaffIds;
      const idx = ids.indexOf(staffId);
      if (idx >= 0) {
        ids.splice(idx, 1);
      }
    }

    // 타이머 정리
    this._lowMoraleTimers.delete(staffId);
  }

  // 직원이 현재 활성 StaffLounge에 배치되어 있는지 확인한다.
  private static isInStaffLounge(s: Staff, buildings: Building[]): boolean {
    if (s.assignedBuildingId == null) {
      return false;
    }
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (
        b != null &&
        b.id === s.assignedBuildingId &&
        b.type === BuildingType.StaffLounge &&
        b.isActive &&
        b.phase === BuildingPhase.Active
      ) {
        return true;
      }
    }
    return false;
  }

  // float 값을 [min, max] 범위로 clamp한다.
  private static clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  // 두 값을 t(0~1)로 선형 보간한다.
  private static lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
}
