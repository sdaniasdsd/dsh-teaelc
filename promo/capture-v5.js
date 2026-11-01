/**
 * 素材准备 v5：解决「波形画不出来」的根本问题。
 *
 * 根因：内核仿真速度约 0.0087 倍速（2.5s 真实 → 0.022s 仿真）。
 * 60Hz 正弦一个周期 16.7ms，要画 3 个周期需 50ms 仿真 = 约 5.7 秒真实时间。
 * 之前每段只等 2-3 秒，波形当然只有一条线。
 *
 * 对策：
 *  1) 用 2Hz 低速信号（周期 500ms，跑 1 秒仿真就有 2 个周期）。
 *  2) 开通道后等 12-15 秒，让波形充分生长。
 *  3) 电路用 Zoom In 放大到占满画布。
 */
const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:50986/dsh-circuit/'
const OUT = path.resolve(__dirname, 'capture5')
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

async function clearCircuit(page) {
  await page.evaluate(() => {
    const f = document.getElementById('simframe')
    const doc = f.contentDocument
    const m = [...doc.querySelectorAll('.gwt-MenuItem')].find((x) => x.textContent.trim().startsWith('文件'))
    if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    setTimeout(() => {
      const b = [...doc.querySelectorAll('.menuItem')].find((x) => /New Blank Circuit/.test(x.textContent || ''))
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, 150)
  })
  await page.waitForTimeout(600)
}

async function loadCircuit(page, net) {
  await page.evaluate((n) => {
    document.getElementById('simframe').contentWindow.CircuitJS1.importCircuit(n, false)
  }, net)
  await page.waitForTimeout(1500)
}

async function zoomCircuit(page, times = 3) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => {
      const f = document.getElementById('simframe')
      const doc = f.contentDocument
      const edit = [...doc.querySelectorAll('.gwt-MenuItem')].find(
        (x) => x.textContent.trim().startsWith('编辑') || x.textContent.trim().startsWith('Edit')
      )
      if (edit) edit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      setTimeout(() => {
        const zi = [...doc.querySelectorAll('.menuItem')].find((x) => /Zoom In/.test(x.textContent || ''))
        if (zi) zi.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }, 120)
    })
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(300)
}

const LAYOUTS = {
  full: {
    'dc-win-parts': [8, 8, 292, 470],
    'dc-win-measure': [8, 484, 292, 588],
    'dc-win-scope': [308, 8, 700, 520],
    'dc-win-presets': [308, 534, 700, 538],
  },
  canvas: {
    'dc-win-parts': [8, 8, 300, 640],
    'dc-win-measure': [8, 654, 300, 418],
    'dc-win-scope': null,
    'dc-win-presets': null,
  },
  scope: {
    'dc-win-parts': null,
    'dc-win-measure': [8, 8, 320, 1064],
    'dc-win-scope': [336, 8, 1576, 700],
    'dc-win-presets': [336, 716, 1576, 356],
  },
  presets: {
    'dc-win-parts': [8, 8, 300, 520],
    'dc-win-measure': [8, 536, 300, 536],
    'dc-win-scope': null,
    'dc-win-presets': [316, 8, 1596, 1064],
  },
}

async function setLayout(page, name) {
  await page.evaluate((c) => {
    for (const [id, geo] of Object.entries(c)) {
      const el = document.getElementById(id)
      if (!el) continue
      if (!geo) { el.style.display = 'none'; continue }
      el.style.display = ''
      const [x, y, w, h] = geo
      el.style.left = x + 'px'; el.style.top = y + 'px'
      el.style.width = w + 'px'; el.style.height = h + 'px'
    }
  }, LAYOUTS[name])
  await page.waitForTimeout(500)
}

async function clickBtn(page, text) {
  const b = page.locator('.dc-btn', { hasText: text }).first()
  const bb = await b.boundingBox()
  if (!bb) return false
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 14 })
  await page.waitForTimeout(200)
  await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up()
  await page.waitForTimeout(500)
  return true
}

/* 2Hz 低速交流（周期 500ms，跑 1.5s 仿真就有 3 个周期） */
const NET_AC_SLOW = [
  '$ 1 1.0E-4 10 50 5.0 50',
  'v 200 150 200 350 0 2 2 60 0 0 0.5',
  'r 200 150 380 150 0 1000.0',
  'c 380 150 380 350 0 0.0002 0',
  'w 200 350 380 350 0',
  'g 380 350 380 380 0',
  'O 200 150 130 150 0',
  'O 380 150 450 150 0',
].join('\n')

/* 直流分压（读数用） */
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

