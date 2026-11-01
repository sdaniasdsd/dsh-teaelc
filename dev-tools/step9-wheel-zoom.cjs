const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

// 1) 删除 toggleScopeExpanded 整个函数（它会把 section 挪进覆盖层，重复调用导致面板被掏空）
function removeFunction(src, name) {
  const start = src.indexOf(`function ${name}()`)
  if (start < 0) return src
  // 连同前面的 JSDoc 一起删
  let docStart = start
  const docOpen = src.lastIndexOf('/**', start)
  if (docOpen > 0 && start - docOpen < 900) docStart = docOpen
  let depth = 0
  let end = -1
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end < 0) return src
  console.log(`${name} removed`)
  return src.slice(0, docStart) + src.slice(end)
}

s = removeFunction(s, 'toggleScopeExpanded')

// 2) 删除覆盖层 DOM 创建
const overlayBlock = `
  ui.scopeOverlay = el('div', { class: 'dc-scope-overlay', id: 'dc-scope-overlay' })
  ui.scopeOverlay.style.display = 'none'
  document.body.appendChild(ui.scopeOverlay)
`
if (s.includes(overlayBlock.trim())) {
  s = s.split(overlayBlock).join('\n')
  console.log('overlay creation removed')
} else {
  const simple = "  ui.scopeOverlay = el('div', { class: 'dc-scope-overlay', id: 'dc-scope-overlay' })"
  const idx = s.indexOf(simple)
  if (idx >= 0) {
    const end = s.indexOf('}', idx)
    // 保守：删两行
    const lineEnd = s.indexOf('\n', s.indexOf('\n', s.indexOf('\n', idx) + 1) + 1)
    s = s.slice(0, idx) + s.slice(lineEnd + 1)
    console.log('overlay creation removed (fallback)')
  }
}

// 3) 插入 zoomTimebase
const zoomFn = [
  '/**',
  ' * 用鼠标滚轮缩放时间轴。',
  ' *',
  ' * 向上滚（deltaY < 0）→ 选更短的时基 → 放大细节；',
  ' * 向下滚 → 选更长的时基 → 看到更宽的时段。',
  ' * 直接在 TIMEBASE 档位表里跳一档，所以缩放是"咔哒"式的，和真实示波器的',
  ' * 时基旋钮手感一致，不会得到 37.4ms/格 这种怪值。',
  ' */',
  'function zoomTimebase(direction) {',
  '  const current = state.timebase || 0.1',
  '  let idx = TIMEBASE.findIndex((t) => Math.abs(t.v - current) < 1e-12)',
  '  if (idx < 0) {',
  '    // 不在档位表里（自动时基临时改过），找最接近的',
  '    idx = TIMEBASE.reduce((best, t, i) =>',
  '      Math.abs(t.v - current) < Math.abs(TIMEBASE[best].v - current) ? i : best, 0)',
  '  }',
  '  const next = Math.max(0, Math.min(TIMEBASE.length - 1, idx + (direction < 0 ? -1 : 1)))',
  '  if (next === idx) return',
  '  state.timebase = TIMEBASE[next].v',
  '  if (ui.timebaseSelect) ui.timebaseSelect.value = String(state.timebase)',
  '  drawScope()',
  '}',
  '',
  '',
].join('\n')

if (!s.includes('function zoomTimebase')) {
  // 放在 drawScope 之前
  const anchor = 'function drawScope() {'
  s = s.replace(anchor, zoomFn + anchor)
  console.log('zoomTimebase added')
}

fs.writeFileSync(P, s)
console.log('toggleScopeExpanded refs:', s.split('toggleScopeExpanded').length - 1)
console.log('scopeOverlay refs:', s.split('scopeOverlay').length - 1)
