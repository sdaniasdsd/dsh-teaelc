const fs = require('node:fs')

const P = 'D:/circuit电路模拟/promo/film.html'
let s = fs.readFileSync(P, 'utf8')

// 脚本要求：const CUTS=[...] 单行无空格；const CLICKS=[...]；const TICKS=[...]
const oldCuts = /const CUTS = \[[\s\S]*?\];/
const newDecl = [
  'const CUTS=[0,4.016,6.616,13.766,19.616,24.816,30.016,33.916,39.116,43.016,46.916,55.366,63.166];',
  '// 点击音效点（对应 film.html 里光标落点时刻）',
  'const CLICKS=[0.9,2.6,7.5,7.9,14.7,20.8,25.8,26.9,31.2,35.3,39.5,44.6,48.2,49.4];',
  '// 轻触音效点（元件落下/读数跳动）',
  'const TICKS=[7.55,8.05,8.55,15.2,21.5,26.3,36.0,44.9]',
  'window.__CLICKS=CLICKS; window.__TICKS=TICKS;',
].join('\n')

if (oldCuts.test(s)) {
  s = s.replace(oldCuts, newDecl + ';')
  console.log('CUTS/CLICKS/TICKS rewritten to single-line form')
} else {
  console.error('CUTS block not matched')
  process.exit(1)
}

fs.writeFileSync(P, s)
console.log('done')
