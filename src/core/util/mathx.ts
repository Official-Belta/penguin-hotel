// 수치 충실성 유틸. C# Math 의미를 TS 로 정확히 보존.

// C# Math.Round(x, MidpointRounding.AwayFromZero) 재현.
// 부호 보존, 0.5 는 절댓값이 큰 쪽으로 반올림.
// (C# 의 기본 Math.Round 는 Banker's 이지만, 이 코드베이스는 AwayFromZero 를 전제.)
export function roundAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

// 값을 [min, max] 로 클램프.
export function clamp(x: number, min: number, max: number): number {
  if (x < min) return min;
  if (x > max) return max;
  return x;
}
