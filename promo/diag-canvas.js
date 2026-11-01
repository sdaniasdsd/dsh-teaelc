/**
 * 诊断：通道建立了，但波形区为什么空？
 * 检查 samples 是否有数据、drawScope 是否被调用、canvas 是否被绘制。
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
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
  await p.goto(BASE, { waitUntil: 'load' })
  await p.waitForFunction(
    () => {
      const f = document.getElementById('simframe')
      return f && f.contentWindow && f.contentWindow.CircuitJS1
    },
    { timeout: 30000 }
  )
  await p.waitForTimeout(1200)

  await p.evaluate((net) => {
    document.getElementById('simframe').contentWindow.CircuitJS1.importCircuit(net, false)
  }, NET)
  await p.waitForTimeout(1500)

  await p.locator('.dc-btn', { hasText: '电压通道' }).first().click()
  await p.waitForTimeout(3000)

  const d = await p.evaluate(() => window.__dshCircuitDebug())
  console.log('DEBUG:', JSON.stringify(d))

  // 检查 canvas 是否真被画了
  const canvasInfo = await p.evaluate(() => {
    const cv = document.querySelector('canvas.dc-scope')
    if (!cv) return { error: 'no canvas' }
    const ctx = cv.getContext('2d')
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data
    let painted = 0
    let colored = 0
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i]
      const g = img[i + 1]
      const bl = img[i + 2]
      if (r > 25 || g > 25 || bl > 35) painted++
      // 蓝色通道曲线 (#4ea1ff)
      if (bl > 150 && g > 90 && r < 140) colored++
    }
    return {
      w: cv.width,
      h: cv.height,
      cssW: cv.clientWidth,
      cssH: cv.clientHeight,
      painted,
      colored,
    }
  })
  console.log('CANVAS:', JSON.stringify(canvasInfo))

  // 检查 samples 实际内容
  const sampleDetail = await p.evaluate(() => {
    // 无法直接访问内部 state，用 debug 接口
    const d = window.__dshCircuitDebug()
    return d
  })
  console.log('SAMPLES:', JSON.stringify(sampleDetail))

  await b.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
