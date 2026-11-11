import { resolve } from 'node:path'
import { startServer } from './serve.mjs'
import { open, OUTDIR } from './drive.mjs'
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
const { url, server } = await startServer()
const { browser, page } = await open(`${url}/dsh-circuit/?embed=1`)
await page.setViewport({ width: 1366, height: 768 })
await page.reload({ waitUntil: 'networkidle2' })
await sleep(4500)
const layout = await page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight
  return { vw, vh, wins: [...document.querySelectorAll('.dc-win')].filter(w=>w.style.display!=='none').map(w=>{
    const r = w.getBoundingClientRect()
    return { title:(w.querySelector('.dc-win-title')||{}).textContent, x:Math.round(r.x),y:Math.round(r.y),right:Math.round(r.right),bottom:Math.round(r.bottom), inside: r.right<=vw+1 && r.bottom<=vh+1 && r.x>=-1 && r.y>=-1 }
  })}
})
const failed = layout.wins.filter((w) => !w.inside)
console.log('1366x768 layout:', JSON.stringify(layout.wins.map((w) => `${w.title}@${w.x},${w.y}-${w.right},${w.bottom}${w.inside ? '' : ' OUT'}`)))
console.log(failed.length === 0 ? '  PASS 全部窗口在 1366×768 可视区内' : '  FAIL 有窗口出界: ' + JSON.stringify(failed))
await page.screenshot({ path: resolve(OUTDIR, 'small-screen.png') })
await browser.close(); server.close()
process.exit(failed.length ? 1 : 0)
