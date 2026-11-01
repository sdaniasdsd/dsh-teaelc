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

  // 读时基下拉的实际值 + 画布上的轴标注
  const info = await p.evaluate(() => {
    const sel = document.querySelectorAll('.dc-scope-select')[0]
    const dbg = window.__dshCircuitDebug()
    return {
      timebaseSelectValue: sel ? sel.value : null,
      samples: dbg.sampleCount,
      spanT: dbg.spanT,
      firstT: dbg.firstT,
      lastT: dbg.lastT,
    }
  })
  console.log('时基下拉:', info.timebaseSelectValue)
  console.log('样本:', info.samples, '跨度:', info.spanT, 's')

  // 直接读像素分布，看曲线横向跨度
  const px = await p.evaluate(() => {
    const cv = document.querySelector('canvas.dc-scope')
    const ctx = cv.getContext('2d')
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data
    let x0 = 99999, x1 = -1, colored = 0
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i], g = img[i + 1], bl = img[i + 2]
      if (bl > 150 && g > 90 && r < 140) {
        colored++
        const x = (i / 4) % cv.width
        if (x < x0) x0 = x
        if (x > x1) x1 = x
      }
    }
    return { w: cv.width, colored, x0, x1, pct: (((x1 - x0) / cv.width) * 100).toFixed(1) }
  })
  console.log('曲线像素:', JSON.stringify(px))

  await b.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
