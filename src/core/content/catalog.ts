import { Building } from "../models/building";
import { Guest } from "../models/guest";
import { Need } from "../models/need";
import { Staff } from "../models/staff";
import {
  Species,
  GuestTier,
  NeedType,
  BuildingType,
  StaffRole,
  Rarity,
  ZoneId,
} from "../models/enums";
import { roundAwayFromZero } from "../util/mathx";

// 콘텐츠 카탈로그. CONTENT.md §1(직원)·§2.2~2.5(건물)·§3.5(손님) 표 데이터를
// 순수 TS 정적 팩토리로 제공한다. Unity 의존성 없음.
export class Catalog {
  // ────────────────────────────────────────────────
  // 헬퍼: 분(min)→초(sec) 변환
  // ────────────────────────────────────────────────
  private static min(minutes: number): number {
    return minutes * 60;
  }
  private static hours(h: number): number {
    return h * 3600;
  }

  // ────────────────────────────────────────────────
  // 손님 해금 평판 표 (CONTENT §3.5)
  // ────────────────────────────────────────────────
  private static readonly s_unlockRep: Map<Species, number> = new Map<Species, number>([
    // A. 기본
    [Species.TravelPenguin, 0],
    [Species.Seal, 0],
    [Species.SeaLionFamily, 50],
    [Species.Gull, 50],
    // B. 중급
    [Species.PenguinNewlyweds, 150],
    [Species.SchoolTrip, 150],
    [Species.WalrusBiz, 250],
    // C. 열대
    [Species.Flamingo, 400],
    [Species.Turtle, 400],
    [Species.ParrotInfluencer, 600],
    [Species.MonkeyFamily, 600],
    // D. VIP
    [Species.Whale, 1000],
    [Species.Orca, 1000],
    [Species.EmperorPenguin, 1500],
    [Species.Narwhal, 2000],
    // E. 특수 — 이벤트 전용, 평판 게이트 없음
    [Species.MysteryCritic, 0],
    [Species.Celebrity, 0],
    [Species.Regular, 0],
    [Species.ForeignTourist, 0],
    [Species.SantaPenguin, 0],
  ]);

  // 손님 종의 해금에 필요한 누적 평판(PeakReputation 기준). CONTENT §3.5 해금 열.
  static guestUnlockRep(s: Species): number {
    const rep = Catalog.s_unlockRep.get(s);
    return rep !== undefined ? rep : 0;
  }

  // 상시 등장 가능한 손님 종 전체 목록 (이벤트 전용 E그룹 제외).
  static readonly allGuestSpecies: ReadonlyArray<Species> = [
    Species.TravelPenguin,
    Species.Seal,
    Species.SeaLionFamily,
    Species.Gull,
    Species.PenguinNewlyweds,
    Species.SchoolTrip,
    Species.WalrusBiz,
    Species.Flamingo,
    Species.Turtle,
    Species.ParrotInfluencer,
    Species.MonkeyFamily,
    Species.Whale,
    Species.Orca,
    Species.EmperorPenguin,
    Species.Narwhal,
  ];

  // 지원되는 건물 defKey 전체 목록.
  static readonly allBuildingDefKeys: ReadonlyArray<string> = [
    // 이글루 티어
    "igloo_t1", "igloo_t2", "igloo_t3", "igloo_t4", "igloo_t5",
    // F&B
    "rest_fishstand", "rest_seafood", "rest_aurorabar", "rest_michelin",
    "cafe_hotchoc",
    // 편의/엔터
    "play_snow", "sled", "spa_ice", "pool_penguin", "onsen", "aurora_lounge",
    // 난방
    "heat_brazier", "heat_room", "heat_central", "heat_geo", "heat_well",
    // 기타 인프라
    "generator", "laundry", "stafflounge", "storage",
    // 동선/로비
    "frontdesk", "lobby",
  ];

  // ════════════════════════════════════════════════
  // createGuest — CONTENT §3.5
  // ════════════════════════════════════════════════

  // 종별 기본 손님 인스턴스를 생성한다.
  // Itinerary weight 합 = 1.0 보장.
  // Warmth 욕구 포함 손님은 Cafe/Spa/온천 등 Warmth serve 시설로 라우팅 가능.
  static createGuest(s: Species, id: string): Guest {
    const g = new Guest();
    g.id = id;
    g.species = s;

    switch (s) {
      // ── A. 기본 ──────────────────────────────
      case Species.TravelPenguin:
        // 욕구: Sleep H, Warmth L. 코인낮음·인내보통. 튜토리얼 손님.
        g.coinBase = 30;
        g.repBase = 5;
        g.maxPatience = 60;
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.7),
          Catalog.n(NeedType.Warmth, 0.3));
        break;

