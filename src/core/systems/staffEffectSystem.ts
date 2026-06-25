import { GameSystem } from "../contracts/index";
import { GameState } from "../gameState";
import { Building } from "../models/building";
import { Staff } from "../models/staff";
import { Guest } from "../models/guest";
import { StaffRole, GuestPhase, BuildingPhase } from "../models/enums";

// 직원 효과 시스템. CONTENT §1.1 역할표에 따라 시설에 배치된 직원의 효과를 적용한다.
//
// 역할별 효과:
// - Chef — 배치 식당의 실효 serveTime 감소(skill 비례).
// - Entertainer — 매 Tick마다 Waiting 손님의 Patience 회복(대기 이탈 지연).
// - Bellboy — 이동 시간 배율 감소(벨보이 수·skill 비례, 1.0 미만).
// - Engineer — 배치 HeatingRoom 마모로 인한 효율 저하를 상쇄.
// - Housekeeping — 배치 시설의 청결 회복량 보정.
//
// Staff.morale·energy가 낮으면 효과 감소(곱연산). 결정론: 외부 상태(DateTime·Random) 미사용.
export class StaffEffectSystem implements GameSystem {
  // ── 튜닝 상수 ───────────────────────────────────────────────────────

  // Chef 1명 skill=1.0 기준 serveTime 감소 비율 상한(50% 단축).
  private static readonly ChefMaxReduceRatio = 0.5;

  // Entertainer 1명 skill=1.0 기준 초당 patience 회복량(초).
  private static readonly EntertainerPatiencePerSecPerSkill = 2;

  // Bellboy 1명 skill=1.0 기준 이동 배율 감소분. 복수일 때 누적 적용.
  private static readonly BellboyMoveTimeReducePerSkill = 0.1;

  // Bellboy 효과 최소 이동 배율 하한(너무 빠르게 이동하지 못하도록).
  private static readonly BellboyMoveTimeMin = 0.4;

  // Engineer 1명 skill=1.0 기준 Wear 보상 효율(0=효율 저하 전혀 없음, 1=완전 상쇄).
  private static readonly EngineerWearCompensatePerSkill = 0.3;

  // Housekeeping 1명 skill=1.0 기준 초당 청결 회복량 보정(점수/초).
  private static readonly HousekeepingCleanBonusPerSkill = 5;

  // 효율 가중 평균에서 Morale 기여 비중. efficiencyMultiplier = MoraleWeight×morale/100 + EnergyWeight×energy/100.
  private static readonly MoraleWeight = 0.5;

  // 효율 가중 평균에서 Energy 기여 비중. MoraleWeight와 합 1.0이면 둘 다 100일 때 효율 1.0.
  private static readonly EnergyWeight = 0.5;

  // ── GameSystem ──────────────────────────────────────────────────────

  // 매 틱 Entertainer 효과를 적용한다. Waiting 손님의 patience를 회복시킨다.
  // 다른 역할(Chef·Bellboy·Engineer·Housekeeping)은 쿼리 메서드로 소비처에서 직접 호출한다.
  tick(state: GameState, dt: number): void {
    if (state == null || dt <= 0) return;

    // Entertainer 효과: 호텔 전체 배치된 Entertainer들의 합산 skill로
    // Waiting 상태 손님 patience를 회복시킨다. maxPatience 초과 금지.
    const totalEntertainerPower = StaffEffectSystem.computeTotalEntertainerPower(state);
    if (totalEntertainerPower <= 0) return;

    const recovery = totalEntertainerPower * StaffEffectSystem.EntertainerPatiencePerSecPerSkill * dt;
    const guests: Guest[] = state.guests;
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i];
      if (g == null) continue;
      if (g.phase !== GuestPhase.Waiting) continue;

