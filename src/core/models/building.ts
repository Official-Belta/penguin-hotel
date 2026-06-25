import { BuildingType, NeedType, BuildingPhase, ZoneId } from "./enums";

// 시설 1동. CORE_LOOP §3.2. HeatingRoom은 손님을 안 받고 WarmthOutput을 생산(Upkeep 소모).
export class Building {
  // ---------- [SPEC] ----------
  id!: string;
  type!: BuildingType;

  // 이 시설이 충족하는 욕구. HeatingRoom은 Warmth(생산)로 표기.
  servesNeed!: NeedType;

  capacity: number = 0; // 동시 수용 손님 수
  serveTime: number = 0; // 1회 응대 소요(초)
  satisfaction: number = 0; // 0~100, 욕구 충족 품질 (레벨로 상승)
  level: number = 1;
  buildCost: number = 0;
  upgradeCost: number = 0;
  buildTime: number = 0; // 실시간 건설 타이머(초)
  upgradeTime: number = 0;

  warmthOutput: number = 0; // HeatingRoom 전용: 생산 온기
  upkeep: number = 0; // HeatingRoom 전용: 운영비(coin/min)

  // ---------- [RUNTIME] ----------
  // 현재 응대 중인 손님 수. Occupancy < Capacity 이면 수용 가능.
  occupancy: number = 0;

  // 건설 완료되어 가동 중인가. (UNDER_CONSTRUCTION 동안 false)
  isActive: boolean = true;

  // ── 확장(전체 로직): 생애주기 / 유지보수 / 배치 / 구역 ──
  // 생애주기 단계(건설/가동/업그레이드). ConstructionSystem이 관리.
  phase: BuildingPhase = BuildingPhase.Active;

  // 건설/업그레이드 남은 시간(초). Phase가 Active가 아닐 때 카운트다운.
  buildTimer: number = 0;

  // 청결도 0~100. 시간이 지나면 하락(MaintenanceSystem). 낮으면 만족도↓.
  cleanliness: number = 100;

  // 마모도 0~100(높을수록 낡음). 방치 시 상승, 수리로 하락.
  wear: number = 0;

  // 소속 구역.
  zone: ZoneId = ZoneId.HomeIce;

  // 이 시설에 배치된 직원 id 목록(빈 목록=무배치). StaffEffectSystem이 효과 적용.
  readonly assignedStaffIds: string[] = [];

  get hasFreeSlot(): boolean {
    return this.isActive && this.phase === BuildingPhase.Active && this.occupancy < this.capacity;
  }
}
