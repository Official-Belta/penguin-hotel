import { GameSystem } from "../contracts/index";
import { GameState } from "../gameState";
import { Building } from "../models/building";
import { Guest } from "../models/guest";
import { Staff } from "../models/staff";
import { Need } from "../models/need";
import { GuestPhase, StaffRole } from "../models/enums";

// 플레이어 명령(개입) API. "바쁜 탭"의 알맹이(이슈4·이슈3).
// Unity 입력층이 이 시스템의 메서드를 직접 호출한다.
// tick 은 빈 구현 — 개입 시스템은 시간 기반 갱신이 없다.
// 모든 명령은 실패 케이스에서 GameState 를 변경하지 않고
// false 또는 조기 반환으로 상태 불변 원칙을 지킨다.
export class InterventionSystem implements GameSystem {
  // gemRushCapacity 한 번에 추가되는 임시 수용 인원.
  private static readonly gemRushCapacityBonus: number = 2;

  // 재배정(reassignGuest) 시 세팅하는 고정 이동 시간(초).
  // GuestStateMachine.FixedMoveTime(private, 2f)과 동일 값을 유지해
  // 정상 Waiting→Moving 경로와 동선 비용을 일치시킨다.
  private static readonly moveTime: number = 2;

  // 시간 기반 갱신 없음. GameSystem 계약 이행용 빈 구현.
  // state: 현재 게임 상태(사용하지 않음). dt: 경과 시간·초(사용하지 않음).
  tick(state: GameState, dt: number): void {
    // 개입 시스템은 tick-driven 로직 없음.
  }

  // 막힌/대기 중인 손님을 같은 욕구를 처리하고 빈 슬롯이 있는 다른 시설로 재배정한다(이슈4).
  // 전제 조건:
  //  - 손님 GuestPhase 가 Waiting 또는 Moving 여야 한다.
  //  - target 이 손님의 현재 욕구(currentNeed)와 동일한 NeedType 을 서비스해야 한다.
  //  - target 에 빈 슬롯(hasFreeSlot)이 있어야 한다.
  // 성공 시: 기존 시설 occupancy 해제 → target.occupancy 증가 →
  //   g.currentBuilding = target, g.phase = Moving → true.
  //   실패 시: 상태 불변 + false.
  reassignGuest(s: GameState, g: Guest, target: Building): boolean {
    if (s == null || g == null || target == null) {
      return false;
    }

    // 재배정 가능한 단계(Waiting 또는 Moving)인지 확인.
    if (g.phase !== GuestPhase.Waiting && g.phase !== GuestPhase.Moving) {
      return false;
    }

    // 현재 욕구 단계가 존재하는지 확인.
    const currentNeed: Need | null = g.currentNeed;
    if (currentNeed == null) {
      return false;
    }

    // 대상 시설이 같은 욕구를 서비스하는지 확인.
    if (target.servesNeed !== currentNeed.type) {
      return false;
    }

    // 대상 시설에 빈 슬롯이 있는지 확인(isActive && phase==Active && occupancy < capacity).
    if (!target.hasFreeSlot) {
      return false;
    }

    // ── 여기서부터 상태 변경 ──

    // 자기 자신 시설로의 재배정은 점유를 건드리지 않는다(이중 계상 방어).
    // Moving/Waiting 손님이 이미 target occupancy를 차지한 경우 해제-재점유 짝이 맞지 않아
    // occupancy 누수가 발생하므로, phase·stepTimer만 갱신하고 조기 반환한다.
    if (g.currentBuilding === target) {
      g.stepTimer = InterventionSystem.moveTime;
      g.phase = GuestPhase.Moving;
      return true;
    }

    // 이전 시설의 점유 슬롯 해제(null 방어).
    const previous: Building | null = g.currentBuilding;
    if (previous != null) {
      if (previous.occupancy > 0) {
        previous.occupancy--;
      }
    }

    // 대상 시설 점유 증가 및 손님 상태 갱신.
    // stepTimer를 고정 이동 시간으로 재설정해 '동선만 비용' 모델을 유지한다
    // (stale 타이머로 인한 즉시 이동 완료/텔레포트 방지).
    target.occupancy++;
    g.currentBuilding = target;
    g.stepTimer = InterventionSystem.moveTime;
    g.phase = GuestPhase.Moving;

    return true;
  }

