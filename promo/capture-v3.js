/**
 * 重新录制：满幅 16:9 素材，专为剪辑设计。
 *
 * 上一版的问题：
 *  - 视口 1600×1000（16:10），界面缩在角落，大片死黑，放大后全是糊的。
 *  - 每段录了整套操作，剪辑时无法聚焦单个动作。
 *
 * 本版：
 *  - 视口 1920×1080，与成片画布一致，零缩放损失。
 *  - 开局把 4 个窗口铺成「左栏 + 中央画布 + 右栏」的满幅布局。
 *  - 每段只做**一个**动作，配合鼠标真实移动轨迹，便于剪辑放大特写。
 */
const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:50986/dsh-circuit/'
const OUT = path.resolve(__dirname, 'capture3')
const W = 1920
const H = 1080

fs.mkdirSync(OUT, { recursive: true })

async function waitKernel(page) {
  await page.waitForFunction(
    () => {
      const f = document.getElementById('simframe')
      return f && f.contentWindow && f.contentWindow.CircuitJS1
    },
    { timeout: 30000 }
  )
  await page.waitForTimeout(1000)
}

/** 铺满幅布局：左栏元件+测量，中上示波器，右侧经典电路 */
async function layout(page) {
  await page.evaluate(() => {
    const set = (id, x, y, w, h) => {
      const el = document.getElementById(id)
      if (!el) return
      el.style.left = x + 'px'
      el.style.top = y + 'px'
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      el.style.display = ''
    }
    // 画布区 1920x1080，留 8px 边
    set('dc-win-parts',    8, 8, 292, 470)
    set('dc-win-measure',  8, 484, 292, 588)
    set('dc-win-scope',    308, 8, 700, 500)
    set('dc-win-presets',  308, 516, 700, 556)
  })
  await page.waitForTimeout(600)
}

/** 载入电路 */
async function loadCircuit(page, net) {
  await page.evaluate((n) => {
    document.getElementById('simframe').contentWindow.CircuitJS1.importCircuit(n, false)
  }, net)
  await page.waitForTimeout(1400)
}

/** 真实鼠标移动 + 点击（产生可见的光标轨迹） */
async function moveTo(page, x, y, steps = 18) {
  await page.mouse.move(x, y, { steps })
  await page.waitForTimeout(220)
}

async function clickAt(page, x, y) {
  await moveTo(page, x, y)
  await page.mouse.down()
  await page.waitForTimeout(70)
  await page.mouse.up()
  await page.waitForTimeout(420)
}

// 带探头的电路
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

  async function record(name, fn, holdMs = 1500) {
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'load' })
    await waitKernel(page)
    await layout(page)
    try {
      await fn(page)
    } catch (e) {
      console.log(`[${name}] 异常:`, e.message)
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

  /* ---------- A. 搭电路（三拍：电源→电阻→导线闭合） ---------- */
  await record('A-build', async (page) => {
    // 清空
    await page.evaluate(() => {
      const f = document.getElementById('simframe')
      const doc = f.contentDocument
      const m = [...doc.querySelectorAll('.gwt-MenuItem')].find(
        (x) => x.textContent.trim().startsWith('文件')
      )
      if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      setTimeout(() => {
        const b = [...doc.querySelectorAll('.menuItem')].find((x) =>
          /New Blank Circuit/.test(x.textContent || '')
        )
        if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }, 150)
    })
    await page.waitForTimeout(700)

    // 点「直流电源」
    const dc = page.locator('.dc-part-btn', { hasText: '直流电源' }).first()
    const box = await dc.boundingBox()
    await clickAt(page, box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(500)

    // 在画布上拖出电源
    await page.evaluate(() => {
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
      fire('mousedown', 700, 200)
      fire('mousemove', 700, 260)
      fire('mousemove', 700, 320)
      fire('mouseup', 700, 320)
    })
    await page.waitForTimeout(900)
  })

  /* ---------- B. 实时读数（聚焦测量台放大） ---------- */
  await record('B-readout', async (page) => {
    await loadCircuit(page, NET_DC)
    await page.waitForTimeout(1200)
    // 鼠标移到测量台区域停留（剪辑时会推近这里）
    await moveTo(page, 150, 700, 24)
    await page.waitForTimeout(1600)
  })

  /* ---------- C. 波形（开通道，波形生长） ---------- */
  await record('C-wave', async (page) => {
    await loadCircuit(page, NET_AC)
    await page.waitForTimeout(900)
    const vb = page.locator('.dc-btn', { hasText: '电压通道' }).first()
    const bb = await vb.boundingBox()
    await clickAt(page, bb.x + bb.width / 2, bb.y + bb.height / 2)
    await page.waitForTimeout(2600)
    const ib = page.locator('.dc-btn', { hasText: '电流通道' }).first()
    const ib2 = await ib.boundingBox()
    await clickAt(page, ib2.x + ib2.width / 2, ib2.y + ib2.height / 2)
    await page.waitForTimeout(2400)
  })

  /* ---------- D. 经典电路（逐个载入） ---------- */
  await record('D-presets', async (page) => {
    const ohm = page.locator('.dc-preset-btn', { hasText: '欧姆定律' }).first()
    const ob = await ohm.boundingBox()
    await clickAt(page, ob.x + ob.width / 2, ob.y + ob.height / 2)
    await page.waitForTimeout(2200)
    const lrc = page.locator('.dc-preset-btn', { hasText: 'LRC 串联谐振' }).first()
    const lb = await lrc.boundingBox()
    await clickAt(page, lb.x + lb.width / 2, lb.y + lb.height / 2)
    await page.waitForTimeout(2400)
  })

  /* ---------- E. 框选放大 ---------- */
  await record('E-zoom', async (page) => {
    await loadCircuit(page, NET_AC)
    await page.waitForTimeout(900)
    const vb = page.locator('.dc-btn', { hasText: '电压通道' }).first()
    const bb = await vb.boundingBox()
    await clickAt(page, bb.x + bb.width / 2, bb.y + bb.height / 2)
    await page.waitForTimeout(2800)
    // 在波形画布上框选
    await page.evaluate(() => {
      const cv = document.querySelector('canvas.dc-scope')
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
      fire('mousedown', r.width * 0.28, r.height * 0.26)
      fire('mousemove', r.width * 0.48, r.height * 0.5)
      fire('mousemove', r.width * 0.74, r.height * 0.72)
      fire('mouseup', r.width * 0.74, r.height * 0.72)
    })
    await page.waitForTimeout(1800)
  })

  /* ---------- F. 完整实测（长镜头） ---------- */
  await record(
    'F-live',
    async (page) => {
      const ohm = page.locator('.dc-preset-btn', { hasText: '欧姆定律' }).first()
      const ob = await ohm.boundingBox()
      await clickAt(page, ob.x + ob.width / 2, ob.y + ob.height / 2)
      await page.waitForTimeout(2000)
      await moveTo(page, 660, 260, 22)
      await page.waitForTimeout(600)
      const vb = page.locator('.dc-btn', { hasText: '电压通道' }).first()
      const bb = await vb.boundingBox()
      await clickAt(page, bb.x + bb.width / 2, bb.y + bb.height / 2)
      await page.waitForTimeout(2800)
    },
    2500
  )

  await ctx.close()
  await browser.close()

  fs.writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify(scenes, null, 2))
  console.log('完成:', scenes.length, '个满幅场景')
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
