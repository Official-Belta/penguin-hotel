import { Species, GuestTier, GuestPhase } from "./enums";
import { Need } from "./need";
import { Building } from "./building";

// 손님 1명. CORE_LOOP §3.1 + 상태머신 §8.
// [SPEC] 필드 = 스폰 시 확정(불변 취급). [RUNTIME] 필드 = GuestStateMachine이 매 tick 갱신.
export class Guest {
  // ---------- [SPEC] 스폰 시 세팅 ----------
  id!: string;
  species!: Species;
  tier: GuestTier = GuestTier.Normal;

  // 욕구 여정(순서대로 들를 시설 욕구). weight 합 = 1.0.
  itinerary!: ReadonlyArray<Need>;

  // 여정 전체 만족 100% 기준 지불 코인.
  coinBase!: number;
  repBase!: number;

  // 각 Waiting 단계에서 버티는 최대 시간(초). 이 값으로 Patience를 리셋.
  maxPatience!: number;

  // ---------- [RUNTIME] GuestStateMachine이 변경 ----------
  phase: GuestPhase = GuestPhase.Arriving;

  // 현재 여정 단계 인덱스 (0..Itinerary.Count).
  stepIndex: number = 0;

  // 현재 Waiting 단계의 남은 인내심(초). 0 이하 → AngryLeaving.
  patience!: number;

  // 체온 0~100. 야외 이동 중 하락, 따뜻한 곳에서 회복. 이슈6: 즉사 아님(soft).
  bodyWarmth: number = 100;

  // 완료한 각 단계에서 실제 사용한 시설의 satisfaction 기록(만족도 합산용).
  readonly stepSatisfactions: number[] = [];

  // 현재 배정/이용 중인 시설 (Waiting 중엔 null).
  currentBuilding: Building | null = null;

  // Moving 남은 시간(초) 또는 BeingServed 남은 serveTime(초).
  stepTimer!: number;

  // 현재 단계의 욕구. 여정 끝났으면 null.
  get currentNeed(): Need | null {
    if (this.itinerary == null || this.stepIndex < 0 || this.stepIndex >= this.itinerary.length) return null;
    return this.itinerary[this.stepIndex];
  }

  get itineraryComplete(): boolean {
    return this.itinerary == null || this.stepIndex >= this.itinerary.length;
  }
}
