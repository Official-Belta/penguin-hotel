import { GameSystem } from "../contracts/index";
import { GameState } from "../gameState";
import { Building } from "../models/building";
import { BuildingPhase, BuildingType } from "../models/enums";

// 건설·업그레이드 생애주기 관리 시스템. GAME_DESIGN §0(실시간 건설·오프라인 보정·영업 토글).
//
// 역할 요약:
// - startBuild : 코인 차감 후 시설을 건설 대기열에 올린다.
// - startUpgrade : 코인 차감 후 시설을 업그레이드 대기열에 올린다.
// - gemSkip : 젬 잔액 확인 후 건설/업그레이드를 즉시 완성한다(실제 젬 차감은 호출 측 책임 — EconomySystem 계약에 젬 차감 공개 메서드가 없음).
// - tick : 매 프레임 dt(초)만큼 타이머를 전진시켜 완성 처리한다.
// - applyOfflineElapsed : 복귀 시 경과 시간을 건설 타이머에만 반영(idle 코인 없음).
export class ConstructionSystem implements GameSystem {
  // ---- 업그레이드 스탯 상승 배율 ----
  // 레벨업 시 Capacity, Satisfaction, WarmthOutput에 적용하는 증가 배율.
  // 밸런싱 조정 전제이며 MvpConfig에 상수가 추가되기 전까지 이 파일에서 정의한다.
  private static readonly capacityUpgradeMult = 0.25; // +25 % (ceil)
  private static readonly satisfactionUpgradeMult = 0.10; // +10 % (ceil)
  private static readonly warmthUpgradeMult = 0.20; // +20 % (ceil)

  // 건설을 시작한다. 코인이 충분하면 차감 후 b를 건설 대기 상태로 전환하고
  // GameState.buildings에 추가한 뒤 true를 반환한다. 코인 부족 시 false.
  //
  // 사전 조건: b는 아직 buildings 목록에 없는 새 시설이어야 한다.
  // 이미 목록에 있는 동일 인스턴스를 전달하면 코인 차감 없이 false를 반환한다(중복 추가 방어).
  startBuild(s: GameState | null, b: Building | null): boolean {
    if (s == null || b == null) return false;
    // 중복 추가 방어: 이미 목록에 있는 인스턴스면 코인 차감 전에 거부(환불 문제 없음).
    // 같은 Building이 buildings에 두 번 들어가면 tick/upkeep/순회에서 이중 처리된다.
    if (s.buildings.includes(b)) return false;
    if (!s.economy.trySpend(b.buildCost)) return false;

    b.phase = BuildingPhase.UnderConstruction;
    b.isActive = false;
    b.buildTimer = b.buildTime > 0 ? b.buildTime : 0;
    s.buildings.push(b);

    // 건설 시간이 0이면 즉시 완성 처리.
    if (b.buildTimer <= 0) {
      ConstructionSystem.completeConstruction(b);
    }

    return true;
  }

  // 업그레이드를 시작한다. 코인이 충분하면 차감 후 b를 업그레이드 대기 상태로 전환하고
  // true를 반환한다. 코인 부족이나 이미 건설/업그레이드 중인 경우 false.
  startUpgrade(s: GameState | null, b: Building | null): boolean {
    if (s == null || b == null) return false;
    if (b.phase !== BuildingPhase.Active) return false;
    if (!s.economy.trySpend(b.upgradeCost)) return false;

    b.phase = BuildingPhase.Upgrading;
    b.isActive = false;
    b.buildTimer = b.upgradeTime > 0 ? b.upgradeTime : 0;

    // 업그레이드 시간이 0이면 즉시 완성.
    if (b.buildTimer <= 0) {
      ConstructionSystem.completeUpgrade(b);
    }

    return true;
  }

  // 젬을 사용해 건설/업그레이드를 즉시 완성한다.
  // b가 UnderConstruction 또는 Upgrading이어야 하고,
  // gemCost는 양수여야 하며 젬 잔액이 그 이상이어야 한다.
  // 비용이 0 이하이면 '공짜 스킵' 악용을 막기 위해 완성하지 않고 false를 반환한다.
  //
  // ※ EconomySystem 계약에 젬 차감 전용 공개 메서드가 없으므로, 실제 젬 차감은
  // 호출 측(HotelManager / UI 레이어)에서 별도로 처리해야 한다.
  // 이 메서드는 잔액 확인 후 즉시 완성 상태 전환만 담당한다.
  gemSkip(s: GameState | null, b: Building | null, gemCost: number): boolean {
    if (s == null || b == null) return false;
    if (b.phase === BuildingPhase.Active) return false;
    // 비용이 0 이하(비정상 입력)면 '공짜 스킵'을 막기 위해 완성하지 않는다.
    // EconomySystem.trySpend가 amount<=0을 방어하는 것과 동일한 취지.
    if (gemCost <= 0) return false;
    if (s.economy.gem < gemCost) return false;

    // 젬 차감: EconomySystem 계약 한계로 호출 측에 위임(위 doc 참고).
    // 잔액 체크만 여기서 하고 상태 전환을 수행한다.

    const wasUpgrading = b.phase === BuildingPhase.Upgrading;
    b.buildTimer = 0;

    if (wasUpgrading) {
      ConstructionSystem.completeUpgrade(b);
    } else {
      ConstructionSystem.completeConstruction(b);
    }

    return true;
  }

