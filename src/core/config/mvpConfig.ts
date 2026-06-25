import { Building } from "../models/building";
import { Guest } from "../models/guest";
import { Need } from "../models/need";
import { BuildingType, NeedType, Species } from "../models/enums";

// MVP 시작 수치 (CORE_LOOP §7 + §7.7 재밸런스 + 이슈들). 전부 "시작값" — 밸런싱으로 조정 전제.
// 밸런스 튜닝을 위해 static 필드(런타임 조정 가능). 시스템들은 여기 값을 참조한다.
export class MvpConfig {
  // ---- 시작 자원 (§7) ----
  static startCoin = 200;
  static startGem = 5;
  static startReputation = 0;

  // ---- 스폰 / 러시 (§1) ----
  static baseSpawnInterval = 12; // 평소 12초마다 1명
  static rushFactor = 3; // 러시 중 간격 ÷3 (≈4초)
  static rushDuration = 20; // 러시 지속(초)
  static rushCooldownMin = 40; // 러시 사이 최소 간격
  static rushCooldownMax = 70;
  static difficultyK = 100; // effectiveInterval = base / (1 + rep/K)

  // ---- 체온 (이슈6, soft 모델) ----
  static bodyWarmthMax = 100;
  static outdoorWarmthDrainPerSec = 2.5; // 야외 이동 중 초당 하락
  static warmthRecoverPerSec = 4; // 따뜻한 곳/난방길에서 회복
  // 체온이 낮을수록 patience가 더 빨리 닳음: drainMult = Lerp(MaxMult..1, warmth/100)
  static coldPatienceDrainMaxMult = 2.0; // 체온 0일 때 patience 2배 빨리 닳음

  // ---- 경제 / 난방 (§5, §7.7, 이슈2·7) ----
  static heatingUpkeepMultiplier = 6; // §7.7: 난방 upkeep 5~8배 상향 → 시그니처 역경 작동
  static angryRepPenaltyFactor = 0.5; // 화내고 퇴장 시 평판 -repBase×0.5 (§4)
  // 평판 floor (이슈7): 아래로 안 떨어짐 + 기본손님 유입 보장
  static reputationFloor = 0;
  static minSpawnGuaranteeInterval = 18; // 평판 바닥이어도 최소 이 간격으론 기본손님 옴
  // 대출 (이슈2): 한도 = f(호텔가치 + 평판)
  static loanLimitPerHotelValue = 0.5;
  static loanInterestPerMin = 0.02; // 분당 이자율(잔액 대비)

  // ---- MVP 시설 프리셋 (§7) ----
  static newIglooRoom(id: string): Building {
    const b = new Building();
    b.id = id;
    b.type = BuildingType.Room;
    b.servesNeed = NeedType.Sleep;
    b.capacity = 4;
    b.serveTime = 8;
    b.satisfaction = 70;
    b.buildCost = 100;
    b.buildTime = 0;
    return b;
  }

  static newRestaurant(id: string): Building {
    const b = new Building();
    b.id = id;
    b.type = BuildingType.Restaurant;
    b.servesNeed = NeedType.Food;
    b.capacity = 2;
    b.serveTime = 6;
    b.satisfaction = 70;
    b.buildCost = 150;
    b.buildTime = 0;
    return b;
  }

  static newHeatingRoom(id: string): Building {
    const b = new Building();
    b.id = id;
    b.type = BuildingType.HeatingRoom;
    b.servesNeed = NeedType.Warmth;
    b.capacity = 0;
    b.serveTime = 0;
    b.satisfaction = 0;
    b.buildCost = 120;
    b.buildTime = 0;
    b.warmthOutput = 50;
    b.upkeep = 5; // 기본 upkeep; EconomySystem이 HeatingUpkeepMultiplier 적용
    return b;
  }

  // 핫초코 카페 = 손님이 직접 들르는 Warmth 시설(따뜻한 음료로 온기 충족). CONTENT 2.3.
  // ★난방실(HeatingRoom)은 ambient 온기·운영비 담당(손님 안 받음, cap 0)인 반면,
  //   이건 손님 여정의 Warmth 단계가 실제로 들를 수 있는 시설(cap 보유). 둘은 역할이 다름.
  static newHotChocolateCafe(id: string): Building {
    const b = new Building();
    b.id = id;
    b.type = BuildingType.Cafe;
    b.servesNeed = NeedType.Warmth;
    b.capacity = 4;
    b.serveTime = 5;
    b.satisfaction = 70;
    b.buildCost = 200;
    b.buildTime = 0;
    b.upkeep = 0;
    return b;
  }

  // ---- MVP 손님 프리셋 (§7) ----
  static newTravelPenguin(id: string): Guest {
    const g = new Guest();
    g.id = id;
    g.species = Species.TravelPenguin;
    g.coinBase = 30;
    g.repBase = 5;
    g.maxPatience = 20;
    g.itinerary = [new Need(NeedType.Sleep, 0.6), new Need(NeedType.Warmth, 0.4)];
    return g;
  }

  static newSeal(id: string): Guest {
    const g = new Guest();
    g.id = id;
    g.species = Species.Seal;
    g.coinBase = 60;
    g.repBase = 8;
    g.maxPatience = 18;
    g.itinerary = [new Need(NeedType.Sleep, 0.4), new Need(NeedType.Food, 0.4), new Need(NeedType.Warmth, 0.2)];
    return g;
  }
}
