/**
 * dsh-circuit 浏览器回归测试：把 docs/plans/2026-11-10-circuit-fix.md 里
 * 每一条实测缺陷都变成断言。用法：node regress.mjs
 */
import { resolve } from 'node:path'
import { startServer } from './serve.mjs'
import { open, OUTDIR } from './drive.mjs'

const results = []
const ok = (n, e) => { results.push({ ok: true, name: n }); console.log('  PASS', n, e ?? '') }
const bad = (n, e) => { results.push({ ok: false, name: n, extra: e }); console.log('  FAIL', n, e ?? '') }
const check = (n, cond, e) => (cond ? ok(n, e) : bad(n, e))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { url, server } = await startServer()
const { browser, page, logs } = await open(`${url}/dsh-circuit/`)
await sleep(4200)

console.log('\n== P2: console noise ==')
const noise = logs.filter((l) => /hborder|service-worker|favicon\.ico|bad HTTP response/.test(l.text))
check('no hborder/service-worker/favicon 404', noise.length === 0, JSON.stringify(noise.map((x) => x.text).slice(0, 3)))

console.log('\n== P0-1: recoverable windows ==')
const closed = await page.evaluate(() => {
  for (const w of document.querySelectorAll('.dc-win')) {
    const btns = w.querySelectorAll('.dc-win-btn')
    btns[btns.length - 1].click()
  }
  return {
    visible: [...document.querySelectorAll('.dc-win')].filter((w) => w.style.display !== 'none').length,
    hasMenu: !!document.getElementById('dc-menubar'),
  }
})
check('all windows closed => visible=0', closed.visible === 0)
check('menubar still present (escape hatch)', closed.hasMenu === true)

const restored = await page.evaluate(() => {
  document.querySelector('.dc-menubar-btn').click()
  ;[...document.querySelectorAll('.dc-menu-item')][0].click()
  return {
    menuOpen: document.querySelector('.dc-menu-dropdown').classList.contains('is-open'),
    visibleAfter: [...document.querySelectorAll('.dc-win')].filter((w) => w.style.display !== 'none').map((w) => w.id),
  }
})
check('panel menu reopens a window', restored.visibleAfter.includes('dc-win-parts'), JSON.stringify(restored))

const resetOK = await page.evaluate(() => {
  ;[...document.querySelectorAll('.dc-menu-item')].find((b) => b.textContent.includes('恢复默认布局')).click()
  return [...document.querySelectorAll('.dc-win')].filter((w) => w.style.display !== 'none').length
})
check('reset layout restores all windows', resetOK === 5, 'visible=' + resetOK)
await sleep(400)

console.log('\n== P0-2/3: geometry clamping ==')
await page.evaluate(() => {
  localStorage.setItem('dsh-circuit:window-geom', JSON.stringify({
    'dc-win-parts': { x: 5000, y: 5000, w: 900, h: 900 },
    'dc-win-scope': { x: -800, y: -800, w: 520, h: 430 },
  }))
})
await page.reload({ waitUntil: 'networkidle2' })
await sleep(4200)
const offscreen = await page.evaluate(() => {
  const vw = window.innerWidth, vh = window.innerHeight
  return [...document.querySelectorAll('.dc-win')]
    .filter((w) => w.style.display !== 'none')
    .map((w) => {
      const r = w.getBoundingClientRect()
      return { id: w.id, x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom),
               reachable: r.x < vw - 20 && r.y < vh - 20 && r.right > 20 && r.bottom > 20 }
    })
})
check('offscreen geometry clamped into viewport', offscreen.every((w) => w.reachable), JSON.stringify(offscreen.filter((w) => !w.reachable)))

console.log('\n== P0-4: scope canvas follows window ==')
// 上一步故意把几何塞成屏幕外的值并刷新过页面；这里先把示波器窗恢复默认位置，
// 否则它的右下角缩放柄不在屏幕上，拖动无从开始。这是测试前置条件，不是产品行为
// —— 产品此时已经把窗口夹回屏内了（见上面 P0-2/3）。
await page.evaluate(() => {
  const all = JSON.parse(localStorage.getItem('dsh-circuit:window-geom') || '{}')
  delete all['dc-win-scope']
  localStorage.setItem('dsh-circuit:window-geom', JSON.stringify(all))
})
await page.reload({ waitUntil: 'networkidle2' })
await sleep(4200)
const before = await page.evaluate(() => {
  const c = document.querySelector('canvas.dc-scope')
  return { h: c.clientHeight, bh: c.height }
})
const scopeWin = await page.$('#dc-win-scope')
const bb = await scopeWin.boundingBox()
await page.mouse.move(bb.x + bb.width - 5, bb.y + bb.height - 5)
await page.mouse.down()
await page.mouse.move(bb.x + bb.width + 60, bb.y + bb.height + 170, { steps: 14 })
await page.mouse.up()
await sleep(800)
const after = await page.evaluate(() => {
  const c = document.querySelector('canvas.dc-scope')
  return { h: c.clientHeight, bh: c.height }
})
check('canvas CSS height grows with window', after.h > before.h + 100, JSON.stringify(before) + ' -> ' + JSON.stringify(after))
check('canvas bitmap resynced', after.bh > before.bh + 100, 'bh ' + before.bh + ' -> ' + after.bh)

