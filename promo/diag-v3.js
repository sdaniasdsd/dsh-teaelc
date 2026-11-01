/**
 * 诊断：1) 通道点击是否生效 2) 能否用 API 缩放电路图填满画布
 */
const { chromium } = require('playwright')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:50986/dsh-circuit/'

const NET_AC = [
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

  await p.evaluate((n) => {
    document.getElementById('simframe').contentWindow.CircuitJS1.importCircuit(n, false)
  }, NET_AC)
  await p.waitForTimeout(1400)

  // --- 1) 检查通道按钮点击 ---
  const btns = await p.evaluate(() =>
    [...document.querySelectorAll('.dc-btn')].map((x) => ({
      t: x.textContent.trim(),
      x: x.getBoundingClientRect().x,
      y: x.getBoundingClientRect().y,
      w: x.getBoundingClientRect().width,
      h: x.getBoundingClientRect().height,
      vis: x.offsetParent !== null,
    }))
  )
  console.log('按钮清单:')
  btns.forEach((x) => console.log(`  "${x.t}" at (${Math.round(x.x)},${Math.round(x.y)}) ${Math.round(x.w)}x${Math.round(x.h)} vis=${x.vis}`))

  const vb = p.locator('.dc-btn', { hasText: '电压通道' }).first()
  const bb = await vb.boundingBox()
  console.log('电压通道 boundingBox:', JSON.stringify(bb))

  // 用真实鼠标点击
  if (bb) {
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 })
    await p.waitForTimeout(300)
    await p.mouse.down()
    await p.waitForTimeout(80)
    await p.mouse.up()
    await p.waitForTimeout(1500)
  }
  const after = await p.evaluate(() => window.__dshCircuitDebug())
  console.log('点击后通道数:', after.channels.length, '样本:', after.sampleCount)

  // --- 2) 测试电路图缩放能力 ---
  const zoomTest = await p.evaluate(() => {
    const w = document.getElementById('simframe').contentWindow
    const api = w.CircuitJS1
    const results = {}
    // 看 CircuitJS1 上有没有 zoom 相关
    results.apiKeys = Object.keys(api)
    // 尝试用内核的键盘缩放
    const doc = w.document
    const cv = [...doc.querySelectorAll('canvas')].sort((a, b) => b.width - a.width)[0]
    results.canvasSize = { w: cv.width, h: cv.height }
    // 检查是否有 zoom 菜单
    const items = [...doc.querySelectorAll('.menuItem')].filter((x) => /Zoom/.test(x.textContent))
    results.zoomMenuItems = items.map((x) => x.textContent.trim())
    return results
  })
  console.log('缩放测试:', JSON.stringify(zoomTest, null, 2))

  await b.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
