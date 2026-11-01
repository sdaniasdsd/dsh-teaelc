const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

// 自定义示波器探头图案：SVG 字符串，作为通道标识与"添加通道"按钮图标
const svgFn = [
  '/**',
  ' * 示波器探头图案（自制 SVG，不是图标字体）。',
  ' *',
  ' * 画的是真实无源探头的三段结构：',
  ' *   - 左端 BNC 接头（圆环 + 芯针）',
  ' *   - 中间 10× 衰减盒（矩形，带 "10×" 刻度感）',
  ' *   - 右端探针尖（细长锥形 + 地线夹）',
  ' * 颜色随传入色显示，用来标识不同通道。',
  ' *',
  ' * @param color 主色（十六进制）',
  ' * @param size 像素尺寸，默认 14',
  ' */',
  'function probeIconSvg(color, size) {',
  '  const s2 = size || 14',
  '  return `<svg width="${s2}" height="${s2}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">` +',
  '    `<circle cx="4" cy="12" r="3.2" stroke="${color}" stroke-width="1.6"/>` +',
  '    `<circle cx="4" cy="12" r="1.1" fill="${color}"/>` +',
  '    `<rect x="7.5" y="8.5" width="7" height="7" rx="1.4" stroke="${color}" stroke-width="1.6"/>` +',
  '    `<path d="M14.5 12h2.2" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +',
  '    `<path d="M16.7 12l3.6-2.6M16.7 12l3.6 2.6" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/>` +',
  '    `<path d="M12 19.5v2.2" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="1.4 1.2"/>` +',
  '    `</svg>`',
  '}',
  '',
  '',
].join('\n')

if (!s.includes('function probeIconSvg')) {
  // 插到 fmtHz 之前
  const anchor = 'function fmtHz(f) {'
  s = s.replace(anchor, svgFn + anchor)
  fs.writeFileSync(P, s)
  console.log('probeIconSvg added')
} else {
  console.log('already present')
}
