import { Guest } from "../models/guest";
import { Need } from "../models/need";
import { MvpConfig } from "../config/mvpConfig";
import { roundAwayFromZero, clamp } from "../util/mathx";

// 손님 퇴장 시 만족도·코인·평판을 계산하는 정적 유틸리티 클래스.
// CORE_LOOP §4(만족도/결제 공식) 준수.
// 결정론적: 외부 상태(DateTime, Random) 미사용 — 같은 입력이면 항상 같은 출력.
export class SatisfactionCalculator {
  // 여정 전체 만족도를 계산한다.
  // 공식: satisfaction = Σ(Itinerary[i].Weight × Guest.StepSatisfactions[i]) − warmthPenalty, 0~100 clamp.
  // StepSatisfactions 원소 수가 Itinerary.Count보다 적으면 미완료 단계는 0점으로 취급한다.
  // 덕분에 정상 완주(Checkout) 손님뿐 아니라 도중 단계까지만 진행한 손님에게도 안전하게 호출할 수 있다.
  // g: 평가할 손님 인스턴스. warmthPenalty: WarmthSystem.ComputeWarmthPenalty 가 반환한 온기 차감값(0 이상).
  // 반환: 0~100 범위로 clamp된 최종 만족도.
  static computeSatisfaction(g: Guest, warmthPenalty: number): number {
    if (g == null) throw new Error("g");
    if (g.itinerary == null || g.itinerary.length === 0) return 0;

    let weighted = 0;
    for (let i = 0; i < g.itinerary.length; i++) {
      const need: Need = g.itinerary[i];
      if (need == null) continue;
      const stepSat = i < g.stepSatisfactions.length ? g.stepSatisfactions[i] : 0;
      weighted += need.weight * stepSat;
    }

    const raw = weighted - warmthPenalty;
    return clamp(raw, 0, 100); // 0~100 clamp
  }

  // 만족도 비율에 따라 지급할 코인을 계산한다.
  // 공식: round(CoinBase × satisfaction / 100).
  // g: 대상 손님. satisfaction: ComputeSatisfaction 반환값(0~100). 반환: 지급 코인 양(0 이상).
  static computePayout(g: Guest, satisfaction: number): number {
    if (g == null) throw new Error("g");
    const ratio = clamp(satisfaction, 0, 100) / 100;
    return roundAwayFromZero(g.coinBase * ratio);
  }

  // 만족도 비율에 따라 획득할 평판을 계산한다.
  // 공식: round(RepBase × satisfaction / 100).
  // g: 대상 손님. satisfaction: ComputeSatisfaction 반환값(0~100). 반환: 획득 평판(0 이상).
  static computeRepGain(g: Guest, satisfaction: number): number {
    if (g == null) throw new Error("g");
    const ratio = clamp(satisfaction, 0, 100) / 100;
    return roundAwayFromZero(g.repBase * ratio);
  }

  // 손님이 인내심 소진으로 화내고 퇴장(AngryLeaving)할 때 차감할 평판 페널티를 반환한다.
  // 공식: round(RepBase × MvpConfig.AngryRepPenaltyFactor). 양수(차감액)로 반환(CORE_LOOP §4).
  // 이 경우 코인 지급은 0이며, 호출자는 reputation -= 반환값 으로 적용한다.
  // g: 화내고 퇴장하는 손님. 반환: 차감할 평판 양(양수).
  static computeAngryRepPenalty(g: Guest): number {
    if (g == null) throw new Error("g");
    return roundAwayFromZero(g.repBase * MvpConfig.angryRepPenaltyFactor);
  }
}
