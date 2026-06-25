// Program.cs(단위/통합 30 검증) → vitest 1:1 포팅.
// 공식·경제·온기·스폰·건설·유지보수·HR·진행·개입·카탈로그 단위 검증 + HotelManager tick 통합 검증.
//
// 결정론 검증은 .NET과 비트동일이 아니라 'TS 내 결정론'과 '같은 불변식 성립'을 본다:
//   C# SeededRandom → TS DeterministicRandom(Mulberry32). 스폰 카운트의 절대값은
//   .NET과 다를 수 있어, 기대값을 "손님이 실제로 스폰된다 / 같은 시드 → 같은 결과"로 조정.
import { describe, it, expect } from "vitest";

import { MvpConfig } from "../core/config/mvpConfig";
import { Catalog } from "../core/content/catalog";
import { GameState } from "../core/gameState";
import { HotelManager } from "../core/hotelManager";
import { DeterministicRandom } from "../core/contracts/deterministicRandom";

import { Guest } from "../core/models/guest";
import { Building } from "../core/models/building";
import {
  Species,
  BuildingPhase,
  StaffRole,
  Rarity,
} from "../core/models/enums";

import { SatisfactionCalculator } from "../core/systems/satisfactionCalculator";
import { EconomySystem } from "../core/systems/economySystem";
import { WarmthSystem } from "../core/systems/warmthSystem";
import { SpawnSystem } from "../core/systems/spawnSystem";
import { ConstructionSystem } from "../core/systems/constructionSystem";
import { MaintenanceSystem } from "../core/systems/maintenanceSystem";
import { StaffEffectSystem } from "../core/systems/staffEffectSystem";
import { HrSystem } from "../core/systems/hrSystem";
import { ProgressionSystem } from "../core/systems/progressionSystem";

// CheckNear(a,b,tol=0.05) 대응. C# float 허용오차 0.05.
function near(a: number, b: number, tol = 0.05): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

// CountSpawns(seed): 600초(1200 tick @0.5s) 동안 스폰 수.
function countSpawns(seed: number): number {
  const s = new SpawnSystem(new DeterministicRandom(seed));
  let count = 0;
  for (let i = 0; i < 1200; i++) {
    if (s.trySpawn(0.5, 0) != null) count++;
  }
  return count;
}

// 카탈로그 전 손님 종의 itinerary weight 합이 1.0인지.
function catalogWeightsOk(): boolean {
  const all = Object.values(Species).filter((v) => typeof v === "number") as Species[];
  for (const sp of all) {
    let g: Guest;
    try {
      g = Catalog.createGuest(sp, "chk");
    } catch {
      continue; // 미생성 종 건너뜀
    }
    if (g == null || g.itinerary == null) continue;
    let sum = 0;
    for (let i = 0; i < g.itinerary.length; i++) sum += g.itinerary[i].weight;
    if (Math.abs(sum - 1.0) > 0.01) return false;
  }
  return true;
}

describe("만족도/결제 공식 (CORE_LOOP §4)", () => {
  it("만족도 100% (0.6×100+0.4×100)", () => {
    const full = MvpConfig.newTravelPenguin("t");
    full.stepSatisfactions.push(100); // Sleep
    full.stepSatisfactions.push(100); // Warmth
    near(SatisfactionCalculator.computeSatisfaction(full, 0), 100);
  });

  it("만족100% → 코인 30 전액", () => {
    const full = MvpConfig.newTravelPenguin("t");
    full.stepSatisfactions.push(100);
    full.stepSatisfactions.push(100);
    expect(SatisfactionCalculator.computePayout(full, 100)).toBe(30);
  });

  it("만족도 70% (가중합)", () => {
    const partial = MvpConfig.newTravelPenguin("t2");
    partial.stepSatisfactions.push(70);
    partial.stepSatisfactions.push(70);
    near(SatisfactionCalculator.computeSatisfaction(partial, 0), 70);
  });

  it("만족70% → 코인 round(30×0.7)=21", () => {
    const partial = MvpConfig.newTravelPenguin("t2");
    partial.stepSatisfactions.push(70);
    partial.stepSatisfactions.push(70);
    const sat70 = SatisfactionCalculator.computeSatisfaction(partial, 0);
    expect(SatisfactionCalculator.computePayout(partial, sat70)).toBe(21);
  });

  it("화난 퇴장 평판 페널티 round(5×0.5)=3", () => {
    expect(
      SatisfactionCalculator.computeAngryRepPenalty(MvpConfig.newTravelPenguin("t3")),
    ).toBe(3);
  });

  it("온기 페널티는 만족도를 깎는다 (88<100)", () => {
    const full = MvpConfig.newTravelPenguin("t");
    full.stepSatisfactions.push(100);
    full.stepSatisfactions.push(100);
    expect(SatisfactionCalculator.computeSatisfaction(full, 12)).toBeLessThan(100);
  });
});

