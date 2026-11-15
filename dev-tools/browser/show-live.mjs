/**
 * 直接在真 Chrome 里打开**运行中宿主**提供的页面，确认客户看到的东西，
 * 并截图给用户看。
 */
import { resolve } from 'node:path'
import { OUTDIR } from './drive.mjs'
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/AA/.dsh/profiles/desktop/')
const puppeteer = require('puppeteer-core')

const URL = (process.argv[2] || 'http://127.0.0.1:64165') + '/dsh-circuit/'
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const logs = []
page.on('pageerror', (e) => logs.push(String(e).slice(0, 160)))
page.on('requestfailed', (r) => logs.push('failed: ' + r.url()))

const resp = await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
console.log('HTTP:', resp && resp.status())
await new Promise((r) => setTimeout(r, 5000))

const st = await page.evaluate(() => ({
  title: document.title,
  wins: [...document.querySelectorAll('.dc-win')].map((w) => (w.querySelector('.dc-win-title') || {}).textContent),
  menubar: !!document.getElementById('dc-menubar'),
  help: !!document.querySelector('.dc-help'),
  kernel: (() => {
    try {
      const f = document.getElementById('simframe').contentWindow
      return typeof f.CircuitJS1
    } catch { return 'blocked' }
  })(),
}))
console.log('page:', JSON.stringify(st))

// 加载一个能看出东西的经典电路并接两条波形
await page.evaluate(async () => {
  const help = document.getElementById('dc-win-help')
  const b = help.querySelectorAll('.dc-win-btn')
  b[b.length - 1].click()
  ;[...document.querySelectorAll('.dc-preset-btn')].find((x) => x.querySelector('.dc-preset-name').textContent === 'LRC 串联谐振').click()
})
await new Promise((r) => setTimeout(r, 3000))
await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.dc-table-wrap tbody tr')]
  for (const kw of ['电阻', '电容', '电感']) {
    const tr = rows.find((r) => r.textContent.includes(kw))
    if (tr) tr.querySelectorAll('button')[0].click()
    await new Promise((r) => setTimeout(r, 250))
  }
})
await new Promise((r) => setTimeout(r, 3000))
const wave = await page.evaluate(() => {
  const d = window.__dshCircuitDebug()
  return { channels: d.channels.length, samples: d.sampleCount, elements: d.elements, last: d.lastValues }
})
console.log('live data:', JSON.stringify(wave))
await page.screenshot({ path: resolve(OUTDIR, 'enabled-live.png') })
console.log('pageerrors:', logs.length ? JSON.stringify(logs.slice(0, 3)) : '无')
await browser.close()
