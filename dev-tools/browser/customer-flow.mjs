/**
 * 客户视角端到端流程：完全按"第一次用"的顺序操作，每一步都断言看得见的结果。
 * 这是"能用/无 bug"的验收脚本 —— 任何一步失败就是客户会撞到的问题。
 */
import { resolve } from 'node:path'
import { startServer } from './serve.mjs'
import { open, OUTDIR } from './drive.mjs'

const results = []
const check = (n, cond, e) => {
  results.push({ ok: !!cond, name: n, extra: e })
  console.log(cond ? '  PASS' : '  FAIL', n, e === undefined ? '' : String(e).slice(0, 260))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { url, server } = await startServer()
// embed=1 就是侧栏里 iframe 打开的那个地址（客户实际看到的形态）
const { browser, page, logs } = await open(`${url}/dsh-circuit/?embed=1`)
await sleep(4200)

console.log('\n== 1. 打开就能看懂 ==')
const firstLook = await page.evaluate(() => ({
  hasMenu: !!document.getElementById('dc-menubar'),
  menuLabel: (document.querySelector('.dc-menubar-btn') || {}).textContent,
  helpVisible: (() => {
    const w = document.getElementById('dc-win-help')
    return !!w && w.style.display !== 'none'
  })(),
  helpText: (document.querySelector('.dc-help') || {}).textContent || '',
  wins: [...document.querySelectorAll('.dc-win')].map((w) => ({
    id: w.id,
    title: (w.querySelector('.dc-win-title') || {}).textContent,
    visible: w.style.display !== 'none',
  })),
}))
check('有「面板」菜单入口', firstLook.hasMenu && /面板/.test(firstLook.menuLabel || ''), firstLook.menuLabel)
check('首次打开自动显示「怎么用」', firstLook.helpVisible === true)
check('「怎么用」写清了四步', /放元件/.test(firstLook.helpText) && /接地/.test(firstLook.helpText), firstLook.helpText.slice(0, 60))
check('5 个窗口全部可见', firstLook.wins.filter((w) => w.visible).length === 5, JSON.stringify(firstLook.wins.map((w) => w.title)))

console.log('\n== 2. 靠帮助自己搭一个电路 ==')
// 清屏
await page.evaluate(() => {
  const doc = document.getElementById('simframe').contentWindow.document
  const fm = [...doc.querySelectorAll('.gwt-MenuItem')].find((x) => (x.textContent || '').trim().startsWith('文件'))
  fm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const blank = [...doc.querySelectorAll('.menuItem')].find((x) => /New Blank Circuit/.test(x.textContent || ''))
  blank.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(1200)
const empty = await page.evaluate(() => window.__dshCircuitDebug().elements)
check('清空后元件数为 0', empty === 0, 'n=' + empty)

// 放：直流电源 + 电阻 + 接地 + 导线（按帮助的顺序）
async function place(name, x, y, dx, dy) {
  await page.evaluate((n) => {
    [...document.querySelectorAll('.dc-part-btn')].find((b) => b.querySelector('.dc-part-name').textContent === n).click()
  }, name)
  await sleep(450)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + (dx || 0), y + (dy || 0), { steps: 8 })
  await page.mouse.up()
  await sleep(550)
  return page.evaluate(() => window.__dshCircuitDebug().elements)
}
// 画布下半区没被窗口挡住
const n1 = await place('直流电源', 260, 700, 0, 70)
const n2 = await place('电阻', 420, 700, 70, 0)
const n3 = await place('接地', 620, 700, 0, 40)
check('放下直流电源', n1 >= 1, 'n=' + n1)
check('放下电阻', n2 >= 2, 'n=' + n2)
check('放下接地', n3 >= 3, 'n=' + n3)

const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.dc-table-wrap tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()))
check('测量台列出了这些元件', rows.length >= 3, JSON.stringify(rows))
check('每个元件都有电压/电流两列', rows.every((r) => /[0-9]|0/.test(r)), JSON.stringify(rows.slice(0, 2)))

console.log('\n== 3. 点 V / I 接上示波器 ==')
const chan = await page.evaluate(async () => {
  const tr = [...document.querySelectorAll('.dc-table-wrap tbody tr')].find((r) => r.textContent.includes('电阻'))
  if (!tr) return { err: 'no resistor row' }
  const btns = tr.querySelectorAll('button')
  btns[0].click()  // V
  await new Promise((r) => setTimeout(r, 900))
  btns[1].click()  // I
  await new Promise((r) => setTimeout(r, 900))
  const d = window.__dshCircuitDebug()
  return {
    channels: d.channels,
    lit: [...document.querySelectorAll('.dc-ch-toggle.is-on')].length,
    chips: [...document.querySelectorAll('.dc-chip-name')].map((c) => c.textContent),
  }
})
check('两个通道都建立', (chan.channels || []).length === 2, JSON.stringify(chan.channels))
check('通道都有名字', (chan.channels || []).every((c) => c.label), JSON.stringify(chan.channels))
check('测量台按钮点亮', chan.lit >= 2, 'lit=' + chan.lit)
check('示波器通道条显示名字', chan.chips.length === 2, JSON.stringify(chan.chips))

