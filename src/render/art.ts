// 순수 Pixi.js v8 벡터 스프라이트 아트 — Hay Day 풍 큐트·플랫·따뜻한 톤.
// 외부 이미지/폰트 없음. iso.ts 의 타일 치수만 import.
// 모든 export 는 world 가 그대로 호출하는 계약(아래 시그니처) 을 정확히 지킨다.

import { Container, Graphics } from "pixi.js";
import { TILE_W, TILE_H, tileDiamond } from "./iso";

// ─────────────────────────────────────────────────────────────────────────────
// 색 팔레트(따뜻한 눈밭 무드)
// ─────────────────────────────────────────────────────────────────────────────
const SNOW_TOP = 0xf3f8ff; // 타일 윗면(밝은 눈)
const SNOW_SIDE = 0xc9d8ec; // 타일 측면(살짝 어두운 그림자)
const SNOW_LINE = 0xb4c6df; // 타일 외곽선

// ─────────────────────────────────────────────────────────────────────────────
// 색 보조: 16진 색을 밝게/어둡게(0~1 비율). 단순 lerp, 그라데이션 대신 단계 음영용.
// ─────────────────────────────────────────────────────────────────────────────
function shade(color: number, amt: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  let nr: number;
  let ng: number;
  let nb: number;
  if (amt >= 0) {
    // 밝게: 흰색으로 보간
    nr = Math.round(r + (255 - r) * amt);
    ng = Math.round(g + (255 - g) * amt);
    nb = Math.round(b + (255 - b) * amt);
  } else {
    // 어둡게: 검정으로 보간
    const k = 1 + amt;
    nr = Math.round(r * k);
    ng = Math.round(g * k);
    nb = Math.round(b * k);
  }
  return (nr << 16) | (ng << 8) | nb;
}

