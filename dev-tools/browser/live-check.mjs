/**
 * 对**正在运行的 DSH 宿主**做一次真实检查（不是自建的假服务器）。
 * 这是客户实际访问的那个进程，能排除"我自测环境能跑、宿主里跑不起来"。
 */
import { resolve } from 'node:path'
import { open, OUTDIR } from './drive.mjs'
import { readFileSync } from 'node:fs'

const url = process.argv[2] || 'http://127.0.0.1:58892'
const target = url + '/dsh-circuit/'
console.log('target:', target)
const { browser, page, logs } = await open(target)
await new Promise((r) => setTimeout(r, 5000))

const state = await page.evaluate(() => {
  const f = document.getElementById('simframe')
  const p = document.getElementById('panel')
  return {
    title: document.title,
    hasFrame: !!f,
    hasPanel: !!p,
    wins: [...document.querySelectorAll('.dc-win')].map((w) => (w.querySelector('.dc-win-title') || {}).textContent),
    hasMenubar: !!document.getElementById('dc-menubar'),
    hasHelp: !!document.querySelector('.dc-help'),
    panelLen: p ? p.innerHTML.length : 0,
  }
})
console.log('页面状态:', JSON.stringify(state, null, 1))

const inner = page.frames()[1]
let innerOK = null
if (inner) {
  innerOK = await inner.evaluate(() => ({
    api: typeof window.CircuitJS1,
    canvas: document.querySelectorAll('canvas').length,
    menus: document.querySelectorAll('.gwt-MenuItem').length,
  })).catch((e) => ({ err: String(e) }))
  console.log('内核 iframe:', JSON.stringify(innerOK))
}

const bad = logs.filter((l) => /hborder|service-worker|favicon|Failed to load resource/.test(l.text))
const errs = logs.filter((l) => l.type === 'pageerror')
console.log('资源类报错:', bad.length === 0 ? '无' : JSON.stringify(bad.map((b) => b.text).slice(0, 3)))
console.log('未捕获异常:', errs.length === 0 ? '无' : JSON.stringify(errs.slice(0, 2)))

const pass = state.hasFrame && state.wins.length === 5 && state.hasMenubar && state.hasHelp
  && innerOK && innerOK.api === 'object' && bad.length === 0 && errs.length === 0
console.log(pass ? '\n✅ 真实 DSH 宿主里页面完全可用' : '\n❌ 真实宿主里有问题')
await page.screenshot({ path: resolve(OUTDIR, 'live-host.png') })
await browser.close()
process.exit(pass ? 0 : 1)
