import { RandomSource } from "./contracts/index";
import { Building } from "./models/building";
import { Guest } from "./models/guest";
import { Staff } from "./models/staff";
import { ZoneId, EventType } from "./models/enums";
import { EconomySystem } from "./systems/economySystem";

// 게임 전역 상태 컨테이너. 모든 도메인 시스템이 이 하나의 상태를 읽고 변경한다(단일 소스).
// HotelManager가 이 GameState를 소유하고, 등록된 시스템들에 매 tick 넘긴다.
export class GameState {
  // 경제(코인·젬·평판·대출).
  economy!: EconomySystem;

  // 호텔 시설 전체.
  readonly buildings: Building[] = [];

  // 현재 호텔에 있는 손님.
  readonly guests: Guest[] = [];

  // 고용된 직원.
  readonly staff: Staff[] = [];

  // 세션 시작 이후 누적 경과(초).
  elapsedSeconds: number = 0;

  // 영업 중 여부(영업/휴장 토글, GAME_DESIGN §0). 휴장이면 신규 손님 차단.
  isOpen: boolean = true;

  // 해금된 구역(진행 게이트).
  readonly unlockedZones: Set<ZoneId> = new Set<ZoneId>([ZoneId.HomeIce]);

  // 누적 평판 최고치(해금 판정용. 평판이 floor로 깎여도 해금은 유지).
  peakReputation: number = 0;

  // 현재 진행 중인 이벤트 종류(없으면 null 비표기). EventSystem이 관리.
  activeEvent: EventType | null = null;

  // 결정론적 난수(스폰·이벤트·가챠 등 모두 이걸로).
  rng!: RandomSource;

  // id로 시설을 찾는다(없으면 null).
  findBuilding(id: string): Building | null {
    for (let i = 0; i < this.buildings.length; i++)
      if (this.buildings[i].id === id) return this.buildings[i];
    return null;
  }

  // id로 직원을 찾는다(없으면 null).
  findStaff(id: string): Staff | null {
    for (let i = 0; i < this.staff.length; i++)
      if (this.staff[i].id === id) return this.staff[i];
    return null;
  }
}
