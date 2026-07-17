import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rendererPort = Number(process.env.HERMES_DESKTOP_RENDERER_PORT || 0);
// Default: stable sessions (no HMR / no file watch). Sleep/resume and idle FS
// thrash must not remount the UI. Opt into hot reload with HERMES_DEV_HMR=1
// (see npm run dev:hmr).
const preferStableDev = process.env.HERMES_DEV_HMR !== "1";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          askpass: resolve("src/preload/askpass.ts"),
        },
      },
    },
  },
  renderer: {
    server: {
      ...(rendererPort > 0
        ? {
            port: rendererPort,
            strictPort: false,
          }
        : {}),
      ...(preferStableDev
        ? {
            hmr: false,
            // null disables chokidar — prevents Windows sleep/resume mtime
            // storms from triggering a full renderer reload mid-session.
            watch: null,
          }
        : {
            watch: {
              awaitWriteFinish: {
                stabilityThreshold: 400,
                pollInterval: 100,
              },
            },
          }),
    },
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
      // Ensure a single Three.js instance across our code, @react-three/fiber,
      // drei and troika — multiple copies break `instanceof THREE.*` checks in
      // the ported office agent renderer.
      dedupe: ["three"],
    },
    plugins: [tailwindcss(), react()],
  },
});
