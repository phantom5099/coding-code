// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@codingcode/core", "@codingcode/infra"] })],
    build: {
      lib: {
        entry: resolve("electron/main.ts")
      },
      rollupOptions: {
        external: [/pino.*/, "thread-stream", "on-exit-leak-free", "sonic-boom"]
      }
    },
    resolve: {
      alias: {
        "@shared": resolve("shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve("electron/preload.ts")
      }
    },
    resolve: {
      alias: {
        "@shared": resolve("shared")
      }
    }
  },
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: resolve("index.html")
      }
    },
    resolve: {
      alias: {
        "@renderer": resolve("src"),
        "@shared": resolve("shared")
      }
    },
    plugins: [tailwindcss(), react()]
  }
});
export {
  electron_vite_config_default as default
};
