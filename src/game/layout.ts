// 부지 레이아웃 — 코어엔 좌표가 없으므로 여기서 시설을 아이소 그리드 셀에 배치한다.
// 시작 시설은 보기 좋은 고정 자리에, 이후 건설되는 시설은 빈 plot 에 순서대로 채운다.

import { Cell, cellToScreen, Pt } from "../render/iso";

// 시작 4시설의 고정 자리(MVP 월드: igloo1·rest1·cafe1·heat1).
const STARTING_CELLS: Record<string, Cell> = {
  igloo1: { col: 1, row: 1 },
  rest1: { col: 3, row: 1 },
  cafe1: { col: 1, row: 3 },
  heat1: { col: 3, row: 3 },
};

// 신규 건설 시설이 채워질 빈 plot(채움 순서). 입구(4,4) 라인은 비워 둠.
const FREE_PLOTS: Cell[] = [
  { col: 2, row: 2 },
  { col: 0, row: 2 },
  { col: 2, row: 0 },
  { col: 4, row: 2 },
  { col: 2, row: 4 },
  { col: 0, row: 0 },
  { col: 4, row: 0 },
  { col: 0, row: 4 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: 3, row: 0 },
  { col: 0, row: 3 },
  { col: 4, row: 1 },
  { col: 1, row: 4 },
  { col: 4, row: 3 },
  { col: 3, row: 4 },
];

export class Layout {
  // 바닥 타일 그리드 범위(눈밭). 0..maxCol × 0..maxRow.
  readonly maxCol = 4;
  readonly maxRow = 4;

  // 손님 입구 = 아이소 맵의 아래 꼭짓점 쪽.
  readonly entrance: Cell = { col: 4, row: 4 };

  private readonly assigned = new Map<string, Cell>();
  private cursor = 0;

  // 모든 바닥 타일 셀(렌더 정렬·배경용).
  groundCells(): Cell[] {
    const out: Cell[] = [];
    for (let r = 0; r <= this.maxRow; r++) {
      for (let c = 0; c <= this.maxCol; c++) out.push({ col: c, row: r });
    }
    return out;
  }

  // 시설 id의 셀을 보장(없으면 배정). 시작 시설은 고정 자리, 그 외는 빈 plot.
  ensure(buildingId: string): Cell {
    const have = this.assigned.get(buildingId);
    if (have) return have;

    let cell = STARTING_CELLS[buildingId];
    if (!cell) {
      cell = FREE_PLOTS[this.cursor % FREE_PLOTS.length];
      this.cursor++;
    }
    this.assigned.set(buildingId, cell);
    return cell;
  }

  cellOf(buildingId: string): Cell | null {
    return this.assigned.get(buildingId) ?? null;
  }

  screenOf(buildingId: string): Pt | null {
    const c = this.assigned.get(buildingId);
    return c ? cellToScreen(c.col, c.row) : null;
  }

  entranceScreen(): Pt {
    return cellToScreen(this.entrance.col, this.entrance.row);
  }
}
