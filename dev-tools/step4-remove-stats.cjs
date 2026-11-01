const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

// 删除 renderStats 函数（已被 renderScopeReadouts 取代）
const start = s.indexOf('/** 统计每个通道的最小/最大/平均值')
if (start >= 0) {
  let i = s.indexOf('function renderStats() {', start)
  let depth = 0
  let end = -1
  for (let k = s.indexOf('{', i); k < s.length; k += 1) {
    if (s[k] === '{') depth += 1
    else if (s[k] === '}') {
      depth -= 1
      if (depth === 0) {
        end = k + 1
        break
      }
    }
  }
  if (end > 0) {
    s = s.slice(0, start) + s.slice(end)
    console.log('renderStats removed')
  }
}

// tick 里的 renderStats() → renderScopeReadouts()
s = s.split('renderStats()').join('renderScopeReadouts()')

fs.writeFileSync(P, s)
console.log('remaining renderStats refs:', s.split('renderStats').length - 1)
console.log('remaining ui.stats refs:', s.split('ui.stats').length - 1)
