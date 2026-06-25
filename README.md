# 남극 그랜드 호텔 — web

펭귄 호텔 경영 게임의 웹 구현 (Vite + TypeScript + PixiJS v8, 2.5D 아이소메트릭).

- 설계 진실원: 상위 폴더의 `GAME_DESIGN.md` · `CORE_LOOP.md` · `CONTENT.md` · `ARCHITECTURE.md`
- 로직 진실원: 상위 `PenguinHotel/Assets/Scripts/Core/` (검증된 C# 코어) → `web/src/core/` 로 1:1 TS 포팅
- 검증: `npm test` (C# 헤드리스 하니스 30체크를 vitest로 재현)

## 구조

```
src/
  core/        엔진무관 게임 로직 (C# 코어의 TS 포팅)
    models/    Enums·Need·Guest·Building·Staff
    config/    MvpConfig
    contracts/ IClock·IRandom·IGameSystem
    content/   Catalog
    systems/   13 시스템
    gameState.ts · hotelManager.ts
  render/      PixiJS 아이소 월드 렌더
  ui/          HTML/CSS HUD·빌드패널·컨텍스트패널 (Hay Day 룩)
  game/        부팅·입력·루프 배선
  sim/         vitest 포트 (코어 검증)
```

## 명령

```
npm install
npm run dev        # 개발 서버 (http://localhost:5180)
npm run typecheck  # 타입 검사
npm test           # 코어 검증 (vitest)
npm run build      # 프로덕션 빌드 → dist/
```
