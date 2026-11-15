/**
 * 看**真实的 DSH 界面**里有没有侧栏入口。
 * GUI 根路径对非浏览器请求返回 401（要有会话令牌），所以必须用真浏览器带着
 * 它自己的 cookie/localStorage 去打开。
 */
import { resolve } from 'node:path'
import { OUTDIR } from './drive.mjs'
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/AA/.dsh/profiles/desktop/')
const puppeteer = require('puppeteer-core')

const URL = process.argv[2] || 'http://127.0.0.1:64165'
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push({ t: m.type(), text: m.text() }))
page.on('pageerror', (e) => logs.push({ t: 'pageerror', text: String(e).slice(0, 200) }))

const resp = await page.goto(URL + '/', { waitUntil: 'networkidle2', timeout: 60000 })
console.log('status:', resp && resp.status())
await new Promise((r) => setTimeout(r, 6000))

const boot = await page.evaluate(() => {
  const g = window.__DSH_BOOT__
  if (!g) return { hasBoot: false }
  const entries = (g.entries || []).map((e) => e.id)
  return {
    hasBoot: true,
    rev: g.rev,
    entryCount: entries.length,
    hasCircuit: entries.includes('@commonworks/dsh-circuit'),
    circuitRows: (g.entries || []).filter((e) => /circuit/.test(e.id)),
  }
})
console.log('boot manifest:', JSON.stringify(boot, null, 1))

const dom = await page.evaluate(() => {
  const txt = document.body.innerText || ''
  return {
    bodyLen: txt.length,
    hasCircuitText: /电路小实验/.test(txt),
    hasLogin: /登录|sign in|密码|token/i.test(txt.slice(0, 500)),
    buttons: [...document.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim()).filter(Boolean).slice(0, 40),
  }
})
console.log('dom:', JSON.stringify(dom, null, 1))
await page.screenshot({ path: resolve(OUTDIR, 'gui-real.png') })
const errs = logs.filter((l) => l.t === 'pageerror')
console.log('pageerrors:', errs.length ? JSON.stringify(errs.slice(0, 3)) : '无')
await browser.close()