describe("경제 시스템 (이슈2·5·7)", () => {
  it("평판 floor: -10 가산해도 0 밑으로 안 감", () => {
    const eco = new EconomySystem(0, 0, 0);
    eco.addReputation(-10);
    expect(eco.reputation).toBe(0);
  });

  it("난방 운영비: 1분에 30코인 차감 (1000→970)", () => {
    const ecoUp = new EconomySystem(1000, 0, 0);
    const heatOnly: Building[] = [MvpConfig.newHeatingRoom("h")];
    ecoUp.tickUpkeep(60, heatOnly); // 60초=1분: upkeep 5×배수6=30 차감
    expect(ecoUp.coin).toBe(970);
  });

  it("대출 한도 floor((1000+0)×0.5)=500", () => {
    const ecoLoan = new EconomySystem(100, 0, 0);
    expect(ecoLoan.loanLimit(1000)).toBe(500);
  });

  it("대출 100 실행 → 코인 200·잔액 100", () => {
    const ecoLoan = new EconomySystem(100, 0, 0);
    const took = ecoLoan.takeLoan(100, 1000);
    expect(took && ecoLoan.coin === 200 && ecoLoan.loanBalance === 100).toBe(true);
  });

  it("대출 100 상환 → 코인 100·잔액 0", () => {
    const ecoLoan = new EconomySystem(100, 0, 0);
    ecoLoan.takeLoan(100, 1000);
    ecoLoan.repayLoan(100);
    expect(ecoLoan.coin === 100 && ecoLoan.loanBalance === 0).toBe(true);
  });

  it("한도 초과 대출은 거부", () => {
    expect(new EconomySystem(0, 0, 0).takeLoan(99999, 100)).toBe(false);
  });
});

describe("온기 시스템 (이슈6 soft 모델)", () => {
  it("야외 10초 체온 하락 100→75", () => {
    const warmth = new WarmthSystem();
    const wg = MvpConfig.newTravelPenguin("w");
    wg.bodyWarmth = 100;
    warmth.updateBodyWarmth(wg, true, 10);
    near(wg.bodyWarmth, 75);
  });

  it("실내 10초 체온 회복 후 100 상한", () => {
    const warmth = new WarmthSystem();
    const wg = MvpConfig.newTravelPenguin("w");
    wg.bodyWarmth = 100;
    warmth.updateBodyWarmth(wg, true, 10); // 75
    warmth.updateBodyWarmth(wg, false, 10); // +40 → clamp 100
    near(wg.bodyWarmth, 100);
  });

  it("따뜻하면 patience 배율 1.0", () => {
    const warmth = new WarmthSystem();
    const warm = MvpConfig.newTravelPenguin("wm");
    warm.bodyWarmth = 100;
    near(warmth.patienceDrainMultiplier(warm), 1.0);
  });

  it("추우면 patience 배율 2.0 (더 빨리 짜증)", () => {
    const warmth = new WarmthSystem();
    const cold = MvpConfig.newTravelPenguin("cd");
    cold.bodyWarmth = 0;
    near(warmth.patienceDrainMultiplier(cold), 2.0);
  });
});

describe("스폰 시스템 (CORE_LOOP §1) — RNG 결정론", () => {
  it("스폰 결정론: 같은 시드 → 같은 결과", () => {
    const c1 = countSpawns(42);
    const c2 = countSpawns(42);
    expect(c1).toBe(c2);
  });

  it("스폰 생성: 600초에 손님 다수 도착", () => {
    expect(countSpawns(42)).toBeGreaterThan(0);
  });
});

