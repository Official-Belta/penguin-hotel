import { MvpConfig } from "../config/mvpConfig";
import { Building } from "../models/building";
import { Guest } from "../models/guest";
import { Need } from "../models/need";
import { BuildingType, NeedType } from "../models/enums";

// 온기(Warmth) 시스템. CORE_LOOP §5(온기), §8(체온 soft 모델, GAME_DESIGN 이슈6) 준수.
// 역할 3가지:
// ① 등록된 시설 풀에서 활성 HeatingRoom WarmthOutput 합을 캐시(ambient 온기 판단용).
// ② 손님 개인 체온(BodyWarmth)을 delta-time으로 갱신.
// ③ 만족도 차감용 warmthPenalty 및 체온 기반 patience 가속 배율 산출.
// 결정론적: 외부 상태(DateTime, Random) 미사용.
export class WarmthSystem {
  // ── 페널티 튜닝 상수 (만족도 차감 형태 결정) ──────────────────
  // 주의: MvpConfig는 계약(읽기 전용)이라 여기 추가할 수 없어, warmthPenalty 형태를
  //       결정하는 MVP 튜닝값만 네임드 상수로 국소화한다. (전부 시작값, 밸런싱으로 조정 전제)

  // ambient 만족 기준 출력. HeatingRoom 1기 기본 WarmthOutput(=50) 기준.
  private static readonly warmthOutputReference = 50;

  // Warmth 욕구 100% 가중, 난방 전무일 때의 최대 ambient 차감 점수.
  private static readonly maxAmbientPenalty = 30;

  // 체온 0일 때의 최대 체온 차감 점수(욕구 무관 상시 압박분).
  private static readonly maxBodyPenalty = 20;

  // ── 내부 상태 ──────────────────────────────────────────────

  // 등록된 시설 풀에서 산출한 활성 HeatingRoom 총 WarmthOutput 합(ambient 캐시).
  private totalWarmthOutput = 0;

  // 현재 등록된 시설 풀. RegisterBuildings 때마다 교체된다(ambient 계산용 캐시).
  private buildings: ReadonlyArray<Building> = [];

  // ── 생성자 ─────────────────────────────────────────────────

  // 기본 생성자. Unity DI 없이도 바로 생성·사용 가능.
  constructor() {}

  // ── 공개 API ───────────────────────────────────────────────

  // 현재 호텔의 시설 풀을 등록하고, 활성 HeatingRoom들의 WarmthOutput 합을 재산출해 캐시한다.
  // 매 틱마다 호출할 필요는 없으며, 시설이 건설/철거/활성화되어 ambient 온기가 바뀔 때 호출한다.
  registerBuildings(buildings: ReadonlyArray<Building>): void {
    if (buildings == null) throw new Error("buildings");
    this.buildings = buildings;
    this.totalWarmthOutput = WarmthSystem.computeTotalWarmthOutput(buildings);
  }

  // 손님 1명의 체온(BodyWarmth)을 delta-time 기반으로 갱신한다.
  // 야외(isOutdoors=true): 초당 OutdoorWarmthDrainPerSec 만큼 하락.
  // 실내 또는 난방 보도/난방 커버 구역(isOutdoors=false): 초당 WarmthRecoverPerSec 만큼 회복.
  // 결과는 0 ~ BodyWarmthMax 범위로 clamp.
  updateBodyWarmth(g: Guest, isOutdoors: boolean, dt: number): void {
    if (g == null) throw new Error("g");
    if (dt <= 0) return;

    if (isOutdoors) g.bodyWarmth -= MvpConfig.outdoorWarmthDrainPerSec * dt;
    else g.bodyWarmth += MvpConfig.warmthRecoverPerSec * dt;

    // 0 ~ BodyWarmthMax clamp
    if (g.bodyWarmth < 0) g.bodyWarmth = 0;
    else if (g.bodyWarmth > MvpConfig.bodyWarmthMax) g.bodyWarmth = MvpConfig.bodyWarmthMax;
  }

  // 체온에 따른 patience 소모 가속 배율을 반환한다(CORE_LOOP §5: "추워서 더 빨리 짜증").
  // 체온 100 → 1.0(기본), 체온 0 → ColdPatienceDrainMaxMult(최대). 사이는 선형 보간.
  // GuestStateMachine이 매 틱 patience 감소량에 이 값을 곱한다.
  patienceDrainMultiplier(g: Guest): number {
    if (g == null) throw new Error("g");

    // t = bodyWarmth / max (0=최저체온, 1=최고체온)
    const t = WarmthSystem.clamp01(g.bodyWarmth / MvpConfig.bodyWarmthMax);

    // Lerp(MaxMult, 1.0, t): t=0 → MaxMult, t=1 → 1.0
    return MvpConfig.coldPatienceDrainMaxMult + t * (1 - MvpConfig.coldPatienceDrainMaxMult);
  }

  // 손님의 Warmth 욕구 대비 ambient 난방 부족 + 낮은 BodyWarmth를 합산해
  // 만족도 차감값(warmthPenalty)을 반환한다. 항상 0 이상.
  // 공식(MVP): penalty = ambientPenalty + bodyPenalty.
  // ① ambientPenalty: 손님 여정의 Warmth 욕구 가중치 warmthWeight(>0)일 때만 발생.
  //    ambientScore = clamp(totalWarmthOutput / WarmthOutputReference, 0, 1)로 난방 충족도를 보고,
  //    ambientPenalty = warmthWeight × (1 − ambientScore) × MaxAmbientPenalty.
  //    난방실 1기면 ambientScore≈1 → 거의 0, 난방 전무면 최대 차감.
  // ② bodyPenalty: 체온이 낮을수록 추가 차감(욕구 유무 무관, 상시 압박).
  //    bodyPenalty = (1 − bodyWarmth/BodyWarmthMax) × MaxBodyPenalty.
  computeWarmthPenalty(g: Guest): number {
    if (g == null) throw new Error("g");

    // ① ambient(난방) 부족 페널티 — Warmth 욕구가 있는 손님만
    const warmthWeight = WarmthSystem.getWarmthNeedWeight(g);
    let ambientPenalty = 0;
    if (warmthWeight > 0) {
      const ambientScore = WarmthSystem.clamp01(this.totalWarmthOutput / WarmthSystem.warmthOutputReference);
      ambientPenalty = warmthWeight * (1 - ambientScore) * WarmthSystem.maxAmbientPenalty;
    }

    // ② 체온(BodyWarmth) 부족 페널티 — 모든 손님 상시
    const bodyShortfall = 1 - WarmthSystem.clamp01(g.bodyWarmth / MvpConfig.bodyWarmthMax);
    const bodyPenalty = bodyShortfall * WarmthSystem.maxBodyPenalty;

    return ambientPenalty + bodyPenalty;
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────

  // 활성 HeatingRoom들의 WarmthOutput 합을 계산한다(ambient 총량).
  private static computeTotalWarmthOutput(buildings: ReadonlyArray<Building>): number {
    let total = 0;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b != null && b.isActive && b.type === BuildingType.HeatingRoom) total += b.warmthOutput;
    }
    return total;
  }

  // 손님 여정에서 Warmth 욕구 가중치 합을 반환한다(없으면 0).
  private static getWarmthNeedWeight(g: Guest): number {
    if (g.itinerary == null) return 0;
    let total = 0;
    for (let i = 0; i < g.itinerary.length; i++) {
      const need: Need = g.itinerary[i];
      if (need != null && need.type === NeedType.Warmth) total += need.weight;
    }
    return total;
  }

  // 값을 0~1 범위로 제한한다.
  private static clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }
}
