// Enums.cs + GameEnums.cs 1:1 포팅. 멤버명은 C# 과 글자 그대로 동일.

// 손님 종(species). CONTENT §3.5 전체 로스터(20종+).
export enum Species {
  // A. 기본 (추위 강함·저수익)
  TravelPenguin, // 여행펭귄 — 튜토리얼
  Seal, // 물범
  SeaLionFamily, // 바다사자 가족 (단체)
  Gull, // 갈매기 (진상)
  // B. 중급 (따뜻함 필요 시작)
  PenguinNewlyweds, // 펭귄 신혼부부
  SchoolTrip, // 펭귄 수학여행단 (러시)
  WalrusBiz, // 바다코끼리 사업가
  // C. 열대 관광객 (추위 폭발 — 시그니처)
  Flamingo, // 플라밍고
  Turtle, // 거북이
  ParrotInfluencer, // 앵무새 인플루언서
  MonkeyFamily, // 원숭이 가족
  // D. VIP (고수익·고난도)
  Whale, // 고래
  Orca, // 범고래
  EmperorPenguin, // 황제펭귄 귀족
  Narwhal, // 일각고래
  // E. 특수 (이벤트·평판 변수)
  MysteryCritic, // 미스터리 평론가
  Celebrity, // 셀럽
  Regular, // 단골
  ForeignTourist, // 외국 동물 관광객
  SantaPenguin, // 산타 펭귄(시즌)
}

export enum GuestTier {
  Normal,
  VIP,
}

// 손님 욕구 종류. itinerary는 이 욕구들의 순서 목록.
export enum NeedType {
  Sleep,
  Food,
  Fun,
  Warmth,
  Clean,
}

// 시설 종류. HeatingRoom·Generator 등 운영시설은 손님을 안 받음. CONTENT §2.
export enum BuildingType {
  // 손님 받는 시설
  Room,
  Restaurant,
  Cafe,
  Spa,
  Playroom,
  Pool,
  Bar,
  Shop,
  // 운영시설(손님 X)
  HeatingRoom,
  Generator,
  Laundry,
  StaffLounge,
  Storage,
  // 동선/장식
  Lobby,
  FrontDesk,
  Decoration,
}

// 직원 역할 (MVP 핵심 일부).
export enum StaffRole {
  FrontDesk,
  Bellboy,
  Chef,
  Housekeeping,
  Engineer,
  Entertainer,
  Manager,
}

export enum Rarity {
  Common,
  Rare,
  Epic,
}

// 손님 상태머신 단계 (CORE_LOOP §8). 이탈은 patience 하나로 통일(이슈6).
// Arriving → (Waiting → Moving → BeingServed)* → Checkout → Leaving → Done
// 실패 시 Waiting/Moving/BeingServed 중 → AngryLeaving → Done
export enum GuestPhase {
  Arriving,
  Waiting, // 다음 욕구 시설 배정 대기 (patience 카운트다운)
  Moving, // 시설로 이동 중 (야외면 bodyWarmth 하락)
  BeingServed, // 시설에서 응대받는 중 (serveTime)
  Checkout, // 여정 완료, 코인 풍선 대기
  Leaving, // 만족 퇴장
  AngryLeaving, // patience 0 → 악평 퇴장
  Done, // 제거 대상
}

// ---- GameEnums.cs ----

// 시설 생애주기 단계. 건설/업그레이드 중엔 손님을 안 받는다. CORE_LOOP §3.2.
export enum BuildingPhase {
  UnderConstruction,
  Active,
  Upgrading,
}

// 구역(zone). 큰 단위 확장 이정표. GAME_DESIGN §7.5.
export enum ZoneId {
  HomeIce,
  Beach,
  GlacierCave,
  AuroraDeck,
  Pole,
}

// 직원 특성(레어 효과). CONTENT §1.2.
export enum StaffTrait {
  None,
  IceMaster,
  Popular,
  Diligent,
  Mentor,
  Workaholic,
  Celebrity,
}

// 이벤트 종류. 러시·돌발·평판 변수. CONTENT §3.
export enum EventType {
  TourBusRush,
  AuroraSeason,
  VipVisit,
  Blizzard,
  PowerOutage,
  MysteryCritic,
  FoodShortage,
}
