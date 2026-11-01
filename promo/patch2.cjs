const fs = require('node:fs')

const P = 'D:/circuit电路模拟/promo/film.html'
let s = fs.readFileSync(P, 'utf8')

// camFor：字幕统一在底部，窗口不再需要左右大幅让位，只需轻微视差 + 统一缩放
const oldFn = s.indexOf('function camFor(t) {')
const endMarker = 'return { cx, s };\n}'
const endIdx = s.indexOf(endMarker, oldFn)

if (oldFn < 0 || endIdx < 0) {
  console.error('camFor not found')
  process.exit(1)
}

const newFn = `function camFor(t) {
  // 字幕统一放在底部条带（y\`946~1046），窗口占中上（130~898），两者不重叠。
  // 所以镜头不再需要为字幕左右让位，只做**轻微视差**：让画面不是死板静止。
  // 缩放统一 0.80，窗口宽度 1248，居中占 336~1584，四周留白充足。
  let cx = 1920, s = 0.80;

  if (t < T_TITLE) {
    cx = 1800; s = 0.82;                                   // 钩子：轻微右偏
  } else if (t < T_00) {
    cx = 1920; s = mix(0.82, 0.72, seg(t, T_TITLE, T_TITLE + 1.2));   // 标题卡：拉远
  } else if (t < T_02) {
    cx = 1860; s = 0.80;                                   // 00/01
  } else if (t < T_03) {
    cx = 1980; s = 0.80;                                   // 02
  } else if (t < T_C1) {
    cx = 1860; s = 0.80;                                   // 03
  } else if (t < T_C2) {
    cx = 1860; s = 0.78;                                   // 卡1：窗口压暗保留
  } else if (t < T_07) {
    cx = 1980; s = 0.80;                                   // 05
  } else if (t < T_LIVE) {
    cx = 1860; s = 0.80;                                   // 07
  } else if (t < T_END) {
    cx = 1980; s = 0.80;                                   // 实测
  } else {
    cx = 1920; s = mix(0.80, 0.70, seg(t, T_END, T_END + 1.4));       // 片尾
  }
  return { cx, s };
}`

s = s.slice(0, oldFn) + newFn + s.slice(endIdx + endMarker.length)
fs.writeFileSync(P, s)
console.log('camFor rewritten')
