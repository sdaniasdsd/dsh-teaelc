/**
 * 通道"跨电路串号"回归：换电路后，旧通道必须报断线，绝不能静默读到新电路里
 * 同序号元件的数值。这是正确性问题 —— 数字看着正常但是错的，比报错更危险。
 */
import { startServer } from './serve.mjs'
import { open } from './drive.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, cond, e) => { results.push({ ok: !!cond, name: n }); console.log(cond ? '  PASS' : '  FAIL', n, e === undefined ? '' : String(e).slice(0, 240)) }

const { url, server } = await startServer()
const { browser, page } = await open(`${url}/dsh-circuit/`)
await sleep(4200)

// 1) 加载欧姆定律，给"电阻"接一个电流通道
await page.evaluate(() => {
  [...document.querySelectorAll('.dc-preset-btn')].find((x) => x.querySelector('.dc-preset-name').textContent === '欧姆定律').click()
})
await sleep(2600)
const before = await page.evaluate(async () => {
  const tr = [...document.querySelectorAll('.dc-table-wrap tbody tr')].find((r) => r.textContent.includes('电阻'))
  tr.querySelectorAll('button')[1].click()
  await new Promise((r) => setTimeout(r, 1500))
  const d = window.__dshCircuitDebug()
  return { ch: d.channels, vals: d.lastValues }
})
check('原电路通道有真实读数', before.vals.length === 1 && Number.isFinite(before.vals[0]) && before.vals[0] !== 0, JSON.stringify(before))

// 2) 换到另一份电路（元件顺序/参数完全不同）
await page.evaluate(() => {
  [...document.querySelectorAll('.dc-preset-btn')].find((x) => x.querySelector('.dc-preset-name').textContent === 'LRC 振荡电路').click()
})
await sleep(3000)
const after = await page.evaluate(() => {
  const d = window.__dshCircuitDebug()
  return {
    ch: d.channels,
    vals: d.lastValues,
    chips: [...document.querySelectorAll('.dc-chip-name')].map((c) => c.textContent),
    readouts: (document.querySelector('.dc-readouts') || {}).textContent,
    meta: (document.querySelector('.dc-scope-meta') || {}).textContent,
  }
})
check('换电路后通道立刻标为断开', after.ch.every((c) => /已断开/.test(c.label)), JSON.stringify(after.ch))
check('通道条也显示断开', after.chips.every((t) => /已断开/.test(t)), JSON.stringify(after.chips))
check('采样值是 NaN（不是别的元件的数）', after.vals.every((v) => !Number.isFinite(v)), JSON.stringify(after.vals))
check('读数条不给出假数字', /断线|—/.test(after.readouts || '') || !/[0-9]/.test(after.readouts || ''), after.readouts)

// 3) 客户重新选一个测点，通道应该恢复
const recovered = await page.evaluate(async () => {
  const sel = document.querySelector('.dc-probe-row select')
  const opts = [...sel.options].filter((o) => o.value && o.value !== '__gnd__')
  if (!opts.length) return { err: 'no options' }
  sel.value = opts[opts.length - 1].value
  sel.dispatchEvent(new Event('change'))
  await new Promise((r) => setTimeout(r, 1800))
  const d = window.__dshCircuitDebug()
  return { ch: d.channels, vals: d.lastValues }
})
check('重新选择测点后恢复读数', !/已断开/.test(recovered.ch[0].label) && Number.isFinite(recovered.vals[0]), JSON.stringify(recovered))

const failed = results.filter((r) => !r.ok)
console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' passed ====')
await browser.close(); server.close()
process.exit(failed.length ? 1 : 0)
