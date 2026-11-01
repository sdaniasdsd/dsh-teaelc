/**
 * 真实录制电路小实验的 UI 操作。
 *
 * 模板硬性要求：产品宣传片必须录制真实产品操作，不能画假界面。
 * 这里用 Playwright 驱动真实页面，把每个分镜需要的关键操作录成视频。
 *
 * 每个镜头都是独立录制，这样剪辑时可以精确对齐分镜表的时间点。
 */
const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:50986/dsh-circuit/'
const OUT = path.resolve(__dirname, 'capture')
const W = 1600
const H = 1000

fs.mkdirSync(OUT, { recursive: true })

/** 等待内核就绪 */
async function waitKernel(page) {
  await page.waitForFunction(() => {
    const f = document.getElementById('simframe')
    return f && f.contentWindow && f.contentWindow.CircuitJS1
  }, { timeout: 30000 })
  await page.waitForTimeout(1200)
}

/** 清空画布 */
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

/** 放置元件：点面板按钮，再在内核画布上拖 */
async function placePart(page, label, x, y, dx = 70) {
  const btn = page.locator('.dc-part-btn', { hasText: label }).first()
  await btn.click()
  await page.waitForTimeout(250)
  await page.evaluate(
    ({ x, y, dx }) => {
      const f = document.getElementById('simframe')
      const cv = [...f.contentDocument.querySelectorAll('canvas')].sort(
        (a, b) => b.width - a.width
      )[0]
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
      fire('mousemove', x + dx / 2, y)
      fire('mousemove', x + dx, y)
      fire('mouseup', x + dx, y)
    },
    { x, y, dx }
  )
  await page.waitForTimeout(450)
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  })

  const scenes = []

  async function record(name, fn, holdMs = 1200) {
    const page = await ctx.newPage()
    const vidDir = path.join(OUT, name)
    fs.mkdirSync(vidDir, { recursive: true })
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
      console.log(`[${name}] 录制完成 -> ${path.basename(p)}`)
    }
  }

  // ---- 00：拖放搭电路 ----
  await record('00-place', async (page) => {
    await placePart(page, '直流电源', 200, 180, 140)
    await page.waitForTimeout(400)
    await placePart(page, '电阻', 200, 180, 220)
    await page.waitForTimeout(400)
    await placePart(page, '接地', 340, 320, 0)
    await page.waitForTimeout(900)
  })

  // ---- 01：实时读数 ----
  await record('01-readout', async (page) => {
    // 先搭一个完整回路
    await page.evaluate(() => {
      const f = document.getElementById('simframe')
      f.contentWindow.CircuitJS1.importCircuit(
        '$ 1 5.0E-6 10 50 5.0 50\n' +
          'v 200 150 200 350 0 0 40.0 10.0 0.0 0.0 0.5\n' +
          'r 200 150 380 150 0 1000.0\n' +
          'r 380 150 380 350 0 500.0\n' +
          'w 200 350 380 350 0\n' +
          'g 380 350 380 380 0\n',
        false
      )
    })
    await page.waitForTimeout(1500)
    // 拖动滑块改变电阻值（触发读数变化）
    await page.waitForTimeout(1200)
  })

  // ---- 02/03：示波器波形 ----
  await record('02-wave', async (page) => {
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
    await page.waitForTimeout(1000)
    const vBtn = page.locator('.dc-btn', { hasText: '电压通道' }).first()
    await vBtn.click()
    await page.waitForTimeout(2500)
    // 打开第二个通道（电流）
    const iBtn = page.locator('.dc-btn', { hasText: '电流通道' }).first()
    await iBtn.click()
    await page.waitForTimeout(2000)
  })

  // ---- 05：经典电路 ----
  await record('05-presets', async (page) => {
    const ohm = page.locator('.dc-preset-btn', { hasText: '欧姆定律' }).first()
    await ohm.click()
    await page.waitForTimeout(2200)
    const lrc = page.locator('.dc-preset-btn', { hasText: 'LRC 串联谐振' }).first()
    await lrc.click()
    await page.waitForTimeout(2200)
  })

  // ---- 07：框选放大 ----
  await record('07-zoombox', async (page) => {
    await page.evaluate(() => {
      const f = document.getElementById('simframe')
      f.contentWindow.CircuitJS1.importCircuit(
        '$ 1 5.0E-6 10 50 5.0 50\n' +
          'v 200 150 200 350 0 2 60 12 0 0 0.5\n' +
          'r 200 150 380 150 0 1000.0\n' +
          'w 200 350 380 350 0\n' +
          'g 380 350 380 380 0\n' +
          'O 200 150 120 150 0\n',
        false
      )
    })
    await page.waitForTimeout(900)
    const vBtn = page.locator('.dc-btn', { hasText: '电压通道' }).first()
    await vBtn.click()
    await page.waitForTimeout(2600)
    // 在波形上框选
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
      fire('mousedown', r.width * 0.35, r.height * 0.25)
      fire('mousemove', r.width * 0.55, r.height * 0.45)
      fire('mousemove', r.width * 0.7, r.height * 0.65)
      fire('mouseup', r.width * 0.7, r.height * 0.65)
    })
    await page.waitForTimeout(1500)
  })

  // ---- 实测：完整操作 ----
  await record(
    'live',
    async (page) => {
      const ohm = page.locator('.dc-preset-btn', { hasText: '欧姆定律' }).first()
      await ohm.click()
      await page.waitForTimeout(1800)
      const vBtn = page.locator('.dc-btn', { hasText: '电压通道' }).first()
      await vBtn.click()
      await page.waitForTimeout(2600)
    },
    2000
  )

  await ctx.close()
  await browser.close()

  fs.writeFileSync(
    path.join(OUT, 'scenes.json'),
    JSON.stringify(scenes, null, 2)
  )
  console.log('全部录制完成：', scenes.length, '个场景')
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
