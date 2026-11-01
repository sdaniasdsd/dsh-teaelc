const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

const fn = [
  '/**',
  ' * 把宿主外壳切成浮层布局。',
  ' *',
  ' * 宿主的 shellHtml 里 #panel 是右侧固定栏（width:440px; flex:0 0 440px）。',
  ' * 但用户要的是"每个框独立可移动"，所以这里在前端把布局改成：',
  ' *   - #stage 绝对定位铺满整窗（画布全屏）；',
  ' *   - #panel 绝对铺满、pointer-events:none（只有里面的窗口能接收鼠标）。',
  ' * 这样不重启宿主也能立即变成浮动窗口形态。',
  ' */',
  'function applyFloatingLayout() {',
  '  try {',
  '    const stage = document.getElementById(\'stage\')',
  '    const panel = document.getElementById(\'panel\')',
  '    if (stage) {',
  '      stage.style.position = \'absolute\'',
  '      stage.style.inset = \'0\'',
  '      stage.style.flex = \'none\'',
  '      stage.style.width = \'100%\'',
  '    }',
  '    if (panel) {',
  '      panel.style.position = \'absolute\'',
  '      panel.style.inset = \'0\'',
  '      panel.style.width = \'auto\'',
  '      panel.style.flex = \'none\'',
  '      panel.style.borderLeft = \'0\'',
  '      panel.style.overflow = \'hidden\'',
  '      panel.style.pointerEvents = \'none\'',
  '      panel.style.background = \'transparent\'',
  '      panel.style.padding = \'0\'',
  '    }',
  '    document.body.style.position = \'relative\'',
  '    document.body.style.display = \'block\'',
  '  } catch {',
  '    // 布局改写失败时退回宿主默认布局，功能仍可用。',
  '  }',
  '}',
  '',
  '',
].join('\n')

if (!s.includes('function applyFloatingLayout')) {
  s = s.replace('function boot() {', fn + 'function boot() {')
  fs.writeFileSync(P, s)
  console.log('applyFloatingLayout defined')
} else {
  console.log('already defined')
}
