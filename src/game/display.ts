// 표시(한글명·아이콘·색) 매핑 — UI·월드 렌더러 공용 단일 소스.
// 코어(로직)는 표시 정보를 갖지 않으므로 여기서 enum/defKey → 사람용 표현으로 변환한다.
// 수치 근거: CONTENT.md.

import { Species, NeedType, StaffRole, EventType, BuildingType } from "../core/models/enums";

// ── 손님(종) ───────────────────────────────────────────────
// body=몸통색, belly=배색, accent=부리/발 등 포인트색. 펭귄 외 동물도 펭귄풍 마스코트로 단순화.
export interface SpeciesSkin {
  name: string;
  body: number;
  belly: number;
  accent: number;
  scale: number; // 체구(고래·셀럽 등 큼)
  emoji: string;
}

export const SPECIES: Record<Species, SpeciesSkin> = {
  [Species.TravelPenguin]: { name: "여행펭귄", body: 0x2b3a55, belly: 0xfdfdfd, accent: 0xffa726, scale: 1, emoji: "🐧" },
  [Species.Seal]: { name: "물범", body: 0x8d9bb0, belly: 0xe9eef5, accent: 0x5b6b82, scale: 1.05, emoji: "🦭" },
  [Species.SeaLionFamily]: { name: "바다사자 가족", body: 0x7a6552, belly: 0xd9c7b2, accent: 0x4a3b2e, scale: 1.1, emoji: "🦭" },
  [Species.Gull]: { name: "갈매기", body: 0xf2f4f7, belly: 0xffffff, accent: 0xf6c945, scale: 0.9, emoji: "🐦" },
  [Species.PenguinNewlyweds]: { name: "펭귄 신혼부부", body: 0x33405c, belly: 0xffffff, accent: 0xff7aa2, scale: 1, emoji: "💑" },
  [Species.SchoolTrip]: { name: "수학여행단", body: 0x3a4d6e, belly: 0xfdfdfd, accent: 0xffd54f, scale: 0.92, emoji: "🎒" },
  [Species.WalrusBiz]: { name: "바다코끼리 사업가", body: 0x6b5e74, belly: 0xcabfe0, accent: 0xd7b56b, scale: 1.2, emoji: "🦣" },
  [Species.Flamingo]: { name: "플라밍고", body: 0xff8fb6, belly: 0xffd1e0, accent: 0xff5d8f, scale: 1.05, emoji: "🦩" },
  [Species.Turtle]: { name: "거북이", body: 0x5a9367, belly: 0xcfe6c4, accent: 0x3d6b48, scale: 1, emoji: "🐢" },
  [Species.ParrotInfluencer]: { name: "앵무새 인플루언서", body: 0x36c2a8, belly: 0xfff3b0, accent: 0xff6f3c, scale: 1, emoji: "🦜" },
  [Species.MonkeyFamily]: { name: "원숭이 가족", body: 0x9c6b43, belly: 0xe3c9a8, accent: 0x6e4527, scale: 1, emoji: "🐒" },
  [Species.Whale]: { name: "고래", body: 0x3f6aa0, belly: 0xcfe0f2, accent: 0x274a73, scale: 1.5, emoji: "🐋" },
  [Species.Orca]: { name: "범고래", body: 0x1c2530, belly: 0xffffff, accent: 0x3aa0c4, scale: 1.45, emoji: "🐳" },
  [Species.EmperorPenguin]: { name: "황제펭귄 귀족", body: 0x23304a, belly: 0xfff4cf, accent: 0xffc23a, scale: 1.15, emoji: "👑" },
  [Species.Narwhal]: { name: "일각고래", body: 0x6f86b8, belly: 0xe6edf7, accent: 0xf2f2f2, scale: 1.3, emoji: "🦄" },
  [Species.MysteryCritic]: { name: "미스터리 평론가", body: 0x3a3550, belly: 0x9a93b3, accent: 0xb388ff, scale: 1, emoji: "🕵️" },
  [Species.Celebrity]: { name: "셀럽", body: 0x46405e, belly: 0xfff0c2, accent: 0xffd24a, scale: 1.1, emoji: "🌟" },
  [Species.Regular]: { name: "단골", body: 0x2f3e58, belly: 0xfdfdfd, accent: 0x7ed0a0, scale: 1, emoji: "🐧" },
  [Species.ForeignTourist]: { name: "외국 관광객", body: 0x394a66, belly: 0xfdfdfd, accent: 0x5ec8e2, scale: 1, emoji: "🧳" },
  [Species.SantaPenguin]: { name: "산타펭귄", body: 0xc0392b, belly: 0xffffff, accent: 0xf5f5f5, scale: 1.1, emoji: "🎅" },
};

