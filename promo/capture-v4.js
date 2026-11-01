/**
 * 素材准备脚本：先把「画面」经营好，再录制。
 *
 * 上一版的教训：
 *  - 窗口铺开但电路图很小、示波器没通道、右侧留白 → 画面很空。
 *  - 直接录整套操作，剪辑时无法聚焦。
 *
 * 本版原则：
 *  1) 电路用内核 Zoom In 放大到占满画布，画面才有内容。
 *  2) 每个镜头单独控制窗口布局，画面饱满、没有死区。
 *  3) 通道先建好再录，避免录到空示波器。
 */
const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:50986/dsh-circuit/'
const OUT = path.resolve(__dirname, 'capture4')
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

/** 用内核菜单 Zoom In 放大电路，让回路占满画布 */
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
        const zi = [...doc.querySelectorAll('.menuItem')].find((x) =>
          /Zoom In/.test(x.textContent || '')
        )
        if (zi) zi.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }, 120)
    })
    await page.waitForTimeout(420)
  }
  await page.waitForTimeout(300)
}

/** 窗口布局：给不同镜头不同的构图 */
const LAYOUTS = {
  // 全景：四个窗口铺满
  full: {
    'dc-win-parts':    [8, 8, 292, 470],
    'dc-win-measure':  [8, 484, 292, 588],
    'dc-win-scope':    [308, 8, 700, 520],
    'dc-win-presets':  [308, 534, 700, 538],
  },
  // 强调电路：只留元件栏 + 电路画布（其余隐藏）
  canvas: {
    'dc-win-parts':    [8, 8, 300, 640],
    'dc-win-measure':  [8, 654, 300, 418],
    'dc-win-scope':    null,
    'dc-win-presets':  null,
  },
  // 强调示波器：左侧测量台，右侧示波器占大块
  scope: {
    'dc-win-parts':    null,
    'dc-win-measure':  [8, 8, 320, 1064],
    'dc-win-scope':    [336, 8, 1576, 700],
    'dc-win-presets':  [336, 716, 1576, 356],
  },
  // 强调经典电路：右侧大列表
  presets: {
    'dc-win-parts':    [8, 8, 300, 520],
    'dc-win-measure':  [8, 536, 300, 536],
    'dc-win-scope':    null,
    'dc-win-presets':  [316, 8, 1596, 1064],
  },
}

async function setLayout(page, name) {
  const cfg = LAYOUTS[name]
  await page.evaluate((c) => {
    for (const [id, geo] of Object.entries(c)) {
      const el = document.getElementById(id)
      if (!el) continue
      if (!geo) {
        el.style.display = 'none'
        continue
      }
      el.style.display = ''
      const [x, y, w, h] = geo
      el.style.left = x + 'px'
      el.style.top = y + 'px'
      el.style.width = w + 'px'
      el.style.height = h + 'px'
    }
  }, cfg)
  await page.waitForTimeout(500)
}

async function loadCircuit(page, net) {
  await page.evaluate((n) => {
    document.getElementById('simframe').contentWindow.CircuitJS1.importCircuit(n, false)
  }, net)
  await page.waitForTimeout(1500)
}

async function clearCircuit(page) {
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
  await page.waitForTimeout(600)
}

/** 加电压通道（真实鼠标） */
async function addVoltageChannel(page) {
  const vb = page.locator('.dc-btn', { hasText: '电压通道' }).first()
  const bb = await vb.boundingBox()
  if (!bb) return false
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 14 })
  await page.waitForTimeout(200)
  await page.mouse.down()
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(600)
  return true
}

