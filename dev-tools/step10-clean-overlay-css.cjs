const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.css'
let css = fs.readFileSync(P, 'utf8')

// 删掉覆盖层相关的整段样式（从 .dc-scope-overlay 到 is-expanded 块结束）
const startMark = '/* ---- 示波器放大覆盖层（v3） ---- */'
const altStart = '.dc-scope-overlay {'
let a = css.indexOf(startMark)
if (a < 0) a = css.indexOf(altStart)
if (a >= 0) {
  // 找到 is-expanded canvas 规则的结束
  const keyEnd = css.indexOf('.dc-section.is-expanded canvas.dc-scope {')
  let end = -1
  if (keyEnd >= 0) {
    end = css.indexOf('}', keyEnd) + 1
  }
  if (end > 0) {
    css = css.slice(0, a) + css.slice(end)
    console.log('overlay styles removed')
  }
}

// 追加滚轮缩放提示样式
css += `
/* 滚轮缩放提示 */
.dc-scope-hint {
  color: var(--text-faint);
  font-size: 10px;
  padding: 2px 4px;
  border: 1px dashed #2a3a49;
  border-radius: 4px;
  white-space: nowrap;
}
`

fs.writeFileSync(P, css)
console.log('overlay css refs:', css.split('dc-scope-overlay').length - 1)
console.log('is-expanded refs:', css.split('is-expanded').length - 1)
