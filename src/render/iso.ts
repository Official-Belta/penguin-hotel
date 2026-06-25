// 아이소메트릭 투영 — 그리드 셀(col,row) ↔ 화면 좌표(px). 2:1 다이아몬드 타일.
// 월드 컨테이너 자체를 카메라로 팬/줌하므로 여기서는 월드 로컬 좌표만 다룬다.

export const TILE_W = 124; // 타일 가로(px)
export const TILE_H = 62; // 타일 세로(px) = TILE_W/2 → 2:1 아이소

export interface Cell {
  col: number;
  row: number;
}
export interface Pt {
  x: number;
  y: number;
}

// 그리드 셀 중심 → 월드 로컬 화면 좌표.
export function cellToScreen(col: number, row: number): Pt {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

// 화면 로컬 좌표 → 가장 가까운 그리드 셀(역투영). 피킹/배치용.
export function screenToCell(x: number, y: number): Cell {
  const col = (x / (TILE_W / 2) + y / (TILE_H / 2)) / 2;
  const row = (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2;
  return { col: Math.round(col), row: Math.round(row) };
}

// 다이아몬드 타일 외곽 4점(로컬, 셀 중심 기준). Graphics.poly 용.
export function tileDiamond(): number[] {
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  // 위 → 오른쪽 → 아래 → 왼쪽
  return [0, -hh, hw, 0, 0, hh, -hw, 0];
}

// 두 점 선형보간(렌더러 손님 이동에 사용).
export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// 프레임률 무관 지수 감쇠 보간 계수(부드러운 follow). dtMS 기반.
// rate ↑ = 더 빨리 따라붙음.
export function smoothK(dtMS: number, rate = 0.012): number {
  return 1 - Math.exp(-rate * dtMS);
}
