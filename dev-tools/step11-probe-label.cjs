const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

const a = "  ProbeElm: '电压表/示波器探头',"
const b = "  ProbeElm: '示波器探头',"
if (s.includes(a)) {
  s = s.replace(a, b)
  console.log('ProbeElm label -> 示波器探头')
}

const c = "  OutputElm: '电压表/示波器探头',"
const d = "  OutputElm: '示波器探头',"
if (s.includes(c)) {
  s = s.replace(c, d)
  console.log('OutputElm label -> 示波器探头')
}

fs.writeFileSync(P, s)
console.log('done')