// ── 욕구(Need) ─────────────────────────────────────────────
export interface NeedSkin {
  name: string;
  emoji: string;
  color: number;
}
export const NEEDS: Record<NeedType, NeedSkin> = {
  [NeedType.Sleep]: { name: "잠자리", emoji: "🛏️", color: 0x7ea8ff },
  [NeedType.Food]: { name: "먹이", emoji: "🍤", color: 0xffb74d },
  [NeedType.Fun]: { name: "놀거리", emoji: "🎉", color: 0xff8fc7 },
  [NeedType.Warmth]: { name: "온기", emoji: "🔥", color: 0xff7043 },
  [NeedType.Clean]: { name: "청결", emoji: "🧹", color: 0x80deea },
};

// ── 시설(defKey) ───────────────────────────────────────────
export type BuildCategory = "room" | "fnb" | "amenity" | "ops" | "circulation";

export interface BuildingDef {
  key: string;
  name: string;
  emoji: string;
  category: BuildCategory;
  unlockRep: number; // 누적 평판 해금(peakReputation 기준)
  roof: number; // 지붕/본체 색
  wall: number; // 벽/하단 색
}

// CONTENT §2.2~2.6 + Catalog.createBuilding 의 defKey 와 1:1.
export const BUILDINGS: BuildingDef[] = [
  // 객실(이글루 티어)
  { key: "igloo_t1", name: "이글루 도미토리", emoji: "🛏️", category: "room", unlockRep: 0, roof: 0xeaf2fb, wall: 0xbcd2ea },
  { key: "igloo_t2", name: "스탠다드 이글루", emoji: "🛏️", category: "room", unlockRep: 50, roof: 0xe3effb, wall: 0xa9c6e6 },
  { key: "igloo_t3", name: "디럭스 이글루", emoji: "🛏️", category: "room", unlockRep: 200, roof: 0xdfeefc, wall: 0x9bc0ea },
  { key: "igloo_t4", name: "오로라 이글루", emoji: "🛏️", category: "room", unlockRep: 600, roof: 0xd7ecff, wall: 0x86b6ec },
  { key: "igloo_t5", name: "그랜드 이글루", emoji: "🛏️", category: "room", unlockRep: 1500, roof: 0xcfe7ff, wall: 0x6fa8e8 },
  // 식음(F&B)
  { key: "rest_fishstand", name: "빙어 노점", emoji: "🍤", category: "fnb", unlockRep: 0, roof: 0xff7043, wall: 0xffd3a8 },
  { key: "cafe_hotchoc", name: "핫초코 카페", emoji: "☕", category: "fnb", unlockRep: 50, roof: 0x8d5524, wall: 0xe6c39a },
  { key: "rest_seafood", name: "씨푸드 레스토랑", emoji: "🦐", category: "fnb", unlockRep: 200, roof: 0xe85d5d, wall: 0xf6c6b8 },
  { key: "rest_aurorabar", name: "오로라 바", emoji: "🍸", category: "fnb", unlockRep: 600, roof: 0x6a4fb0, wall: 0xc3b6ee },
  { key: "rest_michelin", name: "미슐랭 다이닝", emoji: "🍽️", category: "fnb", unlockRep: 1500, roof: 0xb8860b, wall: 0xf0dca0 },
  // 편의/엔터
  { key: "play_snow", name: "눈놀이터", emoji: "🎉", category: "amenity", unlockRep: 50, roof: 0x4fc3f7, wall: 0xc6ecfb },
  { key: "sled", name: "눈썰매장", emoji: "🛷", category: "amenity", unlockRep: 150, roof: 0xef6c6c, wall: 0xf6cccc },
  { key: "spa_ice", name: "얼음 스파", emoji: "💎", category: "amenity", unlockRep: 250, roof: 0x66d0e0, wall: 0xc8f0f6 },
  { key: "pool_penguin", name: "펭귄 풀", emoji: "🏊", category: "amenity", unlockRep: 300, roof: 0x29b6f6, wall: 0xb3e5fc },
  { key: "onsen", name: "천연 온천", emoji: "♨️", category: "amenity", unlockRep: 500, roof: 0xff8a65, wall: 0xffd0bd },
  { key: "aurora_lounge", name: "오로라 전망 라운지", emoji: "🌌", category: "amenity", unlockRep: 1200, roof: 0x5e54a0, wall: 0xb9b0e6 },
  // 운영
  { key: "heat_brazier", name: "화로", emoji: "🔥", category: "ops", unlockRep: 0, roof: 0xff5722, wall: 0x6d4c41 },
  { key: "heat_room", name: "난방실", emoji: "🔥", category: "ops", unlockRep: 50, roof: 0xff7043, wall: 0x795548 },
  { key: "heat_central", name: "중앙난방", emoji: "🔥", category: "ops", unlockRep: 250, roof: 0xff8a50, wall: 0x6d4c41 },
  { key: "heat_geo", name: "지열 발전소", emoji: "🌋", category: "ops", unlockRep: 700, roof: 0xd84315, wall: 0x4e342e },
  { key: "heat_well", name: "온천 시추정", emoji: "♨️", category: "ops", unlockRep: 1500, roof: 0xbf360c, wall: 0x3e2723 },
  { key: "generator", name: "발전실", emoji: "⚡", category: "ops", unlockRep: 250, roof: 0xfdd835, wall: 0x616161 },
  { key: "laundry", name: "세탁실", emoji: "🧺", category: "ops", unlockRep: 100, roof: 0x4dd0e1, wall: 0xb2ebf2 },
  { key: "stafflounge", name: "직원 휴게실", emoji: "🛋️", category: "ops", unlockRep: 200, roof: 0xa1887f, wall: 0xd7ccc8 },
  { key: "storage", name: "창고", emoji: "📦", category: "ops", unlockRep: 100, roof: 0x8d6e63, wall: 0xbcaaa4 },
  // 동선/로비
  { key: "frontdesk", name: "프런트 데스크", emoji: "🛎️", category: "circulation", unlockRep: 0, roof: 0x90a4ae, wall: 0xcfd8dc },
  { key: "lobby", name: "로비", emoji: "🚪", category: "circulation", unlockRep: 0, roof: 0xb0bec5, wall: 0xeceff1 },
];

