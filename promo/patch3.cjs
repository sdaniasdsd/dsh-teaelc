const fs = require('node:fs')

const P = 'D:/circuit电路模拟/promo/film.html'
let s = fs.readFileSync(P, 'utf8')

// 窗口太大留白：改为铺满可用区域。
// 字幕带占 y 946~1046，所以窗口可占到 y=930。
// 目标：窗口占 x 40~1880（宽 1840），y 20~930（高 910）。
// 原窗口 1560x960，缩放 s=1840/1560=1.179，但高度 960*1.179=1132 超了。
// 改用"按高度适配"：s = 910/960 = 0.948，宽 1560*0.948=1478。
// 再放大窗口本体尺寸更简单：直接把 #win 改成 1840x910，视频铺满。
const oldWin = '#win{position:absolute;left:180px;top:60px;width:1560px;height:960px;'
const newWin = '#win{position:absolute;left:40px;top:20px;width:1840px;height:910px;'
if (s.includes(oldWin)) {
  s = s.replace(oldWin, newWin)
  console.log('window geometry -> 1840x910 at (40,20)')
} else {
  console.error('window css anchor not found')
}

// #shots 跟随窗口内容区：宽 1840，高 910-38=872
s = s.replace(
  '#shots{position:absolute;left:0;top:38px;width:1560px;height:922px;background:#000}',
  '#shots{position:absolute;left:0;top:38px;width:1840px;height:872px;background:#000}'
)

// camFor：既然窗口已铺满，缩放回归 1.0，只保留轻微视差
const oldFn = s.indexOf('function camFor(t) {')
const endMarker = 'return { cx, s };\n}'
const endIdx = s.indexOf(endMarker, oldFn)
if (oldFn < 0 || endIdx < 0) {
  console.error('camFor not found')
  process.exit(1)
}
const newFn = `function camFor(t) {
  // 窗口已铺满安全区（40~1880 / 20~930），字幕独占底部 946~1046。
  // 镜头只做**轻微视差**，不再大幅缩放，避免露出黑边。
  let cx = 1920, s = 1.0;

  if (t < T_TITLE) {
    cx = 1890; s = 1.02;                                  // 钩子
  } else if (t < T_00) {
    cx = 1920; s = mix(1.02, 0.92, seg(t, T_TITLE, T_TITLE + 1.2));   // 标题卡拉远
  } else if (t < T_02) {
    cx = 1900; s = 1.0;                                   // 00/01
  } else if (t < T_03) {
    cx = 1940; s = 1.0;                                   // 02
  } else if (t < T_C1) {
    cx = 1900; s = 1.0;                                   // 03
  } else if (t < T_C2) {
    cx = 1900; s = 0.98;                                  // 卡1
  } else if (t < T_07) {
    cx = 1940; s = 1.0;                                   // 05
  } else if (t < T_LIVE) {
    cx = 1900; s = 1.0;                                   // 07
  } else if (t < T_END) {
    cx = 1940; s = 1.0;                                   // 实测
  } else {
    cx = 1920; s = mix(1.0, 0.88, seg(t, T_END, T_END + 1.4));        // 片尾
  }
  return { cx, s };
}`
s = s.slice(0, oldFn) + newFn + s.slice(endIdx + endMarker.length)
console.log('camFor rewritten for full-bleed window')

fs.writeFileSync(P, s)
console.log('done')
