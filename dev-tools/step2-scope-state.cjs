const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

// 1) 示波器档位 state
if (!s.includes('  timebase:')) {
  const anchor = '  scopeExpanded: false,'
  if (s.includes(anchor)) {
    s = s.replace(anchor, anchor + "\n  timebase: 1,\n  voltsPerDiv: 0,\n  coupling: 'dc',")
  } else {
    console.error('scopeExpanded anchor missing')
  }
}

// 2) 每个通道加 enabled 标记（示波器的通道开/关）
const colorLine = 'color: CHANNEL_COLORS[state.channels.length % CHANNEL_COLORS.length],'
if (!s.includes('enabled: true,')) {
  if (s.includes(colorLine)) {
    s = s.replace(colorLine, colorLine + '\n    enabled: true,')
  } else {
    console.error('color line missing')
  }
}

fs.writeFileSync(P, s)
console.log('done')
