import type { GameState } from "../gameState";

// 시간 공급자. 결정론적 테스트를 위해 시간을 주입(Unity의 Time.deltaTime 대신).
// Sim/Tests는 ManualClock으로 정확히 제어, Unity는 어댑터에서 Time.deltaTime 연결.
// (C# IClock → Clock)
export interface Clock {
  // 직전 tick 이후 경과(초).
  readonly deltaTime: number;

  // 세션 시작 이후 누적 경과(초).
  readonly now: number;
}

// 테스트/시뮬용 수동 클럭. advance(dt)로 시간을 직접 전진.
export class ManualClock implements Clock {
  deltaTime: number = 0;
  now: number = 0;

  advance(dt: number): void {
    this.deltaTime = dt;
    this.now += dt;
  }
}

// 난수 공급자. 시드 고정으로 결정론적 테스트 가능(스폰·러시 타이밍 검증).
// (C# IRandom → RandomSource, 전역 Random 과 혼동 방지)
export interface RandomSource {
  // [0,1) 실수.
  nextFloat(): number;

  // [0, maxExclusive) 정수.
  nextInt(maxExclusive: number): number;
}

// 시간 기반 게임 시스템 공통 계약. HotelManager가 매 tick 등록 순서대로 Tick을 호출한다.
// 각 도메인 시스템(유지보수·HR·건설·이벤트 등)은 이 인터페이스를 구현해
// GameState를 읽고 변경한다. 플레이어 명령형 시스템(개입 등)은 Tick 외에 별도 메서드도 노출할 수 있다.
// (C# IGameSystem → GameSystem)
export interface GameSystem {
  // 1 tick 전진. state를 읽고 갱신한다. dt=경과 시간(초).
  tick(state: GameState, dt: number): void;
}
