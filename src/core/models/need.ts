import { NeedType } from "./enums";

// 여정의 한 단계(욕구). weight = 여정 만족도 계산 가중치. 한 손님 itinerary의 weight 합 = 1.0.
// CORE_LOOP §3.1.
export class Need {
  readonly type: NeedType;
  readonly weight: number;

  constructor(type: NeedType, weight: number) {
    this.type = type;
    this.weight = weight;
  }
}
