import { copyFileSync, mkdirSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig, type Plugin } from "vite"

const root = import.meta.dirname

/** 把 src/styles/*.css 原样复制到 dist —— Orca 主题按文件名加载，不能被打包进 JS */
function copyStyles(): Plugin {
  return {
    name: "orca-neo-copy-styles",
    closeBundle() {
      const from = resolve(root, "src/styles")
      const to = resolve(root, "dist")
      mkdirSync(to, { recursive: true })
      for (const f of readdirSync(from)) {
        if (f.endsWith(".css")) copyFileSync(resolve(from, f), resolve(to, f))
      }
    },
  }
}

export default defineConfig({
  plugins: [copyStyles()],
  build: {
    target: "esnext",
    minify: false,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/main.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      // Orca 在运行时提供这些全局对象，不要打进产物
      external: ["react", "react-dom", "valtio"],
      output: {
        globals: { react: "React", "react-dom": "ReactDOM", valtio: "Valtio" },
      },
    },
  },
})
