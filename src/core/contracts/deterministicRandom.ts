import { RandomSource } from "./index";

// 결정론적 난수(C# SeededRandom 대응). 같은 시드 → 같은 시퀀스.
// .NET System.Random 과 비트 동일할 필요는 없고, TS 내 결정론만 보장(Mulberry32).
// 스폰·러시·이벤트·가챠 등 모두 이걸로.
export class DeterministicRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    // 32-bit 부호 없는 상태로 정규화.
    this.state = seed >>> 0;
  }

  // Mulberry32: [0,1) 실수.
  nextFloat(): number {
    // C# NextDouble() 의 [0,1) 의미 보존.
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // [0, maxExclusive) 정수. (C# Random.Next(maxExclusive) 의미 보존)
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(this.nextFloat() * maxExclusive);
  }
}