console.log('\n== P1-6/7: channel naming + highlight ==')
await page.evaluate(() => {
  [...document.querySelectorAll('.dc-preset-btn')].find((x) => x.querySelector('.dc-preset-name').textContent === '欧姆定律').click()
})
await sleep(2600)
await page.evaluate(() => {
  [...document.querySelectorAll('.dc-btn')].find((b) => b.textContent === '+ 电流通道').click()
})
await sleep(900)
const chanState = await page.evaluate(() => {
  const d = window.__dshCircuitDebug()
  const lit = [...document.querySelectorAll('.dc-table-wrap tbody tr')].filter((tr) => tr.querySelector('.dc-ch-toggle.is-on')).length
  return { channels: d.channels, litRows: lit, chips: [...document.querySelectorAll('.dc-chip-name')].map((c) => c.textContent) }
})
check('new channel has non-empty label', chanState.channels.every((c) => c.label && c.label.length > 0), JSON.stringify(chanState.channels))
check('measure table row highlighted', chanState.litRows >= 1, 'lit=' + chanState.litRows)
const l0 = (chanState.channels[0] && chanState.channels[0].label) || ''
check('label carries element index', /#[0-9]+/.test(l0), l0)
check('default current point is not a wire', !/^导线/.test(l0), l0)

console.log('\n== P1-9: run button sync ==')
const sync = await page.evaluate(async () => {
  const measureBtn = [...document.querySelectorAll('#dc-win-measure .dc-btn')].find((b) => /仿真/.test(b.textContent))
  const scopeBtn = [...document.querySelectorAll('#dc-win-scope .dc-btn')].find((b) => /运行|已暂停/.test(b.textContent))
  measureBtn.click()
  await new Promise((r) => setTimeout(r, 600))
  const paused = { measure: measureBtn.textContent, scope: scopeBtn.textContent }
  measureBtn.click()
  await new Promise((r) => setTimeout(r, 600))
  return { paused, resumed: { measure: measureBtn.textContent, scope: scopeBtn.textContent } }
})
check('scope btn shows paused', /已暂停/.test(sync.paused.scope), JSON.stringify(sync.paused))
check('scope btn shows running again', /^运行$/.test(sync.resumed.scope), JSON.stringify(sync.resumed))

console.log('\n== P1-8: single trigger ==')
await page.evaluate(() => {
  [...document.querySelectorAll('.dc-preset-btn')].find((x) => x.querySelector('.dc-preset-name').textContent === '电容器充放电').click()
})
await sleep(2600)
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.dc-table-wrap tbody tr')]
  const cap = rows.find((tr) => tr.textContent.includes('电容'))
  if (cap) cap.querySelectorAll('button')[0].click()
})
await sleep(1200)
const trigger = await page.evaluate(async () => {
  const sel = [...document.querySelectorAll('#dc-win-scope select')].find((s) => [...s.options].some((o) => o.value === 'single'))
  sel.value = 'single'
  sel.dispatchEvent(new Event('change'))
  // 触发按点数收尾（TRIGGER_CAPTURE_SAMPLES=240），5µs 步长下约 1.5s 就够；
  // 5.5s 留足余量，避免测试比实际功能先放弃。
  await new Promise((r) => setTimeout(r, 5500))
  const d = window.__dshCircuitDebug()
  // 测量台按钮在"运行中"显示「暂停仿真」，冻结后显示「继续仿真」——
  // 所以"是否冻结"要判后者（用仪器自己的状态词，不要另造一套）。
  const btn = [...document.querySelectorAll('#dc-win-measure .dc-btn')].find((b) => /仿真/.test(b.textContent))
  const scopeBtn = [...document.querySelectorAll('#dc-win-scope .dc-btn')].find((b) => /运行|已暂停/.test(b.textContent))
  return { sampleCount: d.sampleCount, button: btn.textContent, scopeButton: scopeBtn.textContent }
})
check('single trigger freezes sim', /继续仿真/.test(trigger.button), JSON.stringify(trigger))
check('scope button agrees with frozen state', /已暂停/.test(trigger.scopeButton), JSON.stringify(trigger))

console.log('\n== P1-10: AC coupling keeps samples ==')
const acTest = await page.evaluate(async () => {
  const runBtn = [...document.querySelectorAll('#dc-win-measure .dc-btn')].find((b) => /仿真/.test(b.textContent))
  if (/继续/.test(runBtn.textContent)) runBtn.click()
  await new Promise((r) => setTimeout(r, 2500))
  const beforeCount = window.__dshCircuitDebug().sampleCount
  const sel = [...document.querySelectorAll('#dc-win-scope select')].find((s) => [...s.options].some((o) => o.textContent === 'AC 耦合'))
  sel.value = '1'
  sel.dispatchEvent(new Event('change'))
  const afterCount = window.__dshCircuitDebug().sampleCount
  sel.value = '0'
  sel.dispatchEvent(new Event('change'))
  return { beforeCount, afterCount }
})
check('AC coupling does not wipe samples', acTest.afterCount > 0 && acTest.beforeCount > 0, JSON.stringify(acTest))

console.log('\n== page errors ==')
const pageErrors = logs.filter((l) => l.type === 'pageerror')
check('no uncaught page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 2)))

await page.screenshot({ path: resolve(OUTDIR, 'regress.png'), fullPage: false })
const failed = results.filter((r) => !r.ok)
console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' passed ====')
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(' -', f.name, f.extra ?? '') }
await browser.close()
server.close()
process.exit(failed.length ? 1 : 0)