      case Species.Seal:
        // 욕구: Sleep M, Food M, Warmth L. 느긋(인내 김).
        g.coinBase = 50;
        g.repBase = 7;
        g.maxPatience = 90; // 느긋 → 긴 인내
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.4),
          Catalog.n(NeedType.Food, 0.4),
          Catalog.n(NeedType.Warmth, 0.2));
        break;

      case Species.SeaLionFamily:
        // 욕구: Sleep H, Food M, Warmth L. 단체(수용 부담). 코인 중.
        g.coinBase = 80;
        g.repBase = 10;
        g.maxPatience = 60;
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.5),
          Catalog.n(NeedType.Food, 0.3),
          Catalog.n(NeedType.Warmth, 0.2));
        break;

      case Species.Gull:
        // 욕구: Food M. 진상·짧은인내·코인 매우낮음. Warmth 욕구 없음.
        g.coinBase = 15;
        g.repBase = 3;
        g.maxPatience = 25; // 짧음
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Food, 1.0));
        break;

      // ── B. 중급 ──────────────────────────────
      case Species.PenguinNewlyweds:
        // 욕구: Sleep H, Fun M, Warmth M. 코인 중. 디럭스/스위트 선호.
        g.coinBase = 120;
        g.repBase = 15;
        g.maxPatience = 60;
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.5),
          Catalog.n(NeedType.Fun, 0.3),
          Catalog.n(NeedType.Warmth, 0.2));
        break;

      case Species.SchoolTrip:
        // 욕구: Fun H, Warmth M. 짧은 인내·대량 러시 손님.
        g.coinBase = 100;
        g.repBase = 12;
        g.maxPatience = 30; // 짧음
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Fun, 0.6),
          Catalog.n(NeedType.Warmth, 0.4));
        break;

      case Species.WalrusBiz:
        // 욕구: Sleep H, Food M, Warmth M. 코인 중상. 빠른 응대 요구(짧은 인내).
        g.coinBase = 150;
        g.repBase = 18;
        g.maxPatience = 30; // 짧음 — 시간 깐깐
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.45),
          Catalog.n(NeedType.Food, 0.30),
          Catalog.n(NeedType.Warmth, 0.25));
        break;

      // ── C. 열대 관광객 ────────────────────────
      case Species.Flamingo:
        // 욕구: Warmth H, Fun M, Clean M. 코인 상. 난방 미비=즉각 불만.
        g.coinBase = 200;
        g.repBase = 25;
        g.maxPatience = 60;
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Warmth, 0.45),
          Catalog.n(NeedType.Fun, 0.30),
          Catalog.n(NeedType.Clean, 0.25));
        break;

      case Species.Turtle:
        // 욕구: Warmth H, Sleep M. 코인 상. serveTime 길어도 잘 참음(긴 인내).
        g.coinBase = 180;
        g.repBase = 22;
        g.maxPatience = 120; // 김
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Warmth, 0.55),
          Catalog.n(NeedType.Sleep, 0.45));
        break;

      case Species.ParrotInfluencer:
        // 욕구: Warmth H, Fun H. 코인 상. 만족=평판 폭발, 실패=악평.
        g.coinBase = 220;
        g.repBase = 40; // 만족 시 높은 평판
        g.maxPatience = 60;
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Warmth, 0.50),
          Catalog.n(NeedType.Fun, 0.50));
        break;

      case Species.MonkeyFamily:
        // 욕구: Warmth H, Fun H, Clean H. 코인 상. 짧은 인내·청결 부담.
        g.coinBase = 200;
        g.repBase = 20;
        g.maxPatience = 30; // 짧음
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Warmth, 0.40),
          Catalog.n(NeedType.Fun, 0.35),
          Catalog.n(NeedType.Clean, 0.25));
        break;

      // ── D. VIP ────────────────────────────────
      case Species.Whale:
        // 욕구: Sleep H, Food H, Warmth M. 코인 최상. 전용시설·매우 까다로움.
        g.coinBase = 500;
        g.repBase = 60;
        g.maxPatience = 60;
        g.tier = GuestTier.VIP;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.40),
          Catalog.n(NeedType.Food, 0.35),
          Catalog.n(NeedType.Warmth, 0.25));
        break;

      case Species.Orca:
        // 욕구: Sleep H, Fun M, Warmth M. 코인 최상. 빠른 VIP 응대 요구.
        g.coinBase = 480;
        g.repBase = 55;
        g.maxPatience = 25; // 짧음
        g.tier = GuestTier.VIP;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.45),
          Catalog.n(NeedType.Fun, 0.30),
          Catalog.n(NeedType.Warmth, 0.25));
        break;

      case Species.EmperorPenguin:
        // 욕구: Sleep H, Fun H, Warmth L. 코인 최상. 격식·평판 핵심.
        g.coinBase = 600;
        g.repBase = 80;
        g.maxPatience = 60;
        g.tier = GuestTier.VIP;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.50),
          Catalog.n(NeedType.Fun, 0.35),
          Catalog.n(NeedType.Warmth, 0.15));
        break;

      case Species.Narwhal:
        // 욕구: Sleep H, Warmth M. 코인 최상. 희귀 VIP, 특수 보상, 긴 인내.
        g.coinBase = 700;
        g.repBase = 90;
        g.maxPatience = 120; // 김
        g.tier = GuestTier.VIP;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.60),
          Catalog.n(NeedType.Warmth, 0.40));
        break;

      // ── E. 특수 (이벤트 전용) ─────────────────
      case Species.MysteryCritic:
        // 정체 숨긴 평론가. 만족=평판 대박/실패=폭락. 일반 손님처럼 행동.
        // 수치는 중급 수준으로 설정(정체 숨기기 위해). — 주석: 표에 별도 수치 없음, 합리적 추정.
        g.coinBase = 100;
        g.repBase = 50; // 만족 시 대형 평판(별도 EventSystem에서 배수 적용 전제)
        g.maxPatience = 60;
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.4),
          Catalog.n(NeedType.Food, 0.35),
          Catalog.n(NeedType.Fun, 0.25));
        break;

      case Species.Celebrity:
        // 셀럽매니저 필요. 등장만으로 평판+. 코인 VIP급.
        // — 주석: 표에 별도 수치 없음, VIP 수준 합리적 추정.
        g.coinBase = 400;
        g.repBase = 70;
        g.maxPatience = 60;
        g.tier = GuestTier.VIP;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.40),
          Catalog.n(NeedType.Fun, 0.35),
          Catalog.n(NeedType.Clean, 0.25));
        break;

      case Species.Regular:
        // 단골. 반복 방문, 관계 레벨↑. 중급 수준 수치. — 주석: 표 없음, 중급 합리적 추정.
        g.coinBase = 100;
        g.repBase = 15;
        g.maxPatience = 90; // 단골이라 느긋
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.5),
          Catalog.n(NeedType.Food, 0.3),
          Catalog.n(NeedType.Warmth, 0.2));
        break;

      case Species.ForeignTourist:
        // 통역사 직원 필요. 중급 수준. — 주석: 표 없음, 중급 합리적 추정.
        g.coinBase = 130;
        g.repBase = 18;
        g.maxPatience = 60;
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.40),
          Catalog.n(NeedType.Fun, 0.35),
          Catalog.n(NeedType.Warmth, 0.25));
        break;

      case Species.SantaPenguin:
        // 크리스마스 한정. 전 손님 만족 버프(EventSystem 연계). — 주석: 표 없음, 합리적 추정.
        g.coinBase = 50;
        g.repBase = 30;
        g.maxPatience = 120;
        g.tier = GuestTier.Normal;
        g.itinerary = Catalog.itinerary(
          Catalog.n(NeedType.Sleep, 0.5),
          Catalog.n(NeedType.Fun, 0.5));
        break;

      default:
        throw new Error("알 수 없는 Species: " + s);
    }

    return g;
  }

  // ════════════════════════════════════════════════
  // createBuilding — CONTENT §2.2~2.5
  // ════════════════════════════════════════════════

  // defKey로 건물 인스턴스를 생성한다.
  // BuildTime 단위 = 초(MvpConfig 표기와 동일). CONTENT §2.2~2.5 표 수치 기준.
  // upkeep 단위 = coin/min (EconomySystem이 틱마다 환산 차감).
  static createBuilding(defKey: string, id: string): Building {
    const b = new Building();
    b.id = id;

    switch (defKey) {
      // ── 이글루 티어 (숙소) §2.2 ──────────────
      case "igloo_t1":
        // ★1 이글루 도미토리: cap4, sat60, buildCost100, 즉시, 해금0
        b.type = BuildingType.Room;
        b.servesNeed = NeedType.Sleep;
        b.capacity = 4;
        b.serveTime = 30; // 숙박 1사이클. — 주석: 표에 serveTime 없음, 합리적 추정 30s
        b.satisfaction = 60;
        b.buildCost = 100;
        b.buildTime = 0;
        b.upgradeCost = 0;
        b.upkeep = 1; // — 주석: 표에 upkeep 없음, 최소값 합리적 추정
        b.zone = ZoneId.HomeIce;
        break;

      case "igloo_t2":
        // ★2 스탠다드 이글루: cap6, sat75, buildCost400, 30분, 해금50
        b.type = BuildingType.Room;
        b.servesNeed = NeedType.Sleep;
        b.capacity = 6;
        b.serveTime = 30;
        b.satisfaction = 75;
        b.buildCost = 400;
        b.buildTime = Catalog.min(30);
        b.upgradeCost = 400;
        b.upkeep = 2;
        b.zone = ZoneId.HomeIce;
        break;

      case "igloo_t3":
        // ★3 디럭스 이글루: cap8, sat85, buildCost1500, 2시간, 해금200
        b.type = BuildingType.Room;
        b.servesNeed = NeedType.Sleep;
        b.capacity = 8;
        b.serveTime = 30;
        b.satisfaction = 85;
        b.buildCost = 1500;
        b.buildTime = Catalog.hours(2);
        b.upgradeCost = 1500;
        b.upkeep = 4;
        b.zone = ZoneId.HomeIce;
        break;

      case "igloo_t4":
        // ★4 오로라 이글루: cap10, sat95, buildCost6000, 8시간, 해금600
        b.type = BuildingType.Room;
        b.servesNeed = NeedType.Sleep;
        b.capacity = 10;
        b.serveTime = 30;
        b.satisfaction = 95;
        b.buildCost = 6000;
        b.buildTime = Catalog.hours(8);
        b.upgradeCost = 6000;
        b.upkeep = 6;
        b.zone = ZoneId.AuroraDeck;
        break;

      case "igloo_t5":
        // ★5 그랜드 이글루: cap12, sat100, buildCost20000, 24시간, 해금1500
        b.type = BuildingType.Room;
        b.servesNeed = NeedType.Sleep;
        b.capacity = 12;
        b.serveTime = 30;
        b.satisfaction = 100;
        b.buildCost = 20000;
        b.buildTime = Catalog.hours(24);
        b.upgradeCost = 20000;
        b.upkeep = 10;
        b.zone = ZoneId.Pole;
        break;

      // ── F&B §2.3 ─────────────────────────────
      case "rest_fishstand":
        // 빙어 노점: Food, cap2, 6s, sat60, cost80, 즉시, upkeep1/min, 해금0
        b.type = BuildingType.Restaurant;
        b.servesNeed = NeedType.Food;
        b.capacity = 2;
        b.serveTime = 6;
        b.satisfaction = 60;
        b.buildCost = 80;
        b.buildTime = 0;
        b.upkeep = 1;
        b.zone = ZoneId.HomeIce;
        break;

      case "cafe_hotchoc":
        // 핫초코 카페: Food+Warmth, cap3, 5s, sat70, cost350, 30분, upkeep2/min, 해금50
        // ServesNeed=Warmth(따뜻한 음료로 체온 회복 — MvpConfig 주석 참조). Food 부가효과는 Satisfaction에 포함.
        b.type = BuildingType.Cafe;
        b.servesNeed = NeedType.Warmth;
        b.capacity = 3;
        b.serveTime = 5;
        b.satisfaction = 70;
        b.buildCost = 350;
        b.buildTime = Catalog.min(30);
        b.upkeep = 2;
        b.zone = ZoneId.HomeIce;
        break;

      case "rest_seafood":
        // 씨푸드 레스토랑: Food H, cap4, 8s, sat85, cost1200, 2시간, upkeep4/min, 해금200
        b.type = BuildingType.Restaurant;
        b.servesNeed = NeedType.Food;
        b.capacity = 4;
        b.serveTime = 8;
        b.satisfaction = 85;
        b.buildCost = 1200;
        b.buildTime = Catalog.hours(2);
        b.upkeep = 4;
        b.zone = ZoneId.HomeIce;
        break;

      case "rest_aurorabar":
        // 오로라 바: Food+Fun, cap4, 7s, sat90, cost5000, 8시간, upkeep6/min, 해금600
        // ServesNeed=Food (Fun 부가효과는 Satisfaction에 반영). 바는 Bar 타입.
        b.type = BuildingType.Bar;
        b.servesNeed = NeedType.Food;
        b.capacity = 4;
        b.serveTime = 7;
        b.satisfaction = 90;
        b.buildCost = 5000;
        b.buildTime = Catalog.hours(8);
        b.upkeep = 6;
        b.zone = ZoneId.AuroraDeck;
        break;

      case "rest_michelin":
        // 미슐랭 다이닝: Food H, cap3, 10s, sat100, cost18000, 24시간, upkeep10/min, 해금1500
        b.type = BuildingType.Restaurant;
        b.servesNeed = NeedType.Food;
        b.capacity = 3;
        b.serveTime = 10;
        b.satisfaction = 100;
        b.buildCost = 18000;
        b.buildTime = Catalog.hours(24);
        b.upkeep = 10;
        b.zone = ZoneId.Pole;
        break;

      // ── 편의/엔터 §2.4 ────────────────────────
      case "play_snow":
        // 놀이방/눈놀이터: Fun, cap4, 6s, sat65, cost300, 30분, upkeep2/min, 해금50
        b.type = BuildingType.Playroom;
        b.servesNeed = NeedType.Fun;
        b.capacity = 4;
        b.serveTime = 6;
        b.satisfaction = 65;
        b.buildCost = 300;
        b.buildTime = Catalog.min(30);
        b.upkeep = 2;
        b.zone = ZoneId.HomeIce;
        break;

      case "sled":
        // 눈썰매장: Fun H, cap6, 10s, sat80, cost1000, 2시간, upkeep3/min, 해금150
        b.type = BuildingType.Playroom;
        b.servesNeed = NeedType.Fun;
        b.capacity = 6;
        b.serveTime = 10;
        b.satisfaction = 80;
        b.buildCost = 1000;
        b.buildTime = Catalog.hours(2);
        b.upkeep = 3;
        b.zone = ZoneId.Beach;
        break;

      case "spa_ice":
        // 얼음 스파: Fun+Clean, cap3, 12s, sat85, cost1800, 3시간, upkeep4/min, 해금250
        // ServesNeed=Clean (Fun 부가효과는 Satisfaction에 포함).
        b.type = BuildingType.Spa;
        b.servesNeed = NeedType.Clean;
        b.capacity = 3;
        b.serveTime = 12;
        b.satisfaction = 85;
        b.buildCost = 1800;
        b.buildTime = Catalog.hours(3);
        b.upkeep = 4;
        b.zone = ZoneId.Beach;
        break;

      case "pool_penguin":
        // 펭귄 풀: Fun H, cap6, 15s, sat85, cost2500, 4시간, upkeep5/min, 해금300
        b.type = BuildingType.Pool;
        b.servesNeed = NeedType.Fun;
        b.capacity = 6;
        b.serveTime = 15;
        b.satisfaction = 85;
        b.buildCost = 2500;
        b.buildTime = Catalog.hours(4);
        b.upkeep = 5;
        b.zone = ZoneId.Beach;
        break;

      case "onsen":
        // 천연 온천: Fun+Warmth H, cap4, 12s, sat95, cost7000, 8시간, upkeep5/min, 해금500
        // ServesNeed=Warmth (강력한 Warmth원, Fun 부가효과 Satisfaction 포함).
        b.type = BuildingType.Spa;
        b.servesNeed = NeedType.Warmth;
        b.capacity = 4;
        b.serveTime = 12;
        b.satisfaction = 95;
        b.buildCost = 7000;
        b.buildTime = Catalog.hours(8);
        b.upkeep = 5;
        b.zone = ZoneId.GlacierCave;
        break;

      case "aurora_lounge":
        // 오로라 전망 라운지: Fun H, cap4, 10s, sat100, cost15000, 18시간, upkeep8/min, 해금1200
        b.type = BuildingType.Playroom;
        b.servesNeed = NeedType.Fun;
        b.capacity = 4;
        b.serveTime = 10;
        b.satisfaction = 100;
        b.buildCost = 15000;
        b.buildTime = Catalog.hours(18);
        b.upkeep = 8;
        b.zone = ZoneId.AuroraDeck;
        break;

      // ── 난방 계열 §2.5A ───────────────────────
      case "heat_brazier":
        // 화로: warmth20, 반경1칸, upkeep4/min, 효율5, cost60, 즉시, 해금0
        // HeatingRoom = ambient 온기 생산, 손님 안 받음(cap0).
        b.type = BuildingType.HeatingRoom;
        b.servesNeed = NeedType.Warmth;
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 60;
        b.buildTime = 0;
        b.warmthOutput = 20;
        b.upkeep = 4;
        b.zone = ZoneId.HomeIce;
        break;

      case "heat_room":
        // 난방실: warmth50, 반경2칸, upkeep8/min, 효율6.3, cost250, 30분, 해금50
        b.type = BuildingType.HeatingRoom;
        b.servesNeed = NeedType.Warmth;
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 250;
        b.buildTime = Catalog.min(30);
        b.warmthOutput = 50;
        b.upkeep = 8;
        b.zone = ZoneId.HomeIce;
        break;

      case "heat_central":
        // 중앙난방: warmth120, 반경4칸, upkeep14/min, 효율8.6, cost1500, 4시간, 해금250
        b.type = BuildingType.HeatingRoom;
        b.servesNeed = NeedType.Warmth;
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 1500;
        b.buildTime = Catalog.hours(4);
        b.warmthOutput = 120;
        b.upkeep = 14;
        b.zone = ZoneId.HomeIce;
        break;

      case "heat_geo":
        // 지열 발전소: warmth300, 반경6칸, upkeep6/min, 효율50, cost12000, 12시간, 해금700
        b.type = BuildingType.HeatingRoom;
        b.servesNeed = NeedType.Warmth;
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 12000;
        b.buildTime = Catalog.hours(12);
        b.warmthOutput = 300;
        b.upkeep = 6;
        b.zone = ZoneId.GlacierCave;
        break;

      case "heat_well":
        // 온천 시추정: warmth400, 반경6칸(+온천기능), upkeep4/min, 효율100, cost25000, 24시간, 해금1500
        b.type = BuildingType.HeatingRoom;
        b.servesNeed = NeedType.Warmth;
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 25000;
        b.buildTime = Catalog.hours(24);
        b.warmthOutput = 400;
        b.upkeep = 4;
        b.zone = ZoneId.Pole;
        break;

      // ── 기타 인프라 §2.5B ─────────────────────
      case "generator":
        // 발전실: 전력 자급, 주변 upkeep 절감. cost800, 2시간, upkeep5/min, 해금250
        // — 주석: cap/sat 없음(손님 X). WarmthOutput=0.
        b.type = BuildingType.Generator;
        b.servesNeed = NeedType.Warmth; // 더미 — 실제 효과는 EconomySystem이 별도 처리
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 800;
        b.buildTime = Catalog.hours(2);
        b.warmthOutput = 0;
        b.upkeep = 5;
        b.zone = ZoneId.HomeIce;
        break;

      case "laundry":
        // 세탁실: 청결 유지 보조. cost400, 1시간, upkeep2/min, 해금100
        b.type = BuildingType.Laundry;
        b.servesNeed = NeedType.Clean; // 더미 — MaintenanceSystem이 청결 보조 처리
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 400;
        b.buildTime = Catalog.hours(1);
        b.warmthOutput = 0;
        b.upkeep = 2;
        b.zone = ZoneId.HomeIce;
        break;

      case "stafflounge":
        // 직원 휴게실: 직원 체력·사기 회복. cost600, 2시간, upkeep2/min, 해금200
        b.type = BuildingType.StaffLounge;
        b.servesNeed = NeedType.Fun; // 더미 — StaffSystem이 HR 효과 처리
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 600;
        b.buildTime = Catalog.hours(2);
        b.warmthOutput = 0;
        b.upkeep = 2;
        b.zone = ZoneId.HomeIce;
        break;

      case "storage":
        // 창고: 물자 비축, 돌발 이벤트 완화. cost300, 30분, upkeep1/min, 해금100
        b.type = BuildingType.Storage;
        b.servesNeed = NeedType.Food; // 더미 — EventSystem이 물자 처리
        b.capacity = 0;
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 300;
        b.buildTime = Catalog.min(30);
        b.warmthOutput = 0;
        b.upkeep = 1;
        b.zone = ZoneId.HomeIce;
        break;

      // ── 동선/로비 §2.6 ────────────────────────
      case "frontdesk":
        // 프런트 데스크: 체크인 거점. — 주석: sat/serveTime은 FrontDeskSystem이 결정, 표에 없음.
        b.type = BuildingType.FrontDesk;
        b.servesNeed = NeedType.Sleep; // 더미
        b.capacity = 2; // — 주석: 동시 체크인 2명, 합리적 추정
        b.serveTime = 5; // — 주석: 체크인 5초, 합리적 추정
        b.satisfaction = 0;
        b.buildCost = 0; // ★1 기본 제공
        b.buildTime = 0;
        b.upkeep = 1;
        b.zone = ZoneId.HomeIce;
        break;

      case "lobby":
        // 로비: 손님 진입·대기 공간. ★1 기본 제공.
        b.type = BuildingType.Lobby;
        b.servesNeed = NeedType.Sleep; // 더미
        b.capacity = 10; // — 주석: 대기 손님 최대 10명, 합리적 추정
        b.serveTime = 0;
        b.satisfaction = 0;
        b.buildCost = 0;
        b.buildTime = 0;
        b.upkeep = 0;
        b.zone = ZoneId.HomeIce;
        break;

      default:
        throw new Error("알 수 없는 건물 defKey: " + defKey);
    }

    return b;
  }

  // ════════════════════════════════════════════════
  // createStaff — CONTENT §1
  // ════════════════════════════════════════════════

  // 역할·레어도 기반 직원 인스턴스를 생성한다.
  // Wage와 Skill 기본값은 CONTENT §1.2 및 §1.1 역할 설명 기반.
  // 레어도 보정: Common×1.0 / Rare×1.2 / Epic×1.5.
  // — 주석: 표에 레어도별 수치 없음. 보정 배율은 합리적 추정.
  static createStaff(role: StaffRole, r: Rarity, id: string): Staff {
    const s = new Staff();
    s.id = id;
    s.role = role;
    s.rarity = r;

    // 역할별 기본 Wage(coin/min), 기본 Skill(1.0 기준)
    let baseWage: number;
    let baseSkill: number;

    switch (role) {
      case StaffRole.FrontDesk:
        // 프런트: 체크인 처리 속도. 없으면 대기열 폭증.
        baseWage = 3;
        baseSkill = 1.0;
        break;

      case StaffRole.Bellboy:
        // 벨보이: 이동 속도↑ → patience 보존.
        baseWage = 2;
        baseSkill = 1.0;
        break;

      case StaffRole.Chef:
        // 셰프: serveTime↓ + 요리 품질.
        baseWage = 5;
        baseSkill = 1.0;
        break;

      case StaffRole.Housekeeping:
        // 하우스키핑: 청결 회복량.
        baseWage = 3;
        baseSkill = 1.0;
        break;

      case StaffRole.Engineer:
        // 엔지니어: 난방·시설 효율 유지.
        baseWage = 4;
        baseSkill = 1.0;
        break;

      case StaffRole.Entertainer:
        // 엔터테이너: 대기 patience 회복, Fun 욕구.
        baseWage = 4;
        baseSkill = 1.0;
        break;

      case StaffRole.Manager:
        // 매니저: 구역 버프, 직원 효율↑. 고급 운영직 → 높은 wage.
        baseWage = 8;
        baseSkill = 1.0;
        break;

      default:
        throw new Error("알 수 없는 StaffRole: " + role);
    }

    // 레어도 보정
    const rarityMult = Catalog.rarityMultiplier(r);
    s.wage = roundAwayFromZero(baseWage * rarityMult);
    s.skill = roundAwayFromZero(baseSkill * rarityMult * 100) / 100;

    return s;
  }

  // ────────────────────────────────────────────────
  // 내부 헬퍼
  // ────────────────────────────────────────────────

  // 레어도별 능력 보정 배율.
  private static rarityMultiplier(r: Rarity): number {
    switch (r) {
      case Rarity.Common: return 1.0;
      case Rarity.Rare: return 1.2;
      case Rarity.Epic: return 1.5;
      default: return 1.0;
    }
  }

  // Need 생성 단축 헬퍼.
  private static n(t: NeedType, w: number): Need {
    return new Need(t, w);
  }

  // Need 배열을 ReadonlyArray로 래핑.
  private static itinerary(...needs: Need[]): ReadonlyArray<Need> {
    return needs;
  }
}
