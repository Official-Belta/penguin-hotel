import { Guest } from "../models/guest";
import { Building } from "../models/building";
import { Need } from "../models/need";
import { GuestPhase } from "../models/enums";
import { WarmthSystem } from "./warmthSystem";
import { SatisfactionCalculator } from "./satisfactionCalculator";

// 손님 1명의 상태머신(GuestStateMachine). CORE_LOOP §8(다중 욕구 여정) 충실 구현.
//
// 매 tick 손님을 한 단계 전진시킨다:
// Arriving → (Waiting → Moving → BeingServed)* → Checkout → Leaving → Done,
// 실패 시 → AngryLeaving → Done.
//
// 이탈 조건은 patience 0 하나로 통일(이슈6 soft 모델). 체온(bodyWarmth)은
// 즉사 타이머가 아니라 WarmthSystem을 통해 patience 소모 배율 + 만족도 차감으로 소프트하게 작용한다.
//
// ★캐스케이드 차단(이슈4): patience는 손님마다 개별 필드(guest.patience)라
// 도착 시점이 다르면 0이 되는 시점도 흩어진다 → 병목 시 동시 도미노 이탈을 차단한다.
// 시설이 꽉 차면 손님은 이탈하지 않고 줄서서 대기(Waiting 유지)한다.
//
// Unity 비의존 순수 코드. 외부 상태(DateTime/Random) 미사용 — 결정론적.
export class GuestStateMachine {
  // Waiting→Moving 진입 시 세팅하는 고정 이동 시간(초). CORE_LOOP §8.
  private static readonly fixedMoveTime: number = 2;

  // 체온·patience 계산을 위임할 온기 시스템.
  private readonly warmth: WarmthSystem;

  // ── 통합 효과 훅(선택): 직원·유지보수·이벤트 효과를 serveTime/만족도/페널티에 반영. null이면 기존 동작. ──
  private readonly serveTimeProvider: ((b: Building) => number) | null;
  private readonly stepSatProvider: ((b: Building) => number) | null;
  private readonly extraPenalty: ((g: Guest) => number) | null;

  // 상태머신을 생성한다. 효과 provider는 모두 선택 — 없으면 시설 기본값(기존 동작) 사용.
  // warmth: 체온 갱신·patience 배율·온기 페널티 계산을 담당하는 WarmthSystem.
  // serveTimeProvider: 시설 실효 serveTime(직원/이벤트 반영). null이면 building.serveTime.
  // stepSatProvider: 단계 실효 만족도(유지보수 반영). null이면 building.satisfaction.
  // extraPenalty: 체크아웃 추가 페널티(손님 단위, 0 이상). null이면 0.
  constructor(
    warmth: WarmthSystem,
    serveTimeProvider: ((b: Building) => number) | null = null,
    stepSatProvider: ((b: Building) => number) | null = null,
    extraPenalty: ((g: Guest) => number) | null = null
  ) {
    if (warmth == null) throw new Error("warmth");
    this.warmth = warmth;
    this.serveTimeProvider = serveTimeProvider;
    this.stepSatProvider = stepSatProvider;
    this.extraPenalty = extraPenalty;
  }

  // 시설의 실효 serveTime(provider 있으면 그 값, 없으면 기본).
  private effectiveServeTime(b: Building): number {
    return this.serveTimeProvider != null ? this.serveTimeProvider(b) : b.serveTime;
  }

  // 단계 실효 만족도(provider 있으면 그 값, 없으면 기본).
  private effectiveStepSatisfaction(b: Building): number {
    return this.stepSatProvider != null ? this.stepSatProvider(b) : b.satisfaction;
  }

