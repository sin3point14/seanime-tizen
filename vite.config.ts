import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "")
  const diagnostics = env.VITE_DIAGNOSTICS === "true"
  return {
    base: "./",
    plugins: [
      react(),
      { name: "diagnostic-runtime-flag", transformIndexHtml: html => html.replace("__SEANIME_DIAGNOSTICS_ENABLED__", diagnostics ? "true" : "false") },
    ],
    worker: { format: "es" as const },
    define: {
      __DIAGNOSTICS__: JSON.stringify(diagnostics),
      __DIAGNOSTIC_ENDPOINT__: JSON.stringify(diagnostics ? env.VITE_DIAGNOSTIC_ENDPOINT || "" : ""),
      __DIAGNOSTIC_AUTOPLAY__: JSON.stringify(diagnostics ? env.VITE_DIAGNOSTIC_AUTOPLAY || "" : ""),
    },
    build: { target: "es2017", outDir: "dist", emptyOutDir: true },
  }
})
