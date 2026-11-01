const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

// 删除 renderShell 结束后残留的孤立代码块（943-950 行附近）
const orphan = `
  ui.toast = el('div', { class: 'dc-toast' })
  document.body.appendChild(ui.toast)

  // 示波器放大用的覆盖层，平时隐藏。
  ui.scopeOverlay = el('div', { class: 'dc-scope-overlay', id: 'dc-scope-overlay' })
  ui.scopeOverlay.style.display = 'none'
  document.body.appendChild(ui.scopeOverlay)
}
`
if (s.includes(orphan)) {
  s = s.replace(orphan, '')
  console.log('removed orphan shell tail')
}

// 删除整套分隔条逻辑（restoreSectionHeights / saveSectionHeights / startSplit / HEIGHT_KEY）
function cutBlock(marker, endMarker) {
  const a = s.indexOf(marker)
  if (a < 0) return false
  const b = s.indexOf(endMarker, a)
  if (b < 0) return false
  s = s.slice(0, a) + s.slice(b + endMarker.length)
  return true
}

if (s.includes('/* ---- 区块高度拖动调整 ---- */')) {
  const start = s.indexOf('/* ---- 区块高度拖动调整 ---- */')
  // 到 startSplit 函数结束
  const fnIdx = s.indexOf('function startSplit(', start)
  let depth = 0
  let end = -1
  for (let i = s.indexOf('{', fnIdx); i < s.length; i += 1) {
    if (s[i] === '{') depth += 1
    else if (s[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end > 0) {
    s = s.slice(0, start) + s.slice(end)
    console.log('removed splitter code')
  }
}

fs.writeFileSync(P, s)
console.log('restoreSectionHeights refs:', s.split('restoreSectionHeights').length - 1)
console.log('startSplit refs:', s.split('startSplit').length - 1)