export const BUILDING_BY_KEY: Record<string, BuildingDef> = Object.fromEntries(
  BUILDINGS.map((b) => [b.key, b]),
);

// HotelManager 가 만드는 MVP 시작 시설 id → defKey (시작 시설엔 defKey 메타가 없으므로 매핑).
export const STARTING_BUILDING_DEF: Record<string, string> = {
  igloo1: "igloo_t1",
  rest1: "rest_fishstand",
  cafe1: "cafe_hotchoc",
  heat1: "heat_room",
};

// 시설 타입 → 폴백 표현(시작 시설/미지의 defKey 용).
export const TYPE_FALLBACK: Partial<Record<BuildingType, { name: string; emoji: string; roof: number; wall: number; category: BuildCategory }>> = {
  [BuildingType.Room]: { name: "객실", emoji: "🛏️", roof: 0xeaf2fb, wall: 0xbcd2ea, category: "room" },
  [BuildingType.Restaurant]: { name: "식당", emoji: "🍤", roof: 0xff7043, wall: 0xffd3a8, category: "fnb" },
  [BuildingType.Cafe]: { name: "카페", emoji: "☕", roof: 0x8d5524, wall: 0xe6c39a, category: "fnb" },
  [BuildingType.HeatingRoom]: { name: "난방실", emoji: "🔥", roof: 0xff7043, wall: 0x795548, category: "ops" },
};

// ── 직원(역할) ─────────────────────────────────────────────
export const STAFF_ROLES: Record<StaffRole, { name: string; emoji: string }> = {
  [StaffRole.FrontDesk]: { name: "프런트", emoji: "🛎️" },
  [StaffRole.Bellboy]: { name: "벨보이", emoji: "🧳" },
  [StaffRole.Chef]: { name: "셰프", emoji: "👨‍🍳" },
  [StaffRole.Housekeeping]: { name: "하우스키핑", emoji: "🧹" },
  [StaffRole.Engineer]: { name: "엔지니어", emoji: "🔧" },
  [StaffRole.Entertainer]: { name: "엔터테이너", emoji: "🎤" },
  [StaffRole.Manager]: { name: "매니저", emoji: "🐧" },
};

// ── 이벤트 ────────────────────────────────────────────────
export const EVENTS: Record<EventType, { name: string; emoji: string }> = {
  [EventType.TourBusRush]: { name: "단체 관광버스", emoji: "🚌" },
  [EventType.AuroraSeason]: { name: "오로라 시즌", emoji: "🌌" },
  [EventType.VipVisit]: { name: "VIP 방문", emoji: "⭐" },
  [EventType.Blizzard]: { name: "눈보라", emoji: "❄️" },
  [EventType.PowerOutage]: { name: "정전", emoji: "🔌" },
  [EventType.MysteryCritic]: { name: "미스터리 평론가", emoji: "🕵️" },
  [EventType.FoodShortage]: { name: "식재료 품귀", emoji: "🐟" },
};

// 누적 평판 → 별 등급(★). CORE_LOOP §6: 50/200/600/1500 = ★2/3/4/5.
export function starRating(rep: number): number {
  if (rep >= 1500) return 5;
  if (rep >= 600) return 4;
  if (rep >= 200) return 3;
  if (rep >= 50) return 2;
  return 1;
}