      g.patience += recovery;
      if (g.patience > g.maxPatience) g.patience = g.maxPatience;
    }
  }

  // ── 공개 쿼리 메서드 ────────────────────────────────────────────────

  // 배치된 Chef의 skill을 반영한 시설의 실효 serveTime(초)을 반환한다.
  // Chef가 없으면 b.serveTime 그대로 반환. 복수 Chef이면 skill 합산 후 감소.
  // 감소 하한 = b.serveTime × (1 - ChefMaxReduceRatio).
  effectiveServeTime(b: Building, s: GameState): number {
    if (b == null || s == null) return 0;

    let totalSkill = 0;
    const ids: string[] = b.assignedStaffIds;
    for (let i = 0; i < ids.length; i++) {
      const st = s.findStaff(ids[i]);
      if (st == null || !st.onDuty) continue;
      if (st.role !== StaffRole.Chef) continue;
      totalSkill += st.skill * StaffEffectSystem.efficiencyMultiplier(st);
    }

    if (totalSkill <= 0) return b.serveTime;

    // 감소 비율: skill이 높을수록 더 줄지만 ChefMaxReduceRatio 상한
    let reduceRatio = totalSkill * StaffEffectSystem.ChefMaxReduceRatio;
    if (reduceRatio > StaffEffectSystem.ChefMaxReduceRatio) reduceRatio = StaffEffectSystem.ChefMaxReduceRatio;

    let effective = b.serveTime * (1 - reduceRatio);

    // 최소 serveTime = b.serveTime × (1 - ChefMaxReduceRatio), 0.1초 하한
    let minTime = b.serveTime * (1 - StaffEffectSystem.ChefMaxReduceRatio);
    if (minTime < 0.1) minTime = 0.1;
    if (effective < minTime) effective = minTime;

    return effective;
  }

  // 현재 게임 상태에 배치된 Bellboy들의 합산 효과로 이동 시간 배율을 반환한다.
  // Bellboy가 없으면 1.0. 있으면 1.0 미만으로 감소. 하한 BellboyMoveTimeMin.
  moveTimeMultiplier(s: GameState): number {
    if (s == null) return 1;

    let totalReduce = 0;
    const staff: Staff[] = s.staff;
    for (let i = 0; i < staff.length; i++) {
      const st = staff[i];
      if (st == null || !st.onDuty) continue;
      if (st.role !== StaffRole.Bellboy) continue;
      totalReduce += st.skill * StaffEffectSystem.efficiencyMultiplier(st) * StaffEffectSystem.BellboyMoveTimeReducePerSkill;
    }

    let multiplier = 1 - totalReduce;
    if (multiplier < StaffEffectSystem.BellboyMoveTimeMin) multiplier = StaffEffectSystem.BellboyMoveTimeMin;
    if (multiplier > 1) multiplier = 1;
    return multiplier;
  }

  // 배치된 Engineer의 skill을 반영한 HeatingRoom의 실효 난방 효율을 반환한다.
  // 효율 = 1.0 기준. wear가 높을수록 원래 효율이 하락하나, Engineer가 상쇄한다.
  // 공식: wearPenalty = heat.wear/100. compensate = min(engineerPower, wearPenalty).
  // 실효 효율 = 1.0 - (wearPenalty - compensate). 항상 0 ~ 1.0.
  heatingEfficiency(heat: Building, s: GameState): number {
    if (heat == null || s == null) return 1;

    const wearPenalty = heat.wear / 100;
    if (wearPenalty <= 0) return 1;

    let engineerPower = 0;
    const ids: string[] = heat.assignedStaffIds;
    for (let i = 0; i < ids.length; i++) {
      const st = s.findStaff(ids[i]);
      if (st == null || !st.onDuty) continue;
      if (st.role !== StaffRole.Engineer) continue;
      engineerPower += st.skill * StaffEffectSystem.efficiencyMultiplier(st) * StaffEffectSystem.EngineerWearCompensatePerSkill;
    }

    // 상쇄는 wearPenalty 이상 올라가지 않음
    let compensate = engineerPower;
    if (compensate > wearPenalty) compensate = wearPenalty;

    let efficiency = 1 - (wearPenalty - compensate);
    if (efficiency < 0) efficiency = 0;
    if (efficiency > 1) efficiency = 1;
    return efficiency;
  }

  // 배치된 Housekeeping의 skill을 반영한 해당 시설의 초당 청결 회복량 보정을 반환한다.
  // Housekeeping이 없으면 0. 배치되면 양수 보정이 MaintenanceSystem 등에 더해진다.
  cleanRateBonus(b: Building, s: GameState): number {
    if (b == null || s == null) return 0;

    let totalBonus = 0;
    const ids: string[] = b.assignedStaffIds;
    for (let i = 0; i < ids.length; i++) {
      const st = s.findStaff(ids[i]);
      if (st == null || !st.onDuty) continue;
      if (st.role !== StaffRole.Housekeeping) continue;
      totalBonus += st.skill * StaffEffectSystem.efficiencyMultiplier(st) * StaffEffectSystem.HousekeepingCleanBonusPerSkill;
    }

    return totalBonus;
  }

  // ── 내부 헬퍼 ───────────────────────────────────────────────────────

  // Morale·Energy 기반 효율 배율을 반환한다. 양쪽 모두 100이면 1.0.
  // 공식: (MoraleWeight × morale/100) + (EnergyWeight × energy/100).
  // 가중 평균이므로 0 ~ 1.0 범위.
  private static efficiencyMultiplier(st: Staff): number {
    const moraleFactor = StaffEffectSystem.MoraleWeight * StaffEffectSystem.clamp01(st.morale / 100);
    const energyFactor = StaffEffectSystem.EnergyWeight * StaffEffectSystem.clamp01(st.energy / 100);
    return moraleFactor + energyFactor;
  }

  // 호텔 전체 배치된 Entertainer들의 합산 유효 skill을 반환한다.
  private static computeTotalEntertainerPower(state: GameState): number {
    let total = 0;
    const staff: Staff[] = state.staff;
    for (let i = 0; i < staff.length; i++) {
      const st = staff[i];
      if (st == null || !st.onDuty) continue;
      if (st.role !== StaffRole.Entertainer) continue;
      // 배치된 시설이 있고 활성 상태여야 효과 발동
      if (st.assignedBuildingId == null) continue;
      const b = state.findBuilding(st.assignedBuildingId);
      if (b == null || !b.isActive || b.phase !== BuildingPhase.Active) continue;
      total += st.skill * StaffEffectSystem.efficiencyMultiplier(st);
    }
    return total;
  }

  // 값을 0 ~ 1 범위로 제한한다.
  private static clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }
}
