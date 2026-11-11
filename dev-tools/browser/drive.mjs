/**
 * 浏览器探针：用 puppeteer-core + 本机 Chrome/Edge 打开模拟器，收集控制台错误、
 * 页面异常、请求失败，并截图。用于"真跑一遍看哪里坏"。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire('C:/Users/AA/.dsh/profiles/desktop/')
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URLBASE = process.argv[2] || 'http://127.0.0.1:0'
const OUTDIR = resolve('D:/circuit电路模拟/dev-tools/browser/out')
mkdirSync(OUTDIR, { recursive: true })

export async function open(url, opts = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1400,900', '--allow-file-access-from-files'],
    defaultViewport: { width: 1400, height: 900 },
  })
  const page = await browser.newPage()
  const logs = []
  page.on('console', (m) => logs.push({ type: m.type(), text: m.text(), where: m.location() }))
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e && e.stack || e) }))
  page.on('requestfailed', (r) => logs.push({ type: 'requestfailed', text: `${r.url()} :: ${r.failure()?.errorText}` }))
  page.on('response', (r) => { if (r.status() >= 400) logs.push({ type: 'http' + r.status(), text: r.url() }) })
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  return { browser, page, logs }
}

export { OUTDIR }
