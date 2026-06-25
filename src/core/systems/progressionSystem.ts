import { GameSystem } from "../contracts/index";
import { GameState } from "../gameState";
import { ZoneId, Species } from "../models/enums";
import { Catalog } from "../content/catalog";

// 구역-해금 평판 문턱 쌍. (정적 초기화자에서 쓰이므로 ProgressionSystem 보다 먼저 선언)
class ZoneUnlockEntry {
  // 구역 ID.
  readonly zone: ZoneId;

  // 이 구역을 해금하는 데 필요한 누적 평판 최소값.
  readonly requiredRep: number;

  constructor(zone: ZoneId, requiredRep: number) {
    this.zone = zone;
    this.requiredRep = requiredRep;
  }
}

// 진행(Progression) 시스템 — 누적 평판 최고치 기준으로 구역·손님·시설을 해금한다.
// CORE_LOOP §6 평판 게이트 표 + GAME_DESIGN §7.5 구역 맵을 코드화한다.
//
// 핵심 불변식(이슈7 정합): 모든 해금 판정은 GameState.peakReputation 으로만 한다.
// 현재 평판(EconomySystem.reputation)이 floor로 깎여도, 한번 도달했던 누적 평판 최고치는
// 보존되므로 이미 해금된 구역·손님·시설은 영구히 유지된다.
//
// 손님 해금 문턱은 자체 테이블을 두지 않고 Catalog.guestUnlockRep(콘텐츠 단일 소스)에
// 위임한다 → 카탈로그와 진행 게이트가 영구히 동기화된다.
export class ProgressionSystem implements GameSystem {
  // ════════════════════════════════════════════════════════════
  // CORE_LOOP §6 누적 평판 게이트 (참조용 표)
  // | 누적 평판 | 해금 내용                                        |
  // |-----------|--------------------------------------------------|
  // | 0         | 본 빙판(HomeIce), 여행펭귄·물범, 이글루 도미토리 |
  // | 50        | 식당·난방실, 바다사자가족·갈매기                 |
  // | 150       | 신혼부부·수학여행단, 객실/시설 2종               |
  // | 400       | 스파·VIP 라운지, 플라밍고·거북이                 |
  // | 1000      | 해변(Beach) 구역, 고래·범고래 VIP 손님           |
  // 위 손님 문턱의 실제 수치는 Catalog.guestUnlockRep 가 보유(여기서 중복 정의하지 않음).
  // ════════════════════════════════════════════════════════════

  // ────────────────────────────────────────────────────────────
  // 구역 해금 게이트 — GAME_DESIGN §7.5 + CORE_LOOP §6
  // | 구역        | 테마/추위              | 해금 누적 평판 | 근거                       |
  // |-------------|------------------------|---------------|----------------------------|
  // | HomeIce     | 본 빙판(시작)          | 0             | §7.5 "시작"                |
  // | Beach       | 해변 — 바람 강함       | 1000          | CORE_LOOP §6 (해변=1000)   |
  // | GlacierCave | 빙하 동굴 — 보온 유리   | 1500          | §7.5 ★3~4 (Beach 다음 단계)|
  // | AuroraDeck  | 오로라 전망대 — 극한    | 2500          | §7.5 ★4~5                  |
  // | Pole        | 극점/빙산 — 전설        | 5000          | §7.5 ★5+ (확장)            |
  // CORE_LOOP §6 표는 1000(해변)까지만 수치를 명시 → GlacierCave 이상은 §7.5의
  // 별 등급 순서(보온유리→극한→극점)를 단조 증가 평판으로 코드화한다.
  // ────────────────────────────────────────────────────────────

  // 구역별 해금 누적 평판 문턱. CORE_LOOP §6 + GAME_DESIGN §7.5 순서.
  private static readonly s_zoneGates: ZoneUnlockEntry[] = [
    new ZoneUnlockEntry(ZoneId.HomeIce, 0),
    new ZoneUnlockEntry(ZoneId.Beach, 1000),
    new ZoneUnlockEntry(ZoneId.GlacierCave, 1500),
    new ZoneUnlockEntry(ZoneId.AuroraDeck, 2500),
    new ZoneUnlockEntry(ZoneId.Pole, 5000),
  ];

  // ────────────────────────────────────────────────────────────
  // 시설(건물) 해금 게이트 — CONTENT §2.2~2.5 "해금평판" 열
  // defKey는 Catalog.allBuildingDefKeys와 1:1 대응. 손님과 동일하게 peakReputation 기준.
  // (Catalog가 defKey별 해금평판 쿼리를 노출하지 않으므로 여기서 §2 표를 코드화한다.)
  // ────────────────────────────────────────────────────────────

