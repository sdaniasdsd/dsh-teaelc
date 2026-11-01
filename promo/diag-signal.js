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

  await p.evaluate((n) => {
    document.getElementById('simframe').contentWindow.CircuitJS1.importCircuit(n, false)
  }, NET)
  await p.waitForTimeout(1600)

  console.log('=== 连续采样探头与电源电压 ===')
  for (let k = 0; k < 10; k++) {
    const v = await p.evaluate(() => {
      const api = document.getElementById('simframe').contentWindow.CircuitJS1
      const els = api.getElements()
      const probes = els.filter((e) => e.getType() === 'ProbeElm' || e.getType() === 'OutputElm')
      const src = els.filter((e) => e.getType() === 'VoltageElm')
      const res = els.filter((e) => e.getType() === 'ResistorElm')
      return {
        t: api.getTime(),
        probe: probes.map((e) => Number(e.getVoltageDiff().toFixed(2))),
        srcVd: src[0] ? Number(src[0].getVoltageDiff().toFixed(2)) : null,
        resVd: res[0] ? Number(res[0].getVoltageDiff().toFixed(2)) : null,
      }
    })
    console.log(`t=${v.t.toFixed(5)}  探头=${JSON.stringify(v.probe)}  电源=${v.srcVd}  电阻=${v.resVd}`)
    await p.waitForTimeout(380)
  }

  await b.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