console.log('\n== 4. 波形区能用（滚轮缩放 / 框选） ==')
const canvasBox = await page.evaluate(() => {
  const c = document.querySelector('canvas.dc-scope')
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, l: r.x, t: r.y }
})
const tbBefore = await page.evaluate(() => {
  const s = [...document.querySelectorAll('#dc-win-scope select')].find((x) => [...x.options].some((o) => /µs|ms|s$/.test(o.textContent)))
  return s ? s.value : null
})
await page.mouse.move(canvasBox.x, canvasBox.y)
await page.mouse.wheel({ deltaY: -120 })
await sleep(500)
const tbAfter = await page.evaluate(() => {
  const s = [...document.querySelectorAll('#dc-win-scope select')].find((x) => [...x.options].some((o) => /µs|ms|s$/.test(o.textContent)))
  return s ? s.value : null
})
check('滚轮能改时基', tbBefore !== null && tbAfter !== null && tbBefore !== tbAfter, tbBefore + ' -> ' + tbAfter)

const zoom = await page.evaluate(() => ({ box: !!window.__dshCircuitDebug }))
await page.mouse.move(canvasBox.l + 20, canvasBox.t + 20)
await page.mouse.down()
await page.mouse.move(canvasBox.l + canvasBox.w * 0.6, canvasBox.t + canvasBox.h * 0.8, { steps: 10 })
await page.mouse.up()
await sleep(500)
const afterZoom = await page.evaluate(() => {
  const toast = document.querySelector('.dc-toast')
  return { toastText: toast ? toast.textContent : '', toastVisible: toast ? toast.classList.contains('is-show') : false }
})
check('框选放大有反馈提示', afterZoom.toastVisible && /放大/.test(afterZoom.toastText), JSON.stringify(afterZoom))

console.log('\n== 5. 经典电路一键加载 ==')
const preset = await page.evaluate(async () => {
  [...document.querySelectorAll('.dc-preset-btn')].find((x) => x.querySelector('.dc-preset-name').textContent === '欧姆定律').click()
  await new Promise((r) => setTimeout(r, 2600))
  return {
    elements: window.__dshCircuitDebug().elements,
    status: (document.querySelector('.dc-preset-status') || {}).textContent,
    rows: [...document.querySelectorAll('.dc-table-wrap tbody tr')].length,
    currentValues: [...document.querySelectorAll('.dc-table-wrap tbody tr')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).slice(0, 3),
  }
})
check('预设加载出真实电路', preset.elements >= 8, 'elements=' + preset.elements)
check('状态栏报告已加载', /已加载/.test(preset.status || ''), preset.status)
check('读数非全零（真的在算）', preset.currentValues.some((v) => /[1-9]/.test(v)), JSON.stringify(preset.currentValues))

console.log('\n== 6. 窗口管理不把人困住 ==')
const manage = await page.evaluate(() => {
  // 关掉「怎么用」
  const help = document.getElementById('dc-win-help')
  const btns = help.querySelectorAll('.dc-win-btn')
  btns[btns.length - 1].click()
  const afterClose = help.style.display
  // 从菜单重新打开
  document.querySelector('.dc-menubar-btn').click()
  const items = [...document.querySelectorAll('.dc-menu-item')]
  const helpItem = items.find((b) => b.textContent.includes('怎么用'))
  helpItem.click()
  const afterReopen = help.style.display
  document.querySelector('.dc-menu-dropdown').classList.remove('is-open')
  return { afterClose, afterReopen }
})
check('关掉窗口后 display=none', manage.afterClose === 'none', manage.afterClose)
check('能从菜单重新打开', manage.afterReopen !== 'none', manage.afterReopen)

console.log('\n== 7. 无控制台噪声 ==')
const noise = logs.filter((l) => /hborder|service-worker|favicon|bad HTTP response|Failed to load resource/.test(l.text))
check('无资源类报错', noise.length === 0, JSON.stringify(noise.map((x) => x.text).slice(0, 3)))
const pageErrors = logs.filter((l) => l.type === 'pageerror')
check('无未捕获异常', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 2)))

await page.screenshot({ path: resolve(OUTDIR, 'customer-flow.png') })
const failed = results.filter((r) => !r.ok)
console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' passed ====')
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(' -', f.name, f.extra ?? '')
}
await browser.close()
server.close()
process.exit(failed.length ? 1 : 0)