// ─────────────────────────────────────────────────────────────────────────────
// makeGroundTile — 아이소 눈밭 다이아몬드 1장(중심 0,0). 살짝 입체감.
// ─────────────────────────────────────────────────────────────────────────────
export function makeGroundTile(opts?: { fill?: number; stroke?: number }): Graphics {
  const fill = opts?.fill ?? SNOW_TOP;
  const stroke = opts?.stroke ?? SNOW_LINE;
  const g = new Graphics();

  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const depth = 8; // 측면 두께(px)

  // 측면(아래로 살짝 솟은 두께) — 다이아몬드 아래쪽 두 변을 따라.
  // 왼쪽 아래 변
  g.poly([-hw, 0, 0, hh, 0, hh + depth, -hw, depth]).fill(shade(SNOW_SIDE, -0.04));
  // 오른쪽 아래 변
  g.poly([hw, 0, 0, hh, 0, hh + depth, hw, depth]).fill(SNOW_SIDE);

  // 윗면 다이아몬드(밝은 눈)
  g.poly(tileDiamond()).fill(fill).stroke({ width: 1, color: stroke, alpha: 0.9 });

  // 윗면 하이라이트(위쪽 절반만 살짝 더 밝게) — 입체 강조, 과하지 않게.
  g.poly([0, -hh, hw, 0, 0, 0, -hw, 0]).fill({ color: shade(fill, 0.5), alpha: 0.35 });

  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// makeSelectionTile — 선택 강조 다이아몬드 외곽선(반투명 노랑/하양 글로우).
// ─────────────────────────────────────────────────────────────────────────────
export function makeSelectionTile(): Graphics {
  const g = new Graphics();
  const d = tileDiamond();

  // 바깥 글로우(굵고 흐린 하양)
  g.poly(d).stroke({ width: 7, color: 0xffffff, alpha: 0.18, alignment: 0.5 });
  // 중간 노랑 글로우
  g.poly(d).stroke({ width: 4, color: 0xffe27a, alpha: 0.45, alignment: 0.5 });
  // 또렷한 노랑 라인
  g.poly(d).stroke({ width: 2, color: 0xffd23f, alpha: 0.95, alignment: 0.5 });
  // 옅은 노랑 채움(셀 안쪽 살짝 빛남)
  g.poly(d).fill({ color: 0xffe27a, alpha: 0.1 });

  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// makePenguin — 정면 큐트 마스코트. 약 38px 높이, 발 밑이 (0,0).
//   skin.body=몸통, skin.belly=배, skin.accent=부리/발, skin.scale=크기.
//   고래/플라밍고 등 동물도 같은 실루엣에 색만 바꿔 통일감.
//   world 가 waddle 시 rotation/scale 을 흔든다 → pivot=(0,0)=발밑.
// ─────────────────────────────────────────────────────────────────────────────
export function makePenguin(skin: {
  body: number;
  belly: number;
  accent: number;
  scale: number;
}): Container {
  const c = new Container();
  c.pivot.set(0, 0); // (0,0) = 발 밑. world 가 이 기준으로 흔든다.

  const body = skin.body;
  const belly = skin.belly;
  const accent = skin.accent;

  const W = 26; // 몸통 최대 폭
  const H = 34; // 몸통 높이(머리~엉덩이)
  const cx = 0;
  // 발 밑(0,0) 기준으로 몸통은 위로 쌓는다 → 몸통 바닥 y ≈ -2, 머리 top y ≈ -36
  const bodyBottom = -2;
  const bodyTop = bodyBottom - H;

  // ── 발(주황, 양쪽) ── 발 밑 (0,0) 에 닿도록
  const footY = -1;
  c.addChild(
    new Graphics()
      .ellipse(cx - 6, footY, 6, 3.2)
      .fill(accent)
      .ellipse(cx + 6, footY, 6, 3.2)
      .fill(accent),
  );

  // ── 몸통(둥근 캡슐) ──
  const bodyG = new Graphics();
  // 큰 둥근 몸통: 아래는 넓고 위(머리)로 갈수록 좁아지는 달걀형 → ellipse 두 개 합성
  bodyG
    .ellipse(cx, bodyBottom - 11, W / 2, 13) // 아랫배(넓음)
    .fill(body)
    .ellipse(cx, bodyTop + 11, W / 2 - 3, 12) // 머리/어깨(좁음)
    .fill(body);
  // 몸통 외곽 살짝 어두운 윤곽(부드러운 실루엣)
  bodyG
    .ellipse(cx, bodyBottom - 11, W / 2, 13)
    .stroke({ width: 1.2, color: shade(body, -0.18), alpha: 0.5 });
  c.addChild(bodyG);

  // ── 흰 배(belly) ── 몸통 앞면 큰 타원
  c.addChild(
    new Graphics()
      .ellipse(cx, bodyBottom - 12, W / 2 - 4, 14)
      .fill(belly)
      .ellipse(cx, bodyTop + 13, W / 2 - 7, 9)
      .fill(belly),
  );

  // ── 작은 날개(양옆) ── 몸통 색, 살짝 어둡게
  const wingY = bodyBottom - 14;
  c.addChild(
    new Graphics()
      .ellipse(cx - (W / 2) + 1, wingY, 4, 9)
      .fill(shade(body, -0.08))
      .ellipse(cx + (W / 2) - 1, wingY, 4, 9)
      .fill(shade(body, -0.08)),
  );

  // ── 눈(흰자 + 검은 눈동자 + 하이라이트) ──
  const eyeY = bodyTop + 11;
  const eyeDX = 5.2;
  const eyes = new Graphics();
  // 흰자
  eyes.circle(cx - eyeDX, eyeY, 3.4).fill(0xffffff);
  eyes.circle(cx + eyeDX, eyeY, 3.4).fill(0xffffff);
  // 눈동자
  eyes.circle(cx - eyeDX + 0.6, eyeY + 0.4, 2).fill(0x2b2b33);
  eyes.circle(cx + eyeDX + 0.6, eyeY + 0.4, 2).fill(0x2b2b33);
  // 하이라이트(생기)
  eyes.circle(cx - eyeDX + 1.3, eyeY - 0.5, 0.8).fill(0xffffff);
  eyes.circle(cx + eyeDX + 1.3, eyeY - 0.5, 0.8).fill(0xffffff);
  c.addChild(eyes);

  // ── 부리(주황 삼각, 눈 사이 아래) ──
  const beakY = eyeY + 4;
  c.addChild(
    new Graphics()
      .poly([cx - 3, beakY, cx + 3, beakY, cx, beakY + 4])
      .fill(accent)
      .stroke({ width: 0.8, color: shade(accent, -0.15), alpha: 0.4 }),
  );

  // ── 볼터치(분홍, 반투명) ── 귀여움 포인트
  c.addChild(
    new Graphics()
      .ellipse(cx - 8.5, eyeY + 3, 2.6, 1.8)
      .fill({ color: 0xff9bb0, alpha: 0.55 })
      .ellipse(cx + 8.5, eyeY + 3, 2.6, 1.8)
      .fill({ color: 0xff9bb0, alpha: 0.55 }),
  );

  c.scale.set(skin.scale);
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// makeBuildingSprite — 1타일 footprint 2.5D 큐트 건물. 베이스 중심 (0,0).
//   아이소 베이스 다이아몬드 + 솟은 벽 + 둥근 지붕 + 입구/창.
// ─────────────────────────────────────────────────────────────────────────────
export function makeBuildingSprite(look: { roof: number; wall: number }): Container {
  const c = new Container();
  const roof = look.roof;
  const wall = look.wall;

  const hw = TILE_W / 2;
  const hh = TILE_H / 2;

  const wallH = 40; // 벽 높이(위로 솟음)
  const inset = 14; // 베이스 다이아몬드 안쪽으로 벽을 들여놓는 양(footprint < tile)

  // 벽 윗면(지붕 받침)의 다이아몬드 너비/높이
  const tw = hw - inset; // top half width
  const th = hh - inset / 2; // top half height

  // ── 베이스 그림자 다이아몬드(타일 위에 살짝 깔리는 발자국) ──
  c.addChild(
    new Graphics().poly(tileDiamond()).fill({ color: 0x000000, alpha: 0.08 }),
  );

  // ── 벽(앞면 두 개 — 왼쪽/오른쪽 면, 아이소) ──
  // 베이스 다이아몬드 좌/우/아래 꼭짓점에서 위로 wallH 만큼 솟음.
  const bL = [-tw, 0]; // 왼쪽
  const bR = [tw, 0]; // 오른쪽
  const bB = [0, th]; // 아래(앞 모서리)
  const bT = [0, -th]; // 위(뒤 모서리)

  // 왼쪽 벽면(어둡게)
  c.addChild(
    new Graphics()
      .poly([
        bL[0], bL[1],
        bB[0], bB[1],
        bB[0], bB[1] - wallH,
        bL[0], bL[1] - wallH,
      ])
      .fill(shade(wall, -0.16)),
  );
  // 오른쪽 벽면(밝게)
  c.addChild(
    new Graphics()
      .poly([
        bR[0], bR[1],
        bB[0], bB[1],
        bB[0], bB[1] - wallH,
        bR[0], bR[1] - wallH,
      ])
      .fill(shade(wall, 0.05)),
  );

  // ── 벽 윗면 다이아몬드(지붕 받침, 가장 밝은 벽색) ──
  c.addChild(
    new Graphics()
      .poly([0, -th - wallH, tw, -wallH, 0, th - wallH, -tw, -wallH])
      .fill(shade(wall, 0.16)),
  );

  // ── 입구(앞 모서리 면 위, 둥근 아치 문) ──
  const doorW = 11;
  const doorH = 17;
  const doorBaseY = bB[1] - 2; // 앞 모서리 바닥 살짝 위
  c.addChild(
    new Graphics()
      .roundRect(-doorW / 2, doorBaseY - doorH, doorW, doorH, 5)
      .fill(shade(roof, -0.1)) // 문은 지붕색 계열로 포인트
      .roundRect(-doorW / 2, doorBaseY - doorH, doorW, doorH, 5)
      .stroke({ width: 1, color: shade(wall, -0.3), alpha: 0.4 }),
  );
  // 문 손잡이
  c.addChild(new Graphics().circle(doorW / 2 - 3, doorBaseY - doorH / 2, 1.2).fill(0xffe27a));

  // ── 창문(좌/우 벽면에 작은 둥근 창) ──
  const winY = bB[1] - wallH + 14;
  c.addChild(
    new Graphics()
      // 왼쪽 면 창
      .roundRect(-tw / 2 - 4, winY - 6, 9, 9, 3)
      .fill({ color: 0xbfe6ff, alpha: 0.92 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.7 })
      // 오른쪽 면 창
      .roundRect(tw / 2 - 5, winY - 6, 9, 9, 3)
      .fill({ color: 0xbfe6ff, alpha: 0.92 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.7 }),
  );

  // ── 둥근 지붕(돔 + 처마) ── 벽 윗면 위에 부드럽게 얹음.
  const roofTopY = -th - wallH - 22; // 지붕 꼭대기
  const roofBaseY = -wallH; // 지붕 밑단(벽 윗면 중심 높이)
  const roofW = tw + 6; // 처마가 벽보다 살짝 더 나오게

  // 지붕 본체(둥근 산 모양: 다이아몬드 윗면 위로 솟은 둥근 캡)
  const roofG = new Graphics();
  // 둥근 돔 — 큰 타원 윗부분 + 베이스 다이아몬드로 막음
  roofG
    .ellipse(0, roofBaseY - 6, roofW, 20)
    .fill(roof);
  // 처마 그늘(앞쪽 살짝 어둡게)
  roofG
    .poly([-roofW, roofBaseY - 6, roofW, roofBaseY - 6, 0, roofBaseY + 4])
    .fill({ color: shade(roof, -0.14), alpha: 0.55 });
  // 지붕 하이라이트(왼쪽 위)
  roofG.ellipse(-roofW * 0.35, roofBaseY - 14, roofW * 0.35, 8).fill({
    color: shade(roof, 0.22),
    alpha: 0.5,
  });
  c.addChild(roofG);

  // ── 꼭대기 깃발/뽀글 장식(큐트 포인트) ──
  c.addChild(
    new Graphics()
      .rect(-0.8, roofTopY + 2, 1.6, 10)
      .fill(shade(wall, -0.3))
      .circle(0, roofTopY + 2, 3.2)
      .fill(0xffe27a)
      .circle(-1, roofTopY + 1, 1)
      .fill(0xffffff),
  );

  // ── 굴뚝(운영시설 디테일, 오른쪽 뒤) — 작게 ──
  const chimX = tw * 0.4;
  const chimY = roofBaseY - 14;
  c.addChild(
    new Graphics()
      .roundRect(chimX, chimY - 10, 6, 12, 2)
      .fill(shade(wall, -0.22))
      .ellipse(chimX + 3, chimY - 10, 4, 2)
      .fill({ color: 0xffffff, alpha: 0.85 }),
  );

  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// makeShadow — 발밑 반투명 타원 그림자.
// ─────────────────────────────────────────────────────────────────────────────
export function makeShadow(w: number, h: number): Graphics {
  const g = new Graphics();
  // 바깥 흐린 그림자 + 안쪽 진한 그림자(부드러운 느낌)
  g.ellipse(0, 0, w / 2, h / 2).fill({ color: 0x1a2a3a, alpha: 0.12 });
  g.ellipse(0, 0, (w / 2) * 0.7, (h / 2) * 0.7).fill({ color: 0x1a2a3a, alpha: 0.12 });
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// makeSnowflake — 작은 흰 눈송이(앰비언트용).
// ─────────────────────────────────────────────────────────────────────────────
export function makeSnowflake(): Graphics {
  const g = new Graphics();
  const r = 1.6 + Math.random() * 1.6;
  // 부드러운 글로우 + 또렷한 코어
  g.circle(0, 0, r * 1.8).fill({ color: 0xffffff, alpha: 0.2 });
  g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.95 });
  return g;
}
