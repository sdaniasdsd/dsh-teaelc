const fs = require('node:fs')

const txt = fs.readFileSync('D:/circuit电路模拟/dsh-circuit/assets/app/locale/locale_zh.txt', 'utf8')
const map = new Map()
for (const line of txt.split(/\r?\n/)) {
  if (line.charAt(0) !== '"') continue
  const i = line.indexOf('"', 1)
  if (i < 0) continue
  const k = line.substring(1, i)
  const v = line.substring(i + 3, line.length - 1)
  map.set(k, v)
}

// 模拟内核 Locale.LS(key)：命中返回译文，未命中返回原键
const LS = (k) => map.get(k) ?? k

const test = [
  'Resistance (ohms)',
  'Capacitance (F)',
  'Inductance (H)',
  'Voltage',
  'Current (A)',
  'Frequency (Hz)',
  'Model Name',
  'Switch Group',
  'Capacitance @ 0V (F)',
  'Series Resistance',
  'Show Values',
  'Edit Component',
  'Edit Resistor',
  'Resistance',
]

for (const k of test) {
  const v = LS(k)
  console.log((map.has(k) ? '[OK]  ' : '[MISS] ') + JSON.stringify(k) + ' -> ' + JSON.stringify(v))
}
console.log('\nlocale keys:', map.size)
