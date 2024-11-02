import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import commonjs from "vite-plugin-commonjs";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte({
      configFile: "svelte.config.js",
    }),
    commonjs(),
  ],
});