  // 매 틱 전진. UnderConstruction/Upgrading 상태의 시설들에 대해
  // buildTimer를 dt만큼 차감하고, 0 이하가 되면 완성 처리한다.
  // dt가 0 이하면 아무 일도 하지 않는다.
  tick(state: GameState | null, dt: number): void {
    if (state == null || dt <= 0) return;

    const buildings = state.buildings;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b == null) continue;

      if (b.phase === BuildingPhase.UnderConstruction) {
        b.buildTimer -= dt;
        if (b.buildTimer <= 0) {
          b.buildTimer = 0;
          ConstructionSystem.completeConstruction(b);
        }
      } else if (b.phase === BuildingPhase.Upgrading) {
        b.buildTimer -= dt;
        if (b.buildTimer <= 0) {
          b.buildTimer = 0;
          ConstructionSystem.completeUpgrade(b);
        }
      }
    }
  }

  // 오프라인 복귀 시 경과 시간(초)만큼 건설/업그레이드 타이머를 전진시킨다.
  // idle 수익(코인 가산)은 없으며 타이머 진행과 완성 처리만 수행한다(GAME_DESIGN §0).
  // seconds가 0 이하면 아무 일도 하지 않는다.
  applyOfflineElapsed(s: GameState | null, seconds: number): void {
    if (s == null || seconds <= 0.0) return;

    const buildings = s.buildings;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b == null) continue;

      if (
        b.phase === BuildingPhase.UnderConstruction ||
        b.phase === BuildingPhase.Upgrading
      ) {
        const wasUpgrading = b.phase === BuildingPhase.Upgrading;

        // double 정밀도로 차감 후 저장(BuildTimer는 float).
        const remaining = b.buildTimer - seconds;
        if (remaining <= 0.0) {
          b.buildTimer = 0;
          if (wasUpgrading) ConstructionSystem.completeUpgrade(b);
          else ConstructionSystem.completeConstruction(b);
        } else {
          // 남은 시간이 float 범위를 넘을 수 없으므로 clamp 없이 캐스팅.
          b.buildTimer = remaining;
        }
      }
    }
    // idle 코인 가산 없음 — 의도적으로 비워 둔다.
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────

  // 건설 완료: phase=Active, isActive=true로 전환한다.
  private static completeConstruction(b: Building): void {
    b.phase = BuildingPhase.Active;
    b.isActive = true;
    b.buildTimer = 0;
  }

  // 업그레이드 완료: level을 1 올리고 스탯을 상승시킨 뒤 phase=Active, isActive=true로 전환한다.
  //
  // 스탯 상승 규칙(모두 기존 값이 >0 일 때만 적용 — 기본 0인 운영시설 스탯은 0 유지):
  // - Capacity: +25 % (ceil, 최소 +1; base 0이면 유지 → HeatingRoom 객실화 방지)
  // - Satisfaction: +10 % (ceil, 최대 100; base 0이면 유지)
  // - WarmthOutput: +20 % (ceil, HeatingRoom이고 base>0 인 경우에만)
  private static completeUpgrade(b: Building): void {
    b.level++;

    // Capacity 상승: ceil(현재 × mult), 최소 +1.
    // 단, 기본값이 0인 운영시설(HeatingRoom cap 0 — CONTENT/§3.2)은 0을 유지해야 한다.
    // Capacity가 1이 되면 hasFreeSlot이 true가 되어 손님 라우팅 대상(객실화)이 되므로,
    // WarmthOutput처럼 base>0 전제하에서만 상승시킨다.
    if (b.capacity > 0) {
      let capIncrease = Math.ceil(b.capacity * ConstructionSystem.capacityUpgradeMult);
      if (capIncrease < 1) capIncrease = 1;
      b.capacity += capIncrease;
    }

    // Satisfaction 상승: ceil, 100 clamp.
    // 마찬가지로 기본값이 0인 시설(손님을 안 받는 운영시설)은 0을 유지한다.
    if (b.satisfaction > 0) {
      let satIncrease = Math.ceil(b.satisfaction * ConstructionSystem.satisfactionUpgradeMult);
      if (satIncrease < 1) satIncrease = 1;
      b.satisfaction += satIncrease;
      if (b.satisfaction > 100) b.satisfaction = 100;
    }

    // WarmthOutput 상승 (HeatingRoom 전용).
    if (b.type === BuildingType.HeatingRoom && b.warmthOutput > 0) {
      let warmthIncrease = Math.ceil(b.warmthOutput * ConstructionSystem.warmthUpgradeMult);
      if (warmthIncrease < 1) warmthIncrease = 1;
      b.warmthOutput += warmthIncrease;
    }

    b.phase = BuildingPhase.Active;
    b.isActive = true;
    b.buildTimer = 0;
  }
}
