import { GameSystem } from "../contracts/index";
import { GameState } from "../gameState";
import { Building } from "../models/building";
import { BuildingPhase, BuildingType } from "../models/enums";
import { StaffEffectSystem } from "./staffEffectSystem";

// 시설 유지보수 시스템. GAME_DESIGN §0.5(중간 압박, 영구 손실 없음).
//
// 매 Tick마다 Active 시설의 Cleanliness를 낮추고 Wear를 높인다.
// 손님이 사용 중(Occupancy > 0)이면 더 빨리 더러워진다.
//
// 청결도 완화는 두 경로로 작동한다:
//  - 세탁실(Laundry) — 손님 시설 보조 설비. 1동 이상 Active이면 호텔 전체 청결 decay에
//    전역 완화 계수(LaundryCleanMitigationFactor)를 곱한다(CONTENT §2 '하우스키핑 보조, 방치 페널티 완화').
//  - 하우스키핑(Housekeeping) — 전역 플랫 계수가 아니라 시설별 배치·스킬 기반 가산 회복이다.
//    각 시설의 AssignedStaffIds를 보는 StaffEffectSystem.cleanRateBonus(building, state)를 호출해
//    그 시설에만 양수 회복량을 더한다(CONTENT §1.1 '청결 회복량', §1.2 line 30).
//    따라서 어느 시설에도 배치되지 않은 하우스키퍼는 어떤 시설의 청결에도 영향을 주지 않는다.
//
// 영구 고장·붕괴는 절대 없음 — clean/repair로 항상 원상 복구 가능.
export class MaintenanceSystem implements GameSystem {
  // ── 의존성(생성자 주입) ────────────────────────────────────

  // 하우스키핑 배치·스킬 기반 청결 회복 보정을 계산하는 형제 시스템.
  // 시설별 StaffEffectSystem.cleanRateBonus(building, state)를 호출한다.
  private readonly staffEffects: StaffEffectSystem;

  // ── 기본 decay 상수 ────────────────────────────────────────

  // 기본 청결도 하락 속도(포인트/초). 손님 없을 때 적용.
  private static readonly BaseCleanDecayPerSec = 0.5;

  // 손님 사용 중일 때 추가로 적용되는 청결도 하락 배율.
  private static readonly OccupiedDecayMultiplier = 2.5;

  // 기본 마모도 상승 속도(포인트/초). 손님 없을 때 적용.
  private static readonly BaseWearRatePerSec = 0.2;

  // 손님 사용 중일 때 추가로 적용되는 마모도 상승 배율.
  private static readonly OccupiedWearMultiplier = 2.0;

  // 세탁실(Laundry)이 1동 이상 Active일 때 청결도 decay에 곱하는 완화 계수
  // (1보다 작을수록 느리게 더러워짐).
  // 세탁실은 손님 시설 보조 설비이므로 전역 계수로 유지한다(CONTENT §2).
  // 하우스키핑과 달리 특정 시설 배치 개념이 없다.
  private static readonly LaundryCleanMitigationFactor = 0.6;

  // ── SatisfactionPenalty 상수 ───────────────────────────────

  // 청결도 기준: 이 값 미만일 때 만족도 차감이 시작된다.
  private static readonly CleanlinessThreshold = 80;

  // 마모도 기준: 이 값 초과일 때 만족도 차감이 시작된다.
  private static readonly WearThreshold = 30;

  // 청결도 1포인트 부족당 만족도 차감량.
  private static readonly CleannessPenaltyPerPoint = 0.3;

  // 마모도 1포인트 초과당 만족도 차감량.
  private static readonly WearPenaltyPerPoint = 0.2;

  // 시설 1곳 방치 페널티의 상한(0~100 만족도 스케일).
  // satisfactionPenalty(building) 반환값은 손님의 한 여정 단계 만족도
  // (Guest.stepSatisfactions, 0~100)에서 차감되는 단위이므로 단일 시설이 한 단계
  // 만족도를 100점 전부 깎지 못하도록 cap을 둔다. 완전 방치(청결 0·마모 100)여도
  // 한 단계당 최대 이 값만큼만 차감된다.
  private static readonly MaxSatisfactionPenalty = 40;

  // ── Clean / Repair 상수 ────────────────────────────────────

  // repair 호출 시 마모도 감소량(포인트). 영구 고장이 없도록 항상 양수 감소.
  private static readonly RepairAmount = 40;

  // ── 생성자 ────────────────────────────────────────────────

  // 유지보수 시스템을 생성한다.
  // 하우스키핑의 시설별 청결 회복 보정은 자체 전역 계수가 아니라 형제 계약 StaffEffectSystem에
  // 위임한다(배치·스킬·사기·체력 기반). 따라서 같은 게임 세션이 공유하는 StaffEffectSystem
  // 인스턴스를 주입해야 한다.
  constructor(staffEffects: StaffEffectSystem) {
    if (staffEffects == null) throw new Error("staffEffects");
    this.staffEffects = staffEffects;
  }

  // ── GameSystem 구현 ──────────────────────────────────────

