import { MvpConfig } from "../config/mvpConfig";
import { Building } from "../models/building";
import { BuildingType } from "../models/enums";

// 엔진 무관 경제 시스템. 코인/젬/평판/대출 잔액을 보유하고,
// 난방 운영비(upkeep)·대출 이자를 시간에 따라 누적 차감/가산한다.
// 설계 근거: CORE_LOOP §5(난방 upkeep 운영비)·§7.7(운영비 비율·난방비 상향),
// GAME_DESIGN §2.9 이슈2(대출 한도), 이슈7(평판 floor).
// 코인은 정수이므로 분당 단위 비용의 소수 잔여는 private 누적기에 모아 1 이상일 때만 정수로 반영한다.
export class EconomySystem {
  private _coin: number;
  private _gem: number;
  private _reputation: number;
  private _loanBalance: number;

  // 분당 단위(coin/min, %/min) 비용을 dt(초) 동안 정수 Coin에 반영하기 위한 소수 잔여 누적기.
  // upkeep은 Coin 차감 방향(양수가 쌓이면 차감), 이자는 LoanBalance 가산 방향으로 누적한다.
  private _upkeepAccrual: number;
  private _interestAccrual: number;

  // 시작 자원으로 경제 시스템을 만든다. 평판은 시작값이 floor 미만이면 floor로 보정한다.
  // startCoin: 시작 코인(MvpConfig.startCoin).
  // startGem: 시작 젬(MvpConfig.startGem).
  // startReputation: 시작 평판(MvpConfig.startReputation).
  constructor(startCoin: number, startGem: number, startReputation: number) {
    this._coin = startCoin;
    this._gem = startGem;
    this._reputation =
      startReputation < MvpConfig.reputationFloor ? MvpConfig.reputationFloor : startReputation;
    this._loanBalance = 0;
    this._upkeepAccrual = 0.0;
    this._interestAccrual = 0.0;
  }

  // 현재 보유 코인. 빚/운영비로 음수가 될 수 있다.
  get coin(): number {
    return this._coin;
  }

  // 현재 보유 젬(프리미엄 화폐).
  get gem(): number {
    return this._gem;
  }

  // 현재 평판. 절대 reputationFloor 미만으로 내려가지 않는다(이슈7).
  get reputation(): number {
    return this._reputation;
  }

  // 현재 대출 잔액(이자 포함 원리금). 0 이상.
  get loanBalance(): number {
    return this._loanBalance;
  }

  // 코인을 가산한다. 음수 인자도 허용하여(빚으로 음수 가능) payout 적립·차감 양쪽에 쓴다.
  // amount: 가산할 코인(음수 가능).
  addCoin(amount: number): void {
    this._coin += amount;
  }

  // 코인이 충분하면(coin>=amount) 차감 후 true, 아니면 그대로 두고 false를 반환한다.
  // 음수/0 amount는 차감 없이 true(잔액 조건은 항상 만족)로 취급한다.
  // amount: 차감을 시도할 코인 양.
  // 반환: 차감에 성공했으면 true.
  trySpend(amount: number): boolean {
    if (amount <= 0) {
      return true;
    }
    if (this._coin < amount) {
      return false;
    }
    this._coin -= amount;
    return true;
  }

  // 평판을 가산한다(양수=상승, 음수=하락). 결과가 reputationFloor 미만이면 floor로 clamp한다(이슈7).
  // amount: 가감할 평판(음수 가능).
  addReputation(amount: number): void {
    this._reputation += amount;
    if (this._reputation < MvpConfig.reputationFloor) {
      this._reputation = MvpConfig.reputationFloor;
    }
  }

  // 손님이 화내고 퇴장할 때의 평판 페널티를 적용한다. 인자는 양수(차감량)로 받으며,
  // 내부적으로 평판에서 그만큼 빼고 reputationFloor로 clamp한다(이슈7).
  // repPenalty: 차감할 평판 양(양수).
  applyAngryPenalty(repPenalty: number): void {
    if (repPenalty <= 0) {
      return;
    }
    this.addReputation(-repPenalty);
  }

