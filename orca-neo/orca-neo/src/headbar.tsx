// 顶部插件栏的 Neo 菜单：点击图标展开一个浮层，里面包含全部功能选项。
// 用全局 React（window.React）编写——orca-neo 的 vite 配置已把 react/react-dom 设为 external
// 并映射到 window.React / ReactDOM，所以这里直接用全局 React，不引入新依赖。
// 关键：orca 在插件脚本加载时不一定已把 React 挂到 window，因此在渲染入口惰性取值，
// 避免在模块顶层取到 undefined 而崩。
let React: any
let ReactDOM: any
let orca: any
let Valtio: any

function ensureGlobals() {
  if (React) return
  const g = window as unknown as {
    React: any
    ReactDOM: any
    orca: any
    Valtio: any
  }
  React = g.React
  ReactDOM = g.ReactDOM
  orca = g.orca
  Valtio = g.Valtio
}

import { FEATURES, SETTINGS_SCHEMA, buildPaletteChoices, withDefaults } from "./settings"

const PLUGIN_NAME = "orca-neo"

type Settings = Record<string, any>

function readCurrent(): Settings {
  return withDefaults(orca.state.plugins[PLUGIN_NAME]?.settings)
}

function NeoIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2a2.5 2.5 0 0 1 2.5-2.5c1 0 1.9.6 2.3 1.5.2.4.6.6 1 .6H21A9 9 0 0 0 12 3Z" />
      <circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div className="neo-hb-sec">
      <div className="neo-hb-sec-title">{title}</div>
      {children}
    </div>
  )
}

function Row({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <div
      className={"neo-hb-row" + (active ? " is-active" : "")}
      onClick={onClick}
    >
      <span className="neo-hb-check">{active ? "✓" : ""}</span>
      <span className="neo-hb-label">{label}</span>
    </div>
  )
}

function NeoMenu() {
  const [open, setOpen] = React.useState(false)
  const [settings, setSettings] = React.useState<Settings>(() => readCurrent())
  const btnRef = React.useRef<HTMLElement | null>(null)
  const popRef = React.useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = React.useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  })

  // 订阅插件设置变更（例如用户在设置面板改动、或“跟随时间”自动切换），同步刷新勾选态
  React.useEffect(() => {
    const st = orca.state.plugins[PLUGIN_NAME]
    if (!st) return
    return Valtio.subscribe(st, () => setSettings(readCurrent()))
  }, [])

  // 点击浮层外部关闭
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  function update(patch: Settings) {
    const next = { ...readCurrent(), ...patch }
    setSettings(next)
    void orca.plugins.setSettings(null, PLUGIN_NAME, next)
  }

  function toggle(key: string) {
    update({ [key]: !settings[key] })
  }

  function openMenu() {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = 286
    const left = Math.max(8, r.right - width)
    setCoords({ top: r.bottom + 6, left })
    setOpen((o) => !o)
  }

  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
  const paletteChoices = buildPaletteChoices(dark)
  const textureChoices = SETTINGS_SCHEMA.texture.choices ?? []

  return (
    <>
      <button
        ref={btnRef as any}
        className="neo-hb-btn"
        onClick={openMenu}
        title="Neo 主题设置"
        aria-label="Neo 主题设置"
      >
        <NeoIcon />
      </button>
      {open &&
        ReactDOM.createPortal(
          <div
            ref={popRef as any}
            className="neo-hb-pop"
            style={{ top: coords.top, left: coords.left }}
          >
            <div className="neo-hb-head">
              <span>Neo 主题</span>
              <span className="neo-hb-close" onClick={() => setOpen(false)}>
                ✕
              </span>
            </div>

            <Section title="配色方案">
              {paletteChoices.map((c: any) => (
                <Row
                  key={c.value}
                  label={c.label}
                  active={settings.palette === c.value}
                  onClick={() => update({ palette: c.value })}
                />
              ))}
            </Section>

            <Section title="主题微调">
              <label className="neo-hb-field">
                <span>自定义主题色</span>
                <input
                  type="color"
                  value={settings.customColor}
                  onChange={(e: any) => update({ customColor: e.target.value })}
                />
              </label>
              <label className="neo-hb-field">
                <span>饱和度 {Number(settings.saturation).toFixed(2)}</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={settings.saturation}
                  onChange={(e: any) =>
                    update({ saturation: Number(e.target.value) })
                  }
                />
              </label>
              <Row
                label="暗色反转"
                active={!!settings.invertDark}
                onClick={() => toggle("invertDark")}
              />
            </Section>

            <Section title="纹理">
              {textureChoices.map((c: any) => (
                <Row
                  key={c.value}
                  label={c.label}
                  active={settings.texture === c.value}
                  onClick={() => update({ texture: c.value })}
                />
              ))}
              <label className="neo-hb-field">
                <span>纹理强度 {Number(settings.textureOpacity).toFixed(2)}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.textureOpacity}
                  onChange={(e: any) =>
                    update({ textureOpacity: Number(e.target.value) })
                  }
                />
              </label>
            </Section>

            <Section title="功能开关">
              {FEATURES.map((f) => (
                <Row
                  key={f.key}
                  label={f.label}
                  active={!!settings[f.key]}
                  onClick={() => toggle(f.key)}
                />
              ))}
            </Section>

            <Section title="背景">
              <label className="neo-hb-field col">
                <span>自定义背景图 URL</span>
                <input
                  type="text"
                  placeholder="file:// 或 https://"
                  value={settings.backgroundImage}
                  onChange={(e: any) =>
                    update({ backgroundImage: e.target.value })
                  }
                />
              </label>
              <label className="neo-hb-field">
                <span>蒙版浓度 {Number(settings.backgroundVeil).toFixed(2)}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={settings.backgroundVeil}
                  onChange={(e: any) =>
                    update({ backgroundVeil: Number(e.target.value) })
                  }
                />
              </label>
            </Section>
          </div>,
          document.body,
        )}
    </>
  )
}

/** 供 main.ts 注册到顶部栏：返回一个 React 元素（函数组件需经 createElement 包一层，
 *  这样 orca 挂载时才会正确建立 hooks 上下文）。 */
export function renderNeoHeadbar(): any {
  ensureGlobals()
  return React.createElement(NeoMenu)
}
