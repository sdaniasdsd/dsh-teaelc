/**
 * 真实录制电路小实验的 UI 操作（修正版）。
 *
 * 修正：v1 的电路里没有示波器探头，导致「电压通道」按钮被正确拒绝——
 * 这正是面板的设计（没探头就没有电位差可测）。录制必须先把探头放进电路。
 */
const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:50986/dsh-circuit/'
const OUT = path.resolve(__dirname, 'capture2')
const W = 1600
const H = 1000

fs.mkdirSync(OUT, { recursive: true })

async function waitKernel(page) {
  await page.waitForFunction(
    () => {
      const f = document.getElementById('simframe')
      return f && f.contentWindow && f.contentWindow.CircuitJS1
    },
    { timeout: 30000 }
  )
  await page.waitForTimeout(1200)
}

async function clearCircuit(page) {
  await page.evaluate(() => {
    const f = document.getElementById('simframe')
    const doc = f.contentDocument
    const menu = [...doc.querySelectorAll('.gwt-MenuItem')].find(
      (x) => x.textContent.trim().startsWith('文件') || x.textContent.trim().startsWith('File')
    )
    if (!menu) return
    menu.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    setTimeout(() => {
      const blank = [...doc.querySelectorAll('.menuItem')].find((x) =>
        /New Blank Circuit|新建空白/.test(x.textContent || '')
      )
      if (blank) blank.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, 150)
  })
  await page.waitForTimeout(500)
}

/** 载入电路（含探头），并等待内核稳定 */
async function loadCircuit(page, netlist) {
  await page.evaluate((net) => {
    document.getElementById('simframe').contentWindow.CircuitJS1.importCircuit(net, false)
  }, netlist)
  await page.waitForTimeout(1500)
}

/** 用面板按钮 + 画布拖拽放置元件（真实操作，用于录制"拖放"镜头） */
async function placePart(page, label, x, y, dx = 70, dy = 0) {
  const btn = page.locator('.dc-part-btn', { hasText: label }).first()
  await btn.click()
  await page.waitForTimeout(280)
  await page.evaluate(
    ({ x, y, dx, dy }) => {
      const f = document.getElementById('simframe')
      const cv = [...f.contentDocument.querySelectorAll('canvas')].sort((a, b) => b.width - a.width)[0]
      const r = cv.getBoundingClientRect()
      const fire = (t, cx, cy) =>
        cv.dispatchEvent(
          new MouseEvent(t, {
            bubbles: true,
            clientX: r.left + cx,
            clientY: r.top + cy,
            button: 0,
          })
        )
      fire('mousedown', x, y)
      fire('mousemove', x + dx / 2, y + dy / 2)
      fire('mousemove', x + dx, y + dy)
      fire('mouseup', x + dx, y + dy)
    },
    { x, y, dx, dy }
  )
  await page.waitForTimeout(500)
}

// 带探头的测试电路（探头放在电阻两端，可测电位差与电流）
const NET_AC = [
  '$ 1 5.0E-6 10 50 5.0 50',
  'v 200 150 200 350 0 2 60 120 0 0 0.5',
  'r 200 150 380 150 0 1000.0',
  'c 380 150 380 350 0 0.0001 0',
  'w 200 350 380 350 0',
  'g 380 350 380 380 0',
  // 探头 1：电阻左端（= 电源正极电位）
  'O 200 150 130 150 0',
  // 探头 2：电阻右端（= 电容上端）
  'O 380 150 450 150 0',
].join('\n')

const NET_DC = [
  '$ 1 5.0E-6 10 50 5.0 50',
  'v 200 150 200 350 0 0 40.0 10.0 0.0 0.0 0.5',
  'r 200 150 380 150 0 1000.0',
  'r 380 150 380 350 0 500.0',
  'w 200 350 380 350 0',
  'g 380 350 380 380 0',
  'O 200 150 130 150 0',
  'O 380 150 450 150 0',
].join('\n')

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  })

  const scenes = []

  async function record(name, fn, holdMs = 1300) {
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'load' })
    await waitKernel(page)
    await clearCircuit(page)
    try {
      await fn(page)
    } catch (e) {
      console.log(`[${name}] 场景异常:`, e.message)
    }
    await page.waitForTimeout(holdMs)
    const video = page.video()
    await page.close()
    if (video) {
      const p = await video.path()
      scenes.push({ name, path: p })
      console.log(`[${name}] OK`)
    }
  }

  // ---- 00：真实拖放搭电路（含探头） ----
  await record('00-place', async (page) => {
    await placePart(page, '直流电源', 200, 180, 0, 150)
    await page.waitForTimeout(500)
    await placePart(page, '电阻', 200, 180, 220, 0)
    await page.waitForTimeout(500)
    await placePart(page, '示波器探头', 210, 150, -80, 0)
    await page.waitForTimeout(500)
    await placePart(page, '接地', 300, 600, 0, 0)
    await page.waitForTimeout(1000)
  })

  // ---- 01：实时读数（10V 分压电路） ----
  await record('01-readout', async (page) => {
    await loadCircuit(page, NET_DC)
    await page.waitForTimeout(1400)
    await page.waitForTimeout(1200)
  })

  // ---- 02/03：示波器通道（电压 + 电流 + 电位差） ----
  await record('02-wave', async (page) => {
    await loadCircuit(page, NET_AC)
    await page.waitForTimeout(900)
    // 电压通道
    await page.locator('.dc-btn', { hasText: '电压通道' }).first().click()
    await page.waitForTimeout(2600)
    // 电流通道
    await page.locator('.dc-btn', { hasText: '电流通道' }).first().click()
    await page.waitForTimeout(2400)
  })

  // ---- 05：经典电路 ----
  await record('05-presets', async (page) => {
    await page.locator('.dc-preset-btn', { hasText: '欧姆定律' }).first().click()
    await page.waitForTimeout(2400)
    await page.locator('.dc-preset-btn', { hasText: 'LRC 串联谐振' }).first().click()
    await page.waitForTimeout(2400)
  })

  // ---- 07：框选放大 ----
  await record('07-zoombox', async (page) => {
    await loadCircuit(page, NET_AC)
    await page.waitForTimeout(900)
    await page.locator('.dc-btn', { hasText: '电压通道' }).first().click()
    await page.waitForTimeout(2800)
    await page.evaluate(() => {
      const cv = document.querySelector('canvas.dc-scope')
      if (!cv) return
      const r = cv.getBoundingClientRect()
      const fire = (t, cx, cy) =>
        cv.dispatchEvent(
          new MouseEvent(t, {
            bubbles: true,
            clientX: r.left + cx,
            clientY: r.top + cy,
            button: 0,
          })
        )
      fire('mousedown', r.width * 0.3, r.height * 0.3)
      fire('mousemove', r.width * 0.5, r.height * 0.5)
      fire('mousemove', r.width * 0.72, r.height * 0.68)
      fire('mouseup', r.width * 0.72, r.height * 0.68)
    })
    await page.waitForTimeout(1600)
  })

  // ---- 实测：完整真实操作 ----
  await record(
    'live',
    async (page) => {
      await page.locator('.dc-preset-btn', { hasText: '欧姆定律' }).first().click()
      await page.waitForTimeout(2000)
      await page.locator('.dc-btn', { hasText: '电压通道' }).first().click()
      await page.waitForTimeout(2800)
    },
    2200
  )

  await ctx.close()
  await browser.close()

  fs.writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify(scenes, null, 2))
  console.log('完成:', scenes.length, '个场景')
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
