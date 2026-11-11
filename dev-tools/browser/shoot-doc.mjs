import { startServer } from './serve.mjs'
import { open } from './drive.mjs'
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
const { url, server } = await startServer()
const { browser, page } = await open(`${url}/dsh-circuit/`)
await sleep(4200)
// 关掉帮助窗，加载一个能看出波形的预设，接两个通道 —— 这是最能说明"它能干什么"的画面
await page.evaluate(async () => {
  const help = document.getElementById('dc-win-help')
  const btns = help.querySelectorAll('.dc-win-btn')
  btns[btns.length - 1].click()
  ;[...document.querySelectorAll('.dc-preset-btn')].find((x)=>x.querySelector('.dc-preset-name').textContent==='LRC 串联谐振').click()
})
await sleep(3000)
await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.dc-table-wrap tbody tr')]
  const res = rows.find(r=>r.textContent.includes('电阻'))
  const cap = rows.find(r=>r.textContent.includes('电容'))
  const ind = rows.find(r=>r.textContent.includes('电感'))
  if (res) res.querySelectorAll('button')[0].click()
  await new Promise(r=>setTimeout(r,300))
  if (cap) cap.querySelectorAll('button')[0].click()
  await new Promise(r=>setTimeout(r,300))
  if (ind) ind.querySelectorAll('button')[0].click()
})
await sleep(3000)
// 让 toast 消失
await sleep(2500)
await page.screenshot({ path: 'D:/circuit电路模拟/dsh-circuit/docs/screenshot.png' })
console.log('shot saved')
await browser.close(); server.close()
