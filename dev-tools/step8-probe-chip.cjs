const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

const fn = [
  '/**',
  ' * 一个小容器，把探头图案按指定颜色渲染出来（直接插入 DOM）。',
  ' * 用 DOM 解析 SVG 字符串，避免各处再拼一遍 innerHTML。',
  ' */',
  'function probeChip(color) {',
  '  const box = el(\'span\', { class: \'dc-probe-chip\' })',
  '  box.innerHTML = probeIconSvg(color, 14)',
  '  return box',
  '}',
  '',
  '',
].join('\n')

if (!s.includes('function probeChip')) {
  // 插到 probeIconSvg 之后
  const idx = s.indexOf('function fmtHz(f) {')
  s = s.slice(0, idx) + fn + s.slice(idx)
  fs.writeFileSync(P, s)
  console.log('probeChip added')
} else {
  console.log('already present')
}