  // 활성(isActive) HeatingRoom들의 운영비를 dt(초)만큼 코인에서 차감한다.
  // 동별 비용 = upkeep × heatingUpkeepMultiplier (coin/min). dt초 환산 시 ×dt/60.
  // 소수 잔여는 누적기에 모아 1 이상일 때만 정수로 차감해 누락/과차감을 막는다.
  // (CORE_LOOP §5·§7.7)
  // dt: 경과 시간(초). 0 이하면 아무 일도 하지 않는다.
  // buildings: 현재 시설 목록(null이면 빈 목록처럼 취급).
  tickUpkeep(dt: number, buildings: ReadonlyArray<Building> | null): void {
    if (dt <= 0 || buildings === null) {
      return;
    }

    // 활성 난방실의 분당 운영비 합(coin/min).
    let upkeepPerMin = 0.0;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b === null) {
        continue;
      }
      if (b.type === BuildingType.HeatingRoom && b.isActive) {
        upkeepPerMin += b.upkeep * MvpConfig.heatingUpkeepMultiplier;
      }
    }

    if (upkeepPerMin <= 0.0) {
      return;
    }

    // coin/min → 이번 dt(초)에 발생한 비용. 소수 잔여 누적 후 정수분만 차감.
    this._upkeepAccrual += upkeepPerMin * (dt / 60.0);
    const charge = Math.floor(this._upkeepAccrual);
    if (charge > 0) {
      this._upkeepAccrual -= charge;
      this._coin -= charge;
    }
  }

  // 대출 잔액에 분당 loanInterestPerMin 비율의 이자를 dt(초)만큼 누적 가산한다(복리, 잔액 대비).
  // 소수 잔여는 누적기에 모아 1 이상일 때만 정수로 잔액에 더한다. 잔액이 없으면 아무 일도 안 한다.
  // (GAME_DESIGN §2.9 이슈2)
  // dt: 경과 시간(초). 0 이하면 아무 일도 하지 않는다.
  tickLoanInterest(dt: number): void {
    if (dt <= 0 || this._loanBalance <= 0) {
      return;
    }

    // 잔액 × (분당 이자율) × (dt분). 소수 잔여 누적 후 정수분만 잔액에 가산.
    this._interestAccrual += this._loanBalance * MvpConfig.loanInterestPerMin * (dt / 60.0);
    const add = Math.floor(this._interestAccrual);
    if (add > 0) {
      this._interestAccrual -= add;
      this._loanBalance += add;
    }
  }

  // 현재 대출 한도를 계산한다. = floor((hotelValue + reputation) × loanLimitPerHotelValue).
  // 음수가 나오면 0으로 둔다(이슈2).
  // hotelValue: 호텔 가치(시설 자산 등 외부 산정값).
  // 반환: 허용 가능한 최대 대출 잔액.
  loanLimit(hotelValue: number): number {
    const limit = (hotelValue + this._reputation) * MvpConfig.loanLimitPerHotelValue;
    if (limit <= 0.0) {
      return 0;
    }
    return Math.floor(limit);
  }

  // 대출을 실행한다. amount>0 이고 (현재 잔액+amount)가 한도 이하일 때만
  // 코인을 amount 늘리고 대출 잔액을 amount 늘린 뒤 true. 그 외엔 변화 없이 false(이슈2).
  // amount: 대출 요청액(양수).
  // hotelValue: 한도 계산용 호텔 가치.
  // 반환: 대출에 성공했으면 true.
  takeLoan(amount: number, hotelValue: number): boolean {
    if (amount <= 0) {
      return false;
    }
    if (this._loanBalance + amount > this.loanLimit(hotelValue)) {
      return false;
    }
    this._coin += amount;
    this._loanBalance += amount;
    return true;
  }

  // 대출을 상환한다. 실제 상환액 = min(amount, coin, loanBalance). 그만큼 코인과 잔액에서 뺀다.
  // 음수/0 amount나 갚을 코인·잔액이 없으면 아무 일도 하지 않는다.
  // amount: 상환 희망액.
  repayLoan(amount: number): void {
    if (amount <= 0) {
      return;
    }
    let pay = amount;
    if (pay > this._coin) {
      pay = this._coin;
    }
    if (pay > this._loanBalance) {
      pay = this._loanBalance;
    }
    if (pay <= 0) {
      return;
    }
    this._coin -= pay;
    this._loanBalance -= pay;
  }
}