  // 엔터테이너 직원을 다른 시설로 재배치한다(이슈4).
  // 전제 조건:
  //  - entertainer 의 role 이 StaffRole.Entertainer 여야 한다.
  //  - 인자가 모두 null 이 아니어야 한다.
  // 성공 시: 이전 시설 assignedStaffIds 제거 → toBuilding assignedStaffIds 추가
  //   → entertainer.assignedBuildingId 갱신 → true.
  //   실패 시: 상태 불변 + false.
  deployEntertainer(s: GameState, entertainer: Staff, toBuilding: Building): boolean {
    if (s == null || entertainer == null || toBuilding == null) {
      return false;
    }

    // 역할 검증: Entertainer 만 허용.
    if (entertainer.role !== StaffRole.Entertainer) {
      return false;
    }

    // 이미 같은 시설이면 no-op 성공.
    if (entertainer.assignedBuildingId === toBuilding.id) {
      return true;
    }

    // ── 여기서부터 상태 변경 ──

    // 이전 시설의 assignedStaffIds 에서 제거.
    if (entertainer.assignedBuildingId != null) {
      const previousBuilding: Building | null = s.findBuilding(entertainer.assignedBuildingId);
      if (previousBuilding != null) {
        const idx = previousBuilding.assignedStaffIds.indexOf(entertainer.id);
        if (idx >= 0) {
          previousBuilding.assignedStaffIds.splice(idx, 1);
        }
      }
    }

    // 새 시설 assignedStaffIds 에 추가(중복 방지).
    if (!toBuilding.assignedStaffIds.includes(entertainer.id)) {
      toBuilding.assignedStaffIds.push(entertainer.id);
    }

    // Staff 배치 정보 갱신.
    entertainer.assignedBuildingId = toBuilding.id;

    return true;
  }

  // 젬(프리미엄 화폐)을 소비해 시설의 수용 인원을 즉시 일시 증설한다(이슈4).
  // 현재는 항상 false를 반환하며 상태를 변경하지 않는다(no-op).
  // EconomySystem 계약에 젬 차감 전용 공개 메서드(trySpendGem)가 없고
  // 계약 파일은 수정 금지이므로, 젬을 실제로 차감할 방법이 없다. 차감 없이 capacity만 늘리면
  // 같은 젬으로 무제한 증설하는 경제 익스플로잇이 되므로, 차감을 보장할 수 없는 한
  // 이 명령은 성공 처리하지 않는다(상태 불변 원칙).
  // 본래 의도("젬 gemCost 차감 → b.capacity += gemRushCapacityBonus")대로
  // 동작시키려면 먼저 EconomySystem 계약에 trySpendGem(n) 를 추가해야 한다.
  // 추가되면 본문을 if (gemCost <= 0 || !s.economy.trySpendGem(gemCost)) return false;
  // (검증과 차감을 원자적으로) 후 b.capacity += gemRushCapacityBonus; return true; 로 교체할 것.
  gemRushCapacity(s: GameState, b: Building, gemCost: number): boolean {
    // 젬을 실제로 차감할 공개 API(trySpendGem)가 EconomySystem 계약에 없다.
    // 차감 없이 capacity를 늘리면 무제한 증설 익스플로잇이 되므로,
    // 차감을 보장할 수 있을 때까지 어떤 경우에도 성공시키지 않고 상태를 변경하지 않는다.
    return false;
  }

  // 호텔 영업/휴장 상태를 설정한다(이슈3).
  // 이 메서드는 GameState.isOpen 플래그만 설정한다.
  // SpawnSystem.trySpawn 시그니처는 (dt, reputation) 로
  // GameState/GameState.isOpen 을 받지도 참조하지도 않는다.
  // 따라서 휴장(open = false) 시 스폰 차단은 스폰 호출자
  // (HotelManager 등)가 GameState.isOpen 을 확인해
  // SpawnSystem.trySpawn 호출 자체를 건너뜀으로써 이루어진다.
  // open: true = 영업, false = 휴장.
  toggleBusiness(s: GameState, open: boolean): void {
    if (s == null) {
      return;
    }

    s.isOpen = open;
  }
}
