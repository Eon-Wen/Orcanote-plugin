// 庆典彩带 —— 复刻 task-confetti 插件的 createFireworks 效果（零依赖，无需 canvas-confetti）。
//
// 行为：从屏幕左右两侧（origin x=0 / x=1，y=0.45）各发射一串彩带纸屑，持续约 500ms，
// 与虎鲸官方「任务完成」插件的视觉效果一致。z-index 9999，pointer-events:none，不会挡操作。
//
// 触发方：src/wordCount.ts 在写作进度圆环达到紫色（完成度 ≥ 100%）且设置里
// 「庆祝动画」开关开启时调用 fireworks()。
//
// 性能（2026-08-15 优化，用户反馈动画播放时页面微卡）：
//  - 画布分辨率 = CSS 像素（不乘 devicePixelRatio）：Retina 下后备缓冲面积减为
//    1/dpr²，clear/fill 与全屏合成开销同比例下降；彩带是小色块，无需高分屏精度。
//  - 动画结束后把 canvas 从 DOM 移除（旧实现常驻一张全屏 z-index 9999 层），
//    下一次庆祝时再重建。
//  - 纸屑数量减半（每帧每侧 3→2 个）+ 同屏总数上限 120，帧内绘制调用显著减少。
//  - 用 setTransform 替代 save/translate/rotate/restore，省掉状态栈存取。

const COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#FFE66D",
  "#95E1D3",
  "#F38181",
  "#AA96DA",
]

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
  tilt: number
  tiltAngle: number
  spin: number
  life: number
}

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let raf = 0
let onResize: (() => void) | null = null

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx && canvas) return ctx
  canvas = document.createElement("canvas")
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;"
  document.body.appendChild(canvas)
  ctx = canvas.getContext("2d")
  resize()
  onResize = resize
  window.addEventListener("resize", onResize)
  return ctx
}

function resize(): void {
  if (!canvas) return
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

/** 移除 canvas 并解绑监听（动画结束 / 重新出发时收敛资源） */
function teardown(): void {
  if (onResize) {
    window.removeEventListener("resize", onResize)
    onResize = null
  }
  canvas?.remove()
  canvas = null
  ctx = null
  raf = 0
}

/** 从某侧炮口发射一束纸屑（角度 + 散射，对应 canvas-confetti 的同名参数） */
function spawn(
  pieces: Piece[],
  originX: number,
  baseAngle: number,
  spread: number,
): void {
  const W = window.innerWidth
  const H = window.innerHeight
  const ox = originX * W
  const oy = 0.45 * H
  const count = 2
  for (let i = 0; i < count; i++) {
    const angle =
      ((baseAngle + (Math.random() * 2 - 1) * spread) * Math.PI) / 180
    const speed = 7 + Math.random() * 5
    pieces.push({
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      size: 6 + Math.random() * 4,
      tilt: Math.random() * Math.PI,
      tiltAngle: 0,
      spin: (Math.random() * 2 - 1) * 0.2,
      life: 1,
    })
  }
}

function frame(pieces: Piece[]): void {
  const c = ctx
  if (c == null || canvas == null) return
  c.clearRect(0, 0, canvas.width, canvas.height)
  const gravity = 0.18
  for (const p of pieces) {
    p.vy += gravity
    p.x += p.vx
    p.y += p.vy
    p.tiltAngle += p.spin
    p.tilt += p.tiltAngle
    p.life -= 0.012

    // 一次 setTransform 完成旋转 + 平移（省 save/restore 状态栈开销）
    const cos = Math.cos(p.tilt)
    const sin = Math.sin(p.tilt)
    c.setTransform(cos, sin, -sin, cos, p.x, p.y)
    c.globalAlpha = Math.max(0, p.life)
    c.fillStyle = p.color
    c.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66)
  }
  // 移除已淡出或掉出屏幕的纸屑
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]
    if (p.life <= 0 || p.y > window.innerHeight + 40) pieces.splice(i, 1)
  }

  if (pieces.length > 0) {
    raf = requestAnimationFrame(() => frame(pieces))
  } else {
    c.clearRect(0, 0, canvas.width, canvas.height)
    teardown()
  }
}

/** 触发一次「任务完成」式全屏彩带庆祝 */
export function fireworks(): void {
  const c = ensureCanvas()
  if (c == null) return
  if (raf) cancelAnimationFrame(raf)

  const pieces: Piece[] = []
  const duration = 500
  const end = Date.now() + duration

  const tick = (): void => {
    // 左右两侧各发射一束（与 task-confetti 的 createFireworks 一致）；
    // 同屏纸屑设上限，避免堆积拖慢绘制
    if (pieces.length < 120) {
      spawn(pieces, 0, 60, 55)
      spawn(pieces, 1, 120, 55)
    }
    if (Date.now() < end) requestAnimationFrame(tick)
  }
  tick()

  raf = requestAnimationFrame(() => frame(pieces))
}