/* 电容充放电：波形最漂亮 */
const NET_CAP = [
  '$ 1 1.0E-4 10 50 5.0 50',
  'v 200 150 200 350 0 0 40.0 12.0 0.0 0.0 0.5',
  's 380 150 500 150 0 1 true',
  'r 500 150 640 150 0 1000.0',
  'c 640 150 640 350 0 0.0005 0',
  'w 200 350 640 350 0',
  'w 200 150 380 150 0',
  'g 640 350 640 380 0',
  'O 640 150 700 150 0',
].join('\n')

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  })

  const scenes = []
  async function record(name, setup, fn, holdMs = 1500) {
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'load' })
    await waitKernel(page)
    await clearCircuit(page)
    try {
      await setup(page)
      await page.waitForTimeout(700)
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

  /* 1. 电路特写（放大占满） */
  await record(
    '1-canvas',
    async (page) => {
      await setLayout(page, 'canvas')
      await loadCircuit(page, NET_CAP)
      await zoomCircuit(page, 3)
    },
    async (page) => {
      await page.waitForTimeout(6000)   // 让电荷跑起来
      for (const [x, y] of [[500, 400], [700, 400], [700, 260], [500, 260]]) {
        await page.mouse.move(x, y, { steps: 18 })
        await page.waitForTimeout(500)
      }
      await page.waitForTimeout(2000)
    },
    1500
  )

  /* 2. 读数特写 */
  await record(
    '2-readout',
    async (page) => {
      await setLayout(page, 'canvas')
      await loadCircuit(page, NET_DC)
      await zoomCircuit(page, 2)
      await page.waitForTimeout(4000)
    },
    async (page) => {
      await page.mouse.move(155, 760, { steps: 22 })
      await page.waitForTimeout(3000)
    },
    1500
  )

  /* 3. 波形：低频交流 + 长等待 */
  await record(
    '3-wave',
    async (page) => {
      await setLayout(page, 'scope')
      await loadCircuit(page, NET_AC_SLOW)
      await page.waitForTimeout(800)
      await clickBtn(page, '电压通道')
      await page.waitForTimeout(500)
    },
    async (page) => {
      // 等波形充分生长（仿真推进慢，需要真实时间）
      await page.waitForTimeout(14000)
      await page.mouse.move(900, 340, { steps: 20 })
      await page.waitForTimeout(2500)
    },
    1500
  )

  /* 4. 双通道 */
  await record(
    '4-dual',
    async (page) => {
      await setLayout(page, 'scope')
      await loadCircuit(page, NET_AC_SLOW)
      await page.waitForTimeout(800)
      await clickBtn(page, '电压通道')
      await page.waitForTimeout(400)
      await clickBtn(page, '电流通道')
    },
    async (page) => {
      await page.waitForTimeout(14000)
      await page.mouse.move(1000, 300, { steps: 18 })
      await page.waitForTimeout(2200)
    },
    1500
  )

  /* 5. 经典电路 */
  await record(
    '5-presets',
    async (page) => {
      await setLayout(page, 'presets')
      await loadCircuit(page, NET_DC)
      await page.waitForTimeout(1000)
    },
    async (page) => {
      const ohm = page.locator('.dc-preset-btn', { hasText: '欧姆定律' }).first()
      const ob = await ohm.boundingBox()
      await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 16 })
      await page.waitForTimeout(300)
      await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up()
      await page.waitForTimeout(4000)
      const lrc = page.locator('.dc-preset-btn', { hasText: 'LRC 串联谐振' }).first()
      const lb = await lrc.boundingBox()
      await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2, { steps: 16 })
      await page.waitForTimeout(300)
      await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up()
      await page.waitForTimeout(4000)
    },
    1500
  )

  /* 6. 框选放大 */
  await record(
    '6-zoombox',
    async (page) => {
      await setLayout(page, 'scope')
      await loadCircuit(page, NET_AC_SLOW)
      await page.waitForTimeout(800)
      await clickBtn(page, '电压通道')
      await page.waitForTimeout(14000)
    },
    async (page) => {
      await page.evaluate(() => {
        const cv = document.querySelector('canvas.dc-scope')
        const r = cv.getBoundingClientRect()
        const fire = (t, cx, cy) =>
          cv.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: r.left + cx, clientY: r.top + cy, button: 0 }))
        fire('mousedown', r.width * 0.28, r.height * 0.26)
        fire('mousemove', r.width * 0.48, r.height * 0.48)
        fire('mousemove', r.width * 0.72, r.height * 0.70)
        fire('mouseup', r.width * 0.72, r.height * 0.70)
      })
      await page.waitForTimeout(2600)
    },
    1500
  )

  await ctx.close()
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify(scenes, null, 2))
  console.log('完成:', scenes.length, '个镜头')
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