  // 건물 defKey별 해금 누적 평판 문턱. CONTENT §2.2~2.5 해금평판 열.
  private static readonly s_buildingGates: Map<string, number> = new Map<string, number>([
    // 이글루 티어 §2.2
    ["igloo_t1", 0],
    ["igloo_t2", 50],
    ["igloo_t3", 200],
    ["igloo_t4", 600],
    ["igloo_t5", 1500],
    // F&B §2.3
    ["rest_fishstand", 0],
    ["cafe_hotchoc", 50],
    ["rest_seafood", 200],
    ["rest_aurorabar", 600],
    ["rest_michelin", 1500],
    // 편의/엔터 §2.4
    ["play_snow", 50],
    ["sled", 150],
    ["spa_ice", 250],
    ["pool_penguin", 300],
    ["onsen", 500],
    ["aurora_lounge", 1200],
    // 난방 §2.5A
    ["heat_brazier", 0],
    ["heat_room", 50],
    ["heat_central", 250],
    ["heat_geo", 700],
    ["heat_well", 1500],
    // 기타 인프라 §2.5B
    ["generator", 250],
    ["laundry", 100],
    ["stafflounge", 200],
    ["storage", 100],
    // 동선/로비 §2.6 — ★1 기본 제공
    ["frontdesk", 0],
    ["lobby", 0],
  ]);

  // ════════════════════════════════════════════════════════════
  // GameSystem
  // ════════════════════════════════════════════════════════════

  // 1 tick 전진. 누적 평판 최고치를 갱신하고 구역 해금을 적용한다.
  // ① state.peakReputation = max(peakReputation, economy.reputation)
  //    (이슈7: 평판이 floor로 깎여도 최고치는 보존 → 해금 유지).
  // ② 갱신된 peakReputation으로 미해금 구역을 state.unlockedZones에 추가한다.
  // 손님·시설 해금은 별도 상태를 두지 않고 쿼리 시점에 peakReputation으로 판정한다
  // (스폰/건설 시스템이 isGuestUnlocked·isBuildingUnlocked를 호출).
  //
  // dt: 경과 시간(초). 이 시스템은 게이트 갱신만 하므로 수치 자체엔 무관(보존성 위해 사용 안 함).
  tick(state: GameState, dt: number): void {
    if (state == null) return;
    if (state.economy == null) return;

    // ① 누적 평판 최고치 갱신 (이슈7: 깎여도 해금 유지).
    const currentRep = state.economy.reputation;
    if (currentRep > state.peakReputation) {
      state.peakReputation = currentRep;
    }

    // ② 구역 해금 — peakReputation 기준으로 미해금 구역 추가.
    const peak = state.peakReputation;
    for (let i = 0; i < ProgressionSystem.s_zoneGates.length; i++) {
      const entry = ProgressionSystem.s_zoneGates[i];
      if (peak >= entry.requiredRep && !state.unlockedZones.has(entry.zone)) {
        state.unlockedZones.add(entry.zone);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 공개 쿼리
  // ════════════════════════════════════════════════════════════

  // 해당 구역이 현재 해금 상태인지 반환한다.
  // 판정은 state.unlockedZones 집합을 기준으로 한다(Tick에서 peakReputation으로 갱신됨).
  // 깎인 현재 평판이 아니라 누적 최고치로 해금되므로 한번 열린 구역은 유지된다.
  // s가 null이면 false.
  isZoneUnlocked(z: ZoneId, s: GameState): boolean {
    if (s == null) return false;
    return s.unlockedZones.has(z);
  }

  // 해당 손님 종(species)이 현재 해금 상태인지 반환한다.
  // 판정 = state.peakReputation ≥ Catalog.guestUnlockRep(sp).
  // 손님 문턱은 콘텐츠 단일 소스(Catalog)에 위임하므로 카탈로그와 항상 동기화된다.
  // 평판이 내려가도 해금은 유지된다(이슈7 정합). s가 null이면 false.
  isGuestUnlocked(sp: Species, s: GameState): boolean {
    if (s == null) return false;
    return s.peakReputation >= Catalog.guestUnlockRep(sp);
  }

  // 해당 시설(건물 defKey)이 현재 해금 상태인지 반환한다.
  // 판정 = state.peakReputation ≥ CONTENT §2.2~2.5 해금평판(defKey).
  // 손님과 동일하게 누적 최고치 기준이라 한번 해금된 시설은 유지된다(이슈7 정합).
  // s나 defKey가 null이면 false. 알 수 없는 defKey는 false(미해금 취급).
  isBuildingUnlocked(defKey: string, s: GameState): boolean {
    if (s == null || defKey == null) return false;
    const required = ProgressionSystem.s_buildingGates.get(defKey);
    if (required === undefined) {
      // 카탈로그에 정의되지 않은 건물 키 → 안전하게 미해금 처리.
      return false;
    }
    return s.peakReputation >= required;
  }

  // 현재 해금된 모든 구역 목록을 반환한다.
  // 반환값은 읽기 전용 스냅샷이며, 이후 state.unlockedZones가 바뀌어도 영향 없다.
  // s가 null이면 빈 목록.
  allUnlockedZones(s: GameState): ReadonlyArray<ZoneId> {
    if (s == null) return [];
    const result: ZoneId[] = [];
    for (const z of s.unlockedZones) {
      result.push(z);
    }
    return result;
  }
}

// ════════════════════════════════════════════════════════════
// 내부 테이블 보조 구조체
// ════════════════════════════════════════════════════════════

