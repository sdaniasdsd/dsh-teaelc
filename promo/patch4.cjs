const fs = require('node:fs')

const P = 'D:/circuit电路模拟/promo/film.html'
let s = fs.readFileSync(P, 'utf8')

// 问题：窗口 1840x910 但视频是 1840x872，且录屏原始是 1600x1000（比例 1.6），
// 窗口内容区 1840x872（比例 2.11）。用 crop 会把左右切掉。
//
// 正确做法：窗口恢复成接近录屏原始比例 1.6，即 1560x960 的窗口 + 视频 contain。
// 但那样四周留白多。
//
// 折中：窗口 1720x930（比例 1.85），视频用 contain（不裁切），
// 左右留少量黑边，但内容完整可见。字幕仍在底部。

const oldWin = '#win{position:absolute;left:40px;top:20px;width:1840px;height:910px;'
const newWin = '#win{position:absolute;left:100px;top:16px;width:1720px;height:908px;'
if (s.includes(oldWin)) {
  s = s.replace(oldWin, newWin)
  console.log('window -> 1720x908 at (100,16)')
}

s = s.replace(
  '#shots{position:absolute;left:0;top:38px;width:1840px;height:872px;background:#000}',
  '#shots{position:absolute;left:0;top:38px;width:1720px;height:870px;background:#000}'
)

// 视频改为 contain（完整显示，不裁切）
s = s.replace(
  '#shots video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}',
  '#shots video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}'
)

fs.writeFileSync(P, s)
console.log('done')