async function addCurrentChannel(page) {
  const ib = page.locator('.dc-btn', { hasText: '电流通道' }).first()
  const bb = await ib.boundingBox()
  if (!bb) return false
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 14 })
  await page.waitForTimeout(200)
  await page.mouse.down()
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(600)
  return true
}

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

  async function record(name, setup, fn, holdMs = 1400) {
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'load' })
    await waitKernel(page)
    await clearCircuit(page)
    try {
      await setup(page)
      await page.waitForTimeout(800)
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

  /* ===== 1. 搭电路：放大电路占满画布 ===== */
  await record(
    '1-build',
    async (page) => {
      await setLayout(page, 'canvas')
    },
    async (page) => {
      // 放电源
      const dc = page.locator('.dc-part-btn', { hasText: '直流电源' }).first()
      const b1 = await dc.boundingBox()
      await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 12 })
      await page.waitForTimeout(250)
      await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up()
      await page.waitForTimeout(600)
      // 拖到画布
      await page.evaluate(() => {
        const f = document.getElementById('simframe')
        const cv = [...f.contentDocument.querySelectorAll('canvas')].sort((a, b) => b.width - a.width)[0]
        const r = cv.getBoundingClientRect()
        const fire = (t, cx, cy) => cv.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: r.left + cx, clientY: r.top + cy, button: 0 }))
        fire('mousedown', 700, 200); fire('mousemove', 700, 300); fire('mousemove', 700, 420); fire('mouseup', 700, 420)
      })
      await page.waitForTimeout(700)
      // 放电阻
      const rs = page.locator('.dc-part-btn', { hasText: '电阻' }).first()
      const b2 = await rs.boundingBox()
      await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 12 })
      await page.waitForTimeout(250)
      await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up()
      await page.waitForTimeout(600)
      await page.evaluate(() => {
        const f = document.getElementById('simframe')
        const cv = [...f.contentDocument.querySelectorAll('canvas')].sort((a, b) => b.width - a.width)[0]
        const r = cv.getBoundingClientRect()
        const fire = (t, cx, cy) => cv.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: r.left + cx, clientY: r.top + cy, button: 0 }))
        fire('mousedown', 700, 420); fire('mousemove', 820, 420); fire('mousemove', 940, 420); fire('mouseup', 940, 420)
      })
      await page.waitForTimeout(900)
      // 放大电路
      await zoomCircuit(page, 2)
      await page.waitForTimeout(900)
    },
    1600
  )

  /* ===== 2. 电路特写：回路占满画面 ===== */
  await record(
    '2-canvas-closeup',
    async (page) => {
      await setLayout(page, 'canvas')
      await loadCircuit(page, NET_DC)
      await zoomCircuit(page, 3)
    },
    async (page) => {
      // 鼠标沿电路移动，引导视线
      const pts = [[400, 380], [560, 300], [560, 480], [400, 520]]
      for (const [x, y] of pts) {
        await page.mouse.move(x, y, { steps: 16 })
        await page.waitForTimeout(420)
      }
      await page.waitForTimeout(1200)
    },
    1400
  )

  /* ===== 3. 读数：测量台特写 ===== */
  await record(
    '3-readout',
    async (page) => {
      await setLayout(page, 'canvas')
      await loadCircuit(page, NET_DC)
      await zoomCircuit(page, 2)
    },
    async (page) => {
      await page.mouse.move(150, 760, { steps: 20 })
      await page.waitForTimeout(2000)
    },
    1500
  )

  /* ===== 4. 波形：示波器占大块，通道已建 ===== */
  await record(
    '4-scope',
    async (page) => {
      await setLayout(page, 'scope')
      await loadCircuit(page, NET_AC)
      await page.waitForTimeout(600)
      await addVoltageChannel(page)
      await page.waitForTimeout(700)
      await addCurrentChannel(page)
      await page.waitForTimeout(2600)
    },
    async (page) => {
      await page.mouse.move(900, 340, { steps: 20 })
      await page.waitForTimeout(2200)
    },
    1600
  )

  /* ===== 5. 经典电路：右侧大列表 ===== */
  await record(
    '5-presets',
    async (page) => {
      await setLayout(page, 'presets')
      await loadCircuit(page, NET_DC)
      await zoomCircuit(page, 2)
    },
    async (page) => {
      const ohm = page.locator('.dc-preset-btn', { hasText: '欧姆定律' }).first()
      const ob = await ohm.boundingBox()
      await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 16 })
      await page.waitForTimeout(300)
      await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up()
      await page.waitForTimeout(2400)
      const lrc = page.locator('.dc-preset-btn', { hasText: 'LRC 串联谐振' }).first()
      const lb = await lrc.boundingBox()
      await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2, { steps: 16 })
      await page.waitForTimeout(300)
      await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up()
      await page.waitForTimeout(2600)
    },
    1400
  )

  /* ===== 6. 框选放大 ===== */
  await record(
    '6-zoombox',
    async (page) => {
      await setLayout(page, 'scope')
      await loadCircuit(page, NET_AC)
      await page.waitForTimeout(600)
      await addVoltageChannel(page)
      await page.waitForTimeout(2800)
    },
    async (page) => {
      await page.evaluate(() => {
        const cv = document.querySelector('canvas.dc-scope')
        const r = cv.getBoundingClientRect()
        const fire = (t, cx, cy) => cv.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: r.left + cx, clientY: r.top + cy, button: 0 }))
        fire('mousedown', r.width * 0.30, r.height * 0.28)
        fire('mousemove', r.width * 0.50, r.height * 0.50)
        fire('mousemove', r.width * 0.74, r.height * 0.70)
        fire('mouseup', r.width * 0.74, r.height * 0.70)
      })
      await page.waitForTimeout(2000)
    },
    1600
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
