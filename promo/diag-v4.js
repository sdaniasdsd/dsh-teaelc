/**
 * 精确诊断：为什么加通道后示波器还是空的。
 * 逐步打印状态。
 */
const { chromium } = require('playwright')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:50986/dsh-circuit/'

const NET = [
  '$ 1 5.0E-6 10 50 5.0 50',
  'v 200 150 200 350 0 2 60 120 0 0 0.5',
  'r 200 150 380 150 0 1000.0',
  'c 380 150 380 350 0 0.0001 0',
  'w 200 350 380 350 0',
  'g 380 350 380 380 0',
  'O 200 150 130 150 0',
  'O 380 150 450 150 0',
].join('\n')

;(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true })
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
  await p.goto(BASE, { waitUntil: 'load' })
  await p.waitForFunction(
    () => {
      const f = document.getElementById('simframe')
      return f && f.contentWindow && f.contentWindow.CircuitJS1
    },
    { timeout: 30000 }
  )
  await p.waitForTimeout(1200)

  console.log('=== 步骤1: 载入电路 ===')
  await p.evaluate((n) => {
    document.getElementById('simframe').contentWindow.CircuitJS1.importCircuit(n, false)
  }, NET)
  await p.waitForTimeout(1600)

  // 检查探头是否存在
  const els = await p.evaluate(() => {
    const w = document.getElementById('simframe').contentWindow
    const list = w.CircuitJS1.getElements()
    return {
      n: list.length,
      types: list.map((e) => e.getType()),
      probes: list.filter((e) => e.getType() === 'ProbeElm' || e.getType() === 'OutputElm').length,
    }
  })
  console.log('电路:', JSON.stringify(els))

  console.log('=== 步骤2: 调整窗口布局 ===')
  await p.evaluate(() => {
    const set = (id, x, y, w, h) => {
      const el = document.getElementById(id)
      if (!el) return
      el.style.left = x + 'px'
      el.style.top = y + 'px'
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      el.style.display = ''
    }
    set('dc-win-parts', 8, 8, 292, 470)
    set('dc-win-measure', 8, 484, 292, 588)
    set('dc-win-scope', 308, 8, 700, 520)
    set('dc-win-presets', 308, 534, 700, 538)
  })
  await p.waitForTimeout(700)

  console.log('=== 步骤3: 记录通道按钮位置 ===')
  const pos = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('.dc-btn')]
    return btns.map((x) => {
      const r = x.getBoundingClientRect()
      return { t: x.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height, vis: x.offsetParent !== null }
    })
  })
  pos.filter((x) => x.t.includes('通道')).forEach((x) => console.log(' ', JSON.stringify(x)))

  console.log('=== 步骤4: 点击电压通道 ===')
  const vBtn = p.locator('.dc-btn', { hasText: '电压通道' }).first()
  const vb = await vBtn.boundingBox()
  console.log('boundingBox:', JSON.stringify(vb))
  if (vb) {
    await p.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2, { steps: 12 })
    await p.waitForTimeout(250)
    await p.mouse.down()
    await p.waitForTimeout(90)
    await p.mouse.up()
  }
  await p.waitForTimeout(1000)

  const after = await p.evaluate(() => window.__dshCircuitDebug())
  console.log('通道:', after.channels.length, '样本:', after.sampleCount)

  // 检查画布像素
  const px = await p.evaluate(() => {
    const cv = document.querySelector('canvas.dc-scope')
    if (!cv) return { err: 'no canvas' }
    const ctx = cv.getContext('2d')
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data
    let blue = 0, x0 = 99999, x1 = -1
    for (let i = 0; i < img.length; i += 4) {
      if (img[i + 2] > 150 && img[i + 1] > 90 && img[i] < 140) {
        blue++
        const x = (i / 4) % cv.width
        if (x < x0) x0 = x
        if (x > x1) x1 = x
      }
    }
    return { w: cv.width, h: cv.height, blue, x0, x1 }
  })
  console.log('波形画布:', JSON.stringify(px))

  await b.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
