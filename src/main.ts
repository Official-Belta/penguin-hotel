// 남극 그랜드 호텔 — 부팅 + 메인 루프(통합 배선).
// 책임 분리: GameApp(허브·코어 소유) ← WorldRenderer(Pixi 월드) · GameUI(HTML/CSS 크롬) 가 참조.
import { Application } from "pixi.js";
import { GameApp } from "./game/gameApp";
import { WorldRenderer } from "./render/worldRenderer";
import { GameUI } from "./ui/gameUI";

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    antialias: true,
    background: 0x0b1f3a,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  const host = document.getElementById("game-canvas");
  if (host) host.appendChild(app.canvas);

  const game = new GameApp();
  const world = new WorldRenderer(app, game);

  const uiRoot = document.getElementById("ui-root");
  const ui = uiRoot ? new GameUI(uiRoot, game) : null;

  // 루프: 실시간 dt(초)로 코어 전진 → 월드 동기 → UI는 100ms 스로틀.
  let uiAccum = 0;
  app.ticker.add((ticker) => {
    const dtMS = ticker.deltaMS;
    game.update(dtMS / 1000);
    world.update(dtMS);
    uiAccum += dtMS;
    if (ui && uiAccum >= 100) {
      ui.update();
      uiAccum = 0;
    }
  });

  // 디버그 핸들.
  (window as unknown as { game: GameApp }).game = game;
}

boot();
