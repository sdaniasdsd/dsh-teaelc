/**
 * 诊断：为什么录屏里示波器没有波形。
 * 直接驱动页面点「电压通道」，检查 state.channels 是否真的增加了。
 */
const { chromium } = require('playwright')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:50986/dsh-circuit/'

;(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(BASE, { waitUntil: 'load' })

  await page.waitForFunction(
    () => {
      const f = document.getElementById('simframe')
      return f && f.contentWindow && f.contentWindow.CircuitJS1
    },
    { timeout: 30000 }
  )
  await page.waitForTimeout(1200)

  // 载入一个简单的交流电路
  await page.evaluate(() => {
    const f = document.getElementById('simframe')
    f.contentWindow.CircuitJS1.importCircuit(
      '$ 1 5.0E-6 10 50 5.0 50\n' +
        'v 200 150 200 350 0 2 60 120 0 0 0.5\n' +
        'r 200 150 380 150 0 1000.0\n' +
        'c 380 150 380 350 0 0.0001 0\n' +
        'w 200 350 380 350 0\n' +
        'g 380 350 380 380 0\n',
      false
    )
  })
  await page.waitForTimeout(1500)

  const before = await page.evaluate(() => {
    const w = window
    return w.__dshCircuitDebug ? w.__dshCircuitDebug() : null
  })
  console.log('点按钮前:', JSON.stringify(before))

  // 找「电压通道」按钮并点击
  const btnInfo = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.dc-btn')]
    return btns.map((b) => b.textContent.trim())
  })
  console.log('所有按钮:', btnInfo.join(' | '))

  const vBtn = page.locator('.dc-btn', { hasText: '电压通道' }).first()
  const exists = (await vBtn.count()) > 0
  console.log('电压通道按钮存在:', exists)
  if (exists) {
    await vBtn.click()
    await page.waitForTimeout(500)
  }

  const after = await page.evaluate(() => {
    const w = window
    return w.__dshCircuitDebug ? w.__dshCircuitDebug() : null
  })
  console.log('点按钮后:', JSON.stringify(after))

  // 检查探头数量
  const probes = await page.evaluate(() => {
    const f = document.getElementById('simframe')
    const els = f.contentWindow.CircuitJS1.getElements()
    return {
      total: els.length,
      types: els.map((e) => e.getType()),
      probeCount: els.filter(
        (e) => e.getType() === 'ProbeElm' || e.getType() === 'OutputElm'
      ).length,
    }
  })
  console.log('元件:', JSON.stringify(probes))

  // 检查提示文字
  const hint = await page.evaluate(() => {
    const el = document.querySelector('.dc-probe-empty') || document.querySelector('.dc-probe-hint')
    return el ? el.textContent.trim() : null
  })
  console.log('提示:', hint)

  await browser.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