  // 손님 1명을 1 tick 전진시킨다. 현재 phase에 따라 상태 전이를 수행한다.
  // g: 전진시킬 손님. null이면 무시.
  // dt: 경과 시간(초, delta-time).
  // buildings: 현재 가동 중인 시설 풀(배정 후보).
  // onCheckout: 여정 완료 후 만족 퇴장 시 호출. (guest, payoutCoin, repGain).
  //   호출자가 코인 풍선 표시·자원 적립을 처리한다.
  // onAngry: patience 0으로 화난 퇴장 시 호출. (guest, repPenalty). repPenalty는 차감액(양수).
  //   호출자가 reputation -= repPenalty 로 적용한다.
  tick(
    g: Guest | null,
    dt: number,
    buildings: ReadonlyArray<Building>,
    onCheckout: ((g: Guest, payout: number, rep: number) => void) | null,
    onAngry: ((g: Guest, rep: number) => void) | null
  ): void {
    if (g == null) return;

    switch (g.phase) {
      case GuestPhase.Arriving:
        GuestStateMachine.tickArriving(g);
        break;

      case GuestPhase.Waiting:
        this.tickWaiting(g, dt, buildings, onAngry);
        break;

      case GuestPhase.Moving:
        this.tickMoving(g, dt);
        break;

      case GuestPhase.BeingServed:
        this.tickBeingServed(g, dt);
        break;

      case GuestPhase.Checkout:
        this.tickCheckout(g, onCheckout);
        break;

      case GuestPhase.AngryLeaving:
        this.tickAngryLeaving(g, onAngry);
        break;

      case GuestPhase.Leaving:
        // 만족 퇴장 연출 단계. 다음 tick에 제거 대상으로 전환.
        g.phase = GuestPhase.Done;
        break;

      case GuestPhase.Done:
        // 제거 대상. 더 할 일 없음.
        break;
    }
  }

  // ── 상태별 처리 ────────────────────────────────────────────

  // Arriving: 여정 시작. stepIndex=0, patience=maxPatience로 초기화하고 Waiting 진입.
  private static tickArriving(g: Guest): void {
    g.stepIndex = 0;
    g.patience = g.maxPatience;
    g.phase = GuestPhase.Waiting;
  }

  // Waiting: 현재 욕구를 충족하는 빈 시설을 찾으면 배정(occupancy++ → Moving),
  // 못 찾으면 줄서서 개별 patience 카운트다운(0 이하 → AngryLeaving).
  private tickWaiting(
    g: Guest,
    dt: number,
    buildings: ReadonlyArray<Building>,
    onAngry: ((g: Guest, rep: number) => void) | null
  ): void {
    // 여정이 이미 끝났다면(방어적) 바로 Checkout으로.
    if (g.itineraryComplete) {
      g.phase = GuestPhase.Checkout;
      return;
    }

    const target = GuestStateMachine.findServingBuilding(g, buildings);
    if (target != null) {
      // 배정 성공: 슬롯 점유 후 시설로 이동 시작.
      target.occupancy++;
      g.currentBuilding = target;
      g.stepTimer = GuestStateMachine.fixedMoveTime;
      g.phase = GuestPhase.Moving;
      return;
    }

    // 배정 실패: 줄서서 대기. ★개별 patience 카운트다운(이슈4 캐스케이드 차단).
    // 체온이 낮을수록 더 빨리 닳음(WarmthSystem soft 작용, 이슈6).
    g.patience -= dt * this.warmth.patienceDrainMultiplier(g);
    if (g.patience <= 0) {
      this.enterAngryLeaving(g, onAngry);
    }
  }

  // Moving: 야외 이동 → 체온 하락. stepTimer 소진 시 BeingServed(stepTimer=serveTime) 진입.
  private tickMoving(g: Guest, dt: number): void {
    // 이동은 야외 → 체온 하락(isOutdoors=true).
    this.warmth.updateBodyWarmth(g, true, dt);

    g.stepTimer -= dt;
    if (g.stepTimer <= 0) {
      // 도착: 시설 응대 시작. serveTime은 시설별 값(직원/이벤트 효과 반영 가능).
      g.stepTimer = g.currentBuilding != null ? this.effectiveServeTime(g.currentBuilding) : 0;
      g.phase = GuestPhase.BeingServed;
    }
  }

