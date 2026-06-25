import { defineConfig } from "vite";

// 남극 그랜드 호텔 — web. base 는 Capacitor/정적 호스팅에서 상대경로로 동작하도록 './'.
export default defineConfig({
  base: "./",
  server: { port: 5180, host: true },
  build: { target: "es2022", outDir: "dist" },
});