  // 매 프레임(dt초) 호텔 시설 상태를 갱신한다.
  // Active 시설만 처리. 건설/업그레이드 중인 시설은 건너뜀.
  // dt가 0 이하이면 즉시 반환.
  tick(state: GameState, dt: number): void {
    if (state == null) throw new Error("state");
    if (dt <= 0) return;

    // 세탁실(손님 시설 보조 설비)은 전역 완화 계수로 적용.
    // 하우스키핑은 전역 계수가 아니라 시설별 cleanRateBonus(가산 회복)로 처리한다.
    const hasLaundry = MaintenanceSystem.hasActiveLaundry(state.buildings);
    const cleanMitigation = hasLaundry ? MaintenanceSystem.LaundryCleanMitigationFactor : 1;

    const buildings = state.buildings;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b == null) continue;
      if (!b.isActive || b.phase !== BuildingPhase.Active) continue;

      const occupied = b.occupancy > 0;

      // ── 청결도 하락 ──────────────────────────
      let cleanDecay = MaintenanceSystem.BaseCleanDecayPerSec;
      if (occupied) cleanDecay *= MaintenanceSystem.OccupiedDecayMultiplier;
      cleanDecay *= cleanMitigation;

      // 하우스키핑 배치·스킬 기반 가산 회복(이 시설에 배치된 직원만 반영).
      // cleanRateBonus는 b.assignedStaffIds를 보고 Skill·Morale·Energy로 스케일한다.
      const cleanBonus = this.staffEffects.cleanRateBonus(b, state);

      b.cleanliness = MaintenanceSystem.clamp(
        b.cleanliness - cleanDecay * dt + cleanBonus * dt,
        0,
        100,
      );

      // ── 마모도 상승 ──────────────────────────
      let wearRate = MaintenanceSystem.BaseWearRatePerSec;
      if (occupied) wearRate *= MaintenanceSystem.OccupiedWearMultiplier;

      b.wear = MaintenanceSystem.clamp(b.wear + wearRate * dt, 0, 100);
    }
  }

  // ── 공개 쿼리 ────────────────────────────────────────────

  // 시설의 청결·마모 상태에 따른 방치 만족도 차감값을 반환한다(0 ~ MaxSatisfactionPenalty).
  // GAME_DESIGN §0.5('방치 시 손님 만족도↓').
  //
  // 단위/스케일: 반환값은 손님 한 명의 한 여정 단계 만족도(Guest.stepSatisfactions 원소, 0~100)에서
  // 그대로 차감되는 값이다. SatisfactionCalculator.computeSatisfaction(guest, ...)의 warmthPenalty와
  // 동일한 0~100 스케일 차감 단위이며, 단일 시설이 한 단계를 100점 전부 깎지 못하도록
  // MaxSatisfactionPenalty로 상한(cap)을 둔다.
  //
  // 소비 계약(연결 지점): 이 값은 현재 코드베이스의 어떤 시스템도 자동으로 소비하지 않는다.
  // 따라서 호출측(권장: 손님이 BeingServed를 마치고 단계 만족도를 Guest.stepSatisfactions에
  // 기록하는 시점)이 stepSat = clamp(used.satisfaction - maintenance.satisfactionPenalty(used), 0, 100)
  // 형태로 해당 단계 만족도에서 직접 차감해야 한다. 이 정규화·상한이 적용되기 전까지는
  // 방치가 만족도에 실제로 반영되지 않는다.
  //
  // Cleanliness < CleanlinessThreshold 이거나 Wear > WearThreshold이면 방치 페널티가 발생한다.
  // b가 null이면 0 반환.
  satisfactionPenalty(b: Building | null): number {
    if (b == null) return 0;

    let penalty = 0;

    // 청결도 페널티: threshold 미만 부분만큼 차감
    const cleanShortfall = MaintenanceSystem.CleanlinessThreshold - b.cleanliness;
    if (cleanShortfall > 0) penalty += cleanShortfall * MaintenanceSystem.CleannessPenaltyPerPoint;

    // 마모도 페널티: threshold 초과 부분만큼 차감
    const wearExcess = b.wear - MaintenanceSystem.WearThreshold;
    if (wearExcess > 0) penalty += wearExcess * MaintenanceSystem.WearPenaltyPerPoint;

    if (penalty < 0) return 0;
    // 0~100 단계 만족도 스케일에 맞춰 상한 적용(단일 시설 과도 차감 방지).
    return penalty > MaintenanceSystem.MaxSatisfactionPenalty
      ? MaintenanceSystem.MaxSatisfactionPenalty
      : penalty;
  }

  // ── 공개 액션 ────────────────────────────────────────────

  // 시설을 청소한다. Cleanliness를 100으로 즉시 회복.
  // 영구 손실 없음 — 항상 호출 가능. b가 null이면 아무 작업도 하지 않음.
  clean(b: Building | null): void {
    if (b == null) return;
    b.cleanliness = 100;
  }

  // 시설을 수리한다. Wear를 RepairAmount만큼 감소(0 clamp).
  // 영구 고장 없음 — 항상 회복 가능. b가 null이면 아무 작업도 하지 않음.
  repair(b: Building | null): void {
    if (b == null) return;
    b.wear = MaintenanceSystem.clamp(b.wear - MaintenanceSystem.RepairAmount, 0, 100);
  }

  // ── 내부 헬퍼 ────────────────────────────────────────────

  // Active 세탁실이 1동 이상 있는지 확인한다.
  private static hasActiveLaundry(buildings: Building[]): boolean {
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (
        b != null &&
        b.isActive &&
        b.phase === BuildingPhase.Active &&
        b.type === BuildingType.Laundry
      )
        return true;
    }
    return false;
  }

  // 값을 [min, max] 범위로 제한한다.
  private static clamp(v: number, min: number, max: number): number {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }
}
