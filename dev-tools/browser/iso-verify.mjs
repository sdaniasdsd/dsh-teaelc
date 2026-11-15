/**
 * 在**隔离的 DSH 实例**（与自己正在用的那个完全无关）里验证：
 *   1. 宿主不崩溃，能稳定跑完启动
 *   2. 客户端 bundle 路由 /plugins/* 真的提供了本插件
 *   3. 侧边栏真的出现「电路小实验」入口
 *   4. 点进去能打开主区页面
 *
 * 这才是"侧边栏启用"的真正验收 —— 之前只看 /dsh-circuit/ 200 是不够的。
 */
import { resolve } from 'node:path'
import { OUTDIR } from './drive.mjs'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire('C:/Users/AA/.dsh/profiles/desktop/')
const puppeteer = require('puppeteer-core')

const LOG_PATH = process.env.ISO_LOG || 'C:/Users/AA/AppData/Local/Temp/dsh-iso/boot.log'
const log = readFileSync(LOG_PATH, 'utf8')
const m = log.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/)
if (!m) { console.error('找不到启动 URL'); process.exit(1) }
const [, port, token] = m
const BASE = `http://127.0.0.1:${port}`
console.log('isolated DSH:', BASE)

const results = []
const check = (n, ok, e) => { results.push({ n, ok }); console.log(ok ? '  PASS' : '  FAIL', n, e ?? '') }

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const logs = []
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') logs.push('console: ' + m.text().slice(0, 200)) })

// 先访问带 token 的地址拿 cookie，再回根路径
// 先用带 token 的地址拿到 auth cookie（宿主会 303 + Set-Cookie），再回根路径；
// 否则根路径返回 401，页面根本不会 boot（这正是上一轮 0 条 entry 的原因）。
await page.goto(`${BASE}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await new Promise((r) => setTimeout(r, 1500))
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 90000 })
// 等模块图真的填好（boot 是异步的），最多 30 秒
for (let i = 0; i < 30; i += 1) {
  const n = await page.evaluate(() => (window.__DSH_BOOT__?.entries ?? []).length)
  if (n > 0) break
  await new Promise((r) => setTimeout(r, 1000))
}
await new Promise((r) => setTimeout(r, 6000))

const boot = await page.evaluate(() => {
  const g = window.__DSH_BOOT__
  if (!g) return { has: false }
  const ids = (g.entries || []).map((e) => e.id)
  return { has: true, ids, circuit: ids.filter((i) => /circuit/.test(i)) }
})
console.log('boot entries:', boot.ids ? boot.ids.length : 0, '| circuit:', JSON.stringify(boot.circuit))
check('__DSH_BOOT__ 存在', boot.has)
check('模块图里含 @commonworks/dsh-circuit', (boot.circuit || []).length === 1)

const side = await page.evaluate(() => {
  const txt = document.body.innerText || ''
  return {
    bodyLen: txt.length,
    hasLabel: /电路小实验/.test(txt),
    states: (() => {
      try { return JSON.stringify(window.__clientModulesState || null).slice(0, 400) } catch { return null }
    })(),
  }
})
console.log('sidebar text present:', side.hasLabel, '| bodyLen', side.bodyLen)
check('侧边栏出现「电路小实验」', side.hasLabel, side.states || '')

// 点击侧栏条目，看主区是否渲染
const clicked = await page.evaluate(async () => {
  const btns = [...document.querySelectorAll('button')]
  const el = btns.find((b) => (b.getAttribute('aria-label') || b.textContent || '').includes('电路小实验'))
  if (!el) return { found: false }
  el.click()
  await new Promise((r) => setTimeout(r, 4000))
  const iframe = document.querySelector('iframe[src*="dsh-circuit"]')
  return { found: true, hasIframe: !!iframe, src: iframe && iframe.getAttribute('src') }
})
check('侧栏条目可点击', clicked.found)
check('点击后在主区打开模拟器 iframe', clicked.hasIframe, clicked.src)

await page.screenshot({ path: resolve(OUTDIR, 'iso-sidebar.png') })
console.log('\nlogs:', logs.length ? JSON.stringify(logs.slice(0, 4), null, 1) : '无错误')
const failed = results.filter((r) => !r.ok)
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`)
await browser.close()
process.exit(failed.length ? 1 : 0)
