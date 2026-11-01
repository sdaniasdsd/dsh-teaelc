const fs = require('node:fs')

const P = 'D:/circuit电路模拟/promo/film.html'
let s = fs.readFileSync(P, 'utf8')

// 1) 字幕定位：从 300px 改到底部条带 946px
const oldTop = "    el.style.top = '300px';"
const newTop = "    el.style.top = '946px';"
if (s.includes(oldTop)) {
  s = s.replace(oldTop, newTop)
  console.log('caption top -> 946px')
} else {
  console.error('top anchor not found')
}

// 2) 字幕动画：左右位移改为轻微上浮（底部条带居中）
const oldDx = '    const dx = (c.in === \'right\' ? 1 : -1) * mix(26, 0, ki);'
const oldTf = '    el.style.transform = `translateX(${dx}px)`;'
if (s.includes(oldDx) && s.includes(oldTf)) {
  s = s.replace(oldDx, '    const dy = mix(16, 0, ki);')
  s = s.replace(oldTf, '    el.style.transform = `translateY(${dy}px)`;')
  console.log('caption motion -> translateY')
} else {
  console.error('motion anchor not found')
}

// 3) 窗口缩放统一 0.80 并上移 26px（camFor 已在别处改，这里改应用公式）
const oldApply = 'world.style.transform = `translate(${1920 - cam.cx}px, 0px) scale(${cam.s})`;'
const newApply = 'world.style.transform = `translate(${1920 - cam.cx}px, -26px) scale(${cam.s})`;'
if (s.includes(oldApply)) {
  s = s.replace(oldApply, newApply)
  console.log('world apply: +vertical offset -26px')
}

fs.writeFileSync(P, s)
console.log('done')