  // BeingServed: serveTime 소진 시 단계 만족 기록·슬롯 반납·stepIndex++ 후
  // 다음 단계 있으면 Waiting(patience 리셋) / 없으면 Checkout.
  private tickBeingServed(g: Guest, dt: number): void {
    g.stepTimer -= dt;
    if (g.stepTimer > 0) return;

    // 응대 완료: 이 단계에서 실제 사용한 시설의 만족도를 기록.
    const used = g.currentBuilding;
    if (used != null) {
      g.stepSatisfactions.push(this.effectiveStepSatisfaction(used));
      // 슬롯 반납(다음 손님이 들어올 수 있게).
      used.occupancy--;
    }
    g.currentBuilding = null;
    g.stepIndex++;

    if (!g.itineraryComplete) {
      // 다음 욕구 단계로: patience를 maxPatience로 리셋하고 다시 줄서기.
      g.patience = g.maxPatience;
      g.phase = GuestPhase.Waiting;
    } else {
      // 여정 끝 → 정산.
      g.phase = GuestPhase.Checkout;
    }
  }

  // Checkout: 온기 페널티 반영 만족도 산출 → 코인/평판 콜백 → Leaving 진입.
  private tickCheckout(g: Guest, onCheckout: ((g: Guest, payout: number, rep: number) => void) | null): void {
    let warmthPenalty = this.warmth.computeWarmthPenalty(g);
    if (this.extraPenalty != null) warmthPenalty += this.extraPenalty(g);
    const satisfaction = SatisfactionCalculator.computeSatisfaction(g, warmthPenalty);
    const payout = SatisfactionCalculator.computePayout(g, satisfaction);
    const repGain = SatisfactionCalculator.computeRepGain(g, satisfaction);

    if (onCheckout != null) onCheckout(g, payout, repGain);

    g.phase = GuestPhase.Leaving;
  }

  // AngryLeaving: 점유 중 슬롯이 있으면 반납하고, 평판 차감 콜백 후 Done.
  private tickAngryLeaving(g: Guest, onAngry: ((g: Guest, rep: number) => void) | null): void {
    GuestStateMachine.releaseSlot(g);

    const repPenalty = SatisfactionCalculator.computeAngryRepPenalty(g);
    if (onAngry != null) onAngry(g, repPenalty);

    g.phase = GuestPhase.Done;
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────

  // patience 0으로 인한 화난 퇴장 처리를 즉시 수행한다(슬롯 반납 → 콜백 → Done).
  // Waiting 중 대기열에서 호출되며 같은 tick에 마무리한다.
  private enterAngryLeaving(g: Guest, onAngry: ((g: Guest, rep: number) => void) | null): void {
    g.phase = GuestPhase.AngryLeaving;
    this.tickAngryLeaving(g, onAngry);
  }

  // 현재 욕구(currentNeed.type)를 충족(servesNeed)하면서 빈 슬롯(hasFreeSlot)이 있는
  // 첫 시설을 반환한다. 후보가 없으면 null.
  private static findServingBuilding(g: Guest, buildings: ReadonlyArray<Building>): Building | null {
    const need: Need | null = g.currentNeed;
    if (need == null || buildings == null) return null;

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b != null && b.servesNeed === need.type && b.hasFreeSlot) {
        return b;
      }
    }
    return null;
  }

  // 손님이 점유 중인 시설 슬롯이 있으면 반납(occupancy--)하고 currentBuilding을 비운다.
  // 이미 슬롯이 없으면(Waiting 중 등) 아무 일도 하지 않는다.
  private static releaseSlot(g: Guest): void {
    if (g.currentBuilding != null) {
      g.currentBuilding.occupancy--;
      g.currentBuilding = null;
    }
  }
}
