import { StaffRole, Rarity, StaffTrait } from "./enums";

// 직원 1명. CONTENT §1.2 (MVP 최소 버전 — morale/energy 등 HR 확장은 후순위).
// MVP 핵심: Bellboy(이동속도↑), Entertainer(대기 patience 회복), Chef(serveTime↓).
export class Staff {
  id!: string;
  role!: StaffRole;
  name!: string;
  rarity: Rarity = Rarity.Common;
  level: number = 1;

  // 역할별 능력 배수(속도/품질 등). 1.0 = 기본.
  skill: number = 1;

  // 운영비(coin/min).
  wage!: number;

  // ── 확장(HR/배치): CONTENT §1.5 ──
  // 사기 0~100. 효율·이탈 좌우. 낮으면 효율↓, 심하면 퇴사.
  morale: number = 100;

  // 체력 0~100. 일하면 소모, 휴게실서 회복. 0=번아웃.
  energy: number = 100;

  // 특성(레어 효과).
  trait: StaffTrait = StaffTrait.None;

  // 배치된 시설 id(미배치면 null).
  assignedBuildingId: string | null = null;

  // 근무 중 여부(휴식 중이면 false).
  onDuty: boolean = true;
}
