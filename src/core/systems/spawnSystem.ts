import { Guest } from "../models/guest";
import { MvpConfig } from "../config/mvpConfig";
import { RandomSource } from "../contracts";

// 손님 스폰 / 러시웨이브 시스템 (CORE_LOOP §1, GAME_DESIGN 평온→폭주→진정 리듬).
// 엔진 무관 순수 로직. 결정론적: 주입된 RandomSource 만 사용(DateTime/무시드 Random 금지).
// 매 tick trySpawn 으로 도착 여부를 판정하고, 도착 시 새 Guest 를 반환한다.
// 평판이 높을수록 도착 간격이 짧아지고, 러시 중에는 추가로 더 짧아진다.
export class SpawnSystem {
  private readonly rng: RandomSource;

  // 다음 스폰까지 남은 시간(초). 0 이하가 되면 손님 도착.
  private spawnTimer: number;

  // 현재 러시/평온 단계의 남은 시간(초). 0 이하가 되면 단계 전이.
  private phaseTimer: number;

  // 현재 러시 중인지 여부.
  private rushActive: boolean;

  // 스폰된 손님 누적 수. id 생성("g0","g1"...)에 사용.
  private spawnCount: number;

  // TravelPenguin이 뽑힐 확률(나머지는 Seal). 흔하게 펭귄/가끔 물범.
  private static readonly TravelPenguinChance = 0.75;

  // 결정론적 난수 공급자를 주입해 생성한다. 시작은 평온 단계이며
  // 다음 러시까지의 cooldown(RushCooldownMin~RushCooldownMax)을 즉시 뽑아 둔다.
  // rng: 결정론적 난수 공급자(스폰 종 추첨·러시 타이밍 모두 이걸로).
  constructor(rng: RandomSource) {
    this.rng = rng;
    this.rushActive = false;
    this.phaseTimer = this.nextRushCooldown();
    this.spawnTimer = 0;
    this.spawnCount = 0;
  }

  // 현재 러시 중인가(UI 연출용). 평온 단계면 false, 러시 단계면 true.
  get isRushActive(): boolean {
    return this.rushActive;
  }

  // 1 tick(=dt초) 경과시킨다. 러시/평온 단계 타이머와 스폰 타이머를 함께 갱신한다.
  // 이번 tick에 손님이 도착하면 새 Guest(고유 id 부여)를 반환하고, 아니면 null을 반환한다.
  // 도착 간격은 평판으로 스케일된다: effectiveInterval = BaseSpawnInterval/(1+reputation/DifficultyK),
  // 러시 중이면 추가로 ÷RushFactor, 그리고 평판이 낮아도 기본손님이 들어오도록
  // MinSpawnGuaranteeInterval로 상한을 둔다.
  // dt: 이번 tick의 경과 시간(초).
  // reputation: 현재 평판. 클수록 도착 간격이 짧아진다(음수는 0으로 취급).
  // 반환: 이번 tick에 도착한 손님, 없으면 null.
  trySpawn(dt: number, reputation: number): Guest | null {
    this.advanceRushCycle(dt);

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) {
      return null;
    }

    // 도착. 다음 스폰까지의 간격을 현재 평판/러시 상태로 다시 채운다.
    this.spawnTimer += this.effectiveInterval(reputation);
    return this.spawnGuest();
  }

  // 러시/평온 단계 타이머를 dt만큼 줄이고, 0 이하가 되면 단계를 전이한다.
  // 평온 → (남은 시간 소진) → 러시(RushDuration) → 평온(RushCooldownMin~Max 사이 cooldown) 반복.
  // 한 tick에 여러 단계가 끝날 수 있으므로 while로 모두 소화한다.
  private advanceRushCycle(dt: number): void {
    this.phaseTimer -= dt;
    while (this.phaseTimer <= 0) {
      if (this.rushActive) {
        // 러시 종료 → 평온 진입, 다음 러시까지 cooldown 추첨.
        this.rushActive = false;
        this.phaseTimer += this.nextRushCooldown();
      } else {
        // 평온 종료 → 러시 진입(고정 길이).
        this.rushActive = true;
        this.phaseTimer += MvpConfig.rushDuration;
      }
    }
  }

  // 현재 평판/러시 상태로 다음 스폰까지의 간격(초)을 계산한다.
  // base/(1+rep/K) → (러시면 ÷RushFactor) → Min(_, MinSpawnGuaranteeInterval) 상한.
  private effectiveInterval(reputation: number): number {
    const rep = reputation > 0 ? reputation : 0;
    let interval = MvpConfig.baseSpawnInterval / (1 + rep / MvpConfig.difficultyK);

    if (this.rushActive) {
      interval /= MvpConfig.rushFactor;
    }

    // 평판이 낮아 간격이 너무 길어져도 기본손님은 보장(상한 = 최소보장간격).
    if (interval > MvpConfig.minSpawnGuaranteeInterval) {
      interval = MvpConfig.minSpawnGuaranteeInterval;
    }

    return interval;
  }

  // 스폰 종을 추첨해 새 손님을 만든다. TravelPenguin 흔하게/Seal 가끔. id는 "g{counter}".
  private spawnGuest(): Guest {
    const id = "g" + this.spawnCount;
    this.spawnCount++;

    if (this.rng.nextFloat() < SpawnSystem.TravelPenguinChance) {
      return MvpConfig.newTravelPenguin(id);
    }
    return MvpConfig.newSeal(id);
  }

  // 다음 러시까지의 cooldown(초)을 [RushCooldownMin, RushCooldownMax)에서 뽑는다.
  private nextRushCooldown(): number {
    const span = MvpConfig.rushCooldownMax - MvpConfig.rushCooldownMin;
    return MvpConfig.rushCooldownMin + this.rng.nextFloat() * span;
  }
}