describe("종단 루프: HotelManager 한 세션 (통합)", () => {
  it("종단 루프: 예외 없이 600초 구동", () => {
    const hotel = new HotelManager(new DeterministicRandom(7));
    let threw = false;
    try {
      for (let i = 0; i < 1200; i++) hotel.tick(0.5);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("종단 루프: 손님이 실제로 여정 완료(만족 퇴장 발생)", () => {
    const hotel = new HotelManager(new DeterministicRandom(7));
    let served = 0;
    hotel.onGuestServed = () => {
      served++;
    };
    for (let i = 0; i < 1200; i++) hotel.tick(0.5);
    expect(served).toBeGreaterThan(0);
  });

  it("종단 루프: 코인 경제가 작동(시작 200에서 변동)", () => {
    const hotel = new HotelManager(new DeterministicRandom(7));
    for (let i = 0; i < 1200; i++) hotel.tick(0.5);
    expect(hotel.economy.coin).not.toBe(200);
  });
});

describe("전체 로직 시스템 검증 (8개 도메인 통합)", () => {
  it("직원효과: 셰프 배치 식당 serveTime↓", () => {
    const h2 = new HotelManager(new DeterministicRandom(3));
    const rest = h2.state.findBuilding("rest1")!;
    expect(h2.staffEffects.effectiveServeTime(rest, h2.state)).toBeLessThan(rest.serveTime);
  });

  it("건설: StartBuild → UnderConstruction + 코인 400 차감", () => {
    const cst = new GameState();
    cst.rng = new DeterministicRandom(1);
    cst.economy = new EconomySystem(10000, 100, 0);
    const cons = new ConstructionSystem();
    const nb = Catalog.createBuilding("igloo_t2", "c1");
    const started = cons.startBuild(cst, nb);
    expect(
      started && nb.phase === BuildingPhase.UnderConstruction && cst.economy.coin === 9600,
    ).toBe(true);
  });

  it("건설: 타이머 경과 후 Active 전환", () => {
    const cst = new GameState();
    cst.rng = new DeterministicRandom(1);
    cst.economy = new EconomySystem(10000, 100, 0);
    const cons = new ConstructionSystem();
    const nb = Catalog.createBuilding("igloo_t2", "c1");
    cons.startBuild(cst, nb);
    cons.tick(cst, nb.buildTime + 1);
    expect(nb.phase === BuildingPhase.Active && nb.isActive).toBe(true);
  });

  it("유지보수: 시간 경과 → 청결 하락(방치 압박)", () => {
    const mst = new GameState();
    mst.rng = new DeterministicRandom(1);
    mst.economy = new EconomySystem(0, 0, 0);
    const mb = MvpConfig.newIglooRoom("m1");
    mb.occupancy = 1;
    mst.buildings.push(mb);
    const maint = new MaintenanceSystem(new StaffEffectSystem());
    maint.tick(mst, 120);
    expect(mb.cleanliness).toBeLessThan(100);
  });

  it("유지보수: 청소로 회복(영구손실 없음)", () => {
    const mst = new GameState();
    mst.rng = new DeterministicRandom(1);
    mst.economy = new EconomySystem(0, 0, 0);
    const mb = MvpConfig.newIglooRoom("m1");
    mb.occupancy = 1;
    mst.buildings.push(mb);
    const maint = new MaintenanceSystem(new StaffEffectSystem());
    maint.tick(mst, 120);
    maint.clean(mb);
    expect(mb.cleanliness).toBeGreaterThan(99);
  });

  it("HR: 근무 직원 체력 소모(번아웃 압박)", () => {
    const hst = new GameState();
    hst.rng = new DeterministicRandom(1);
    hst.economy = new EconomySystem(0, 0, 0);
    const worker = Catalog.createStaff(StaffRole.Chef, Rarity.Common, "w1");
    worker.onDuty = true;
    hst.staff.push(worker);
    new HrSystem().tick(hst, 120);
    expect(worker.energy).toBeLessThan(100);
  });

  it("진행: 평판 5000 → 새 구역 해금", () => {
    const pst = new GameState();
    pst.rng = new DeterministicRandom(1);
    pst.economy = new EconomySystem(0, 0, 5000);
    const prog = new ProgressionSystem();
    prog.tick(pst, 0.5);
    expect(prog.allUnlockedZones(pst).length).toBeGreaterThan(1);
  });

  it("개입: 영업/휴장 토글 → IsOpen false", () => {
    const h3 = new HotelManager(new DeterministicRandom(5));
    h3.intervention.toggleBusiness(h3.state, false);
    expect(h3.isOpen).toBe(false);
  });

  it("카탈로그: 손님 20종 itinerary weight 합 1.0", () => {
    expect(catalogWeightsOk()).toBe(true);
  });
});
