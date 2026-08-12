import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import { transform } from "esbuild"
import { defineConfig, type Plugin } from "vite"

const root = import.meta.dirname

/** 压缩单个 CSS 文件（无损：仅去除注释与多余空白）。
 *  用 vite 已自带的 esbuild，不引入额外依赖；失败则回退为原样复制，
 *  保证构建永不因压缩而中断。 */
async function minifyCss(content: string): Promise<string> {
  try {
    const r = await transform(content, { loader: "css", minify: true })
    return r.code
  } catch {
    return content
  }
}

/** 把 src/styles/*.css 压缩后复制到 dist —— Orca 主题按文件名加载，不能被打包进 JS。
 *  同时把 src/assets（若存在）整目录复制到 dist/assets。 */
function copyStyles(): Plugin {
  return {
    name: "orca-neo-copy-styles",
    async closeBundle() {
      const to = resolve(root, "dist")
      mkdirSync(to, { recursive: true })

      // 1) 样式文件（压缩后写入，无损）
      const stylesFrom = resolve(root, "src/styles")
      for (const f of readdirSync(stylesFrom)) {
        if (!f.endsWith(".css")) continue
        const src = resolve(stylesFrom, f)
        const out = await minifyCss(readFileSync(src, "utf8"))
        writeFileSync(resolve(to, f), out)
      }

      // 2) 素材目录（递归；不存在则跳过，避免误删后构建报错）
      const assetsFrom = resolve(root, "src/assets")
      copyDir(assetsFrom, resolve(to, "assets"))
    },
  }
}

/** 递归复制目录（不存在则跳过） */
function copyDir(from: string, to: string) {
  if (!existsSync(from)) return
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const src = resolve(from, name)
    const dst = resolve(to, name)
    if (statSync(src).isDirectory()) copyDir(src, dst)
    else copyFileSync(src, dst)
  }
}

export default defineConfig({
  plugins: [copyStyles()],
  build: {
    target: "esnext",
    minify: true,
    emptyOutDir: true,
    // 用全局 React（window.React）编译 JSX，而不是去 node_modules 解析 react
    esbuild: {
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
    },
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
