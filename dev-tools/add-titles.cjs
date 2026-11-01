const fs = require('node:fs')

const FILE = 'D:/circuit电路模拟/dsh-circuit/assets/app/locale/locale_zh.txt'

// 对话框标题：内核在 EditDialog 里用 T.LS(n)，其中 n 可能是
// "Edit Component" 或 "Edit " + 元件类型首字母大写（如 "Edit Resistor"）。
const TITLES = {
  'Edit Component': '编辑元件',
  'Edit Resistor': '编辑电阻',
  'Edit Capacitor': '编辑电容',
  'Edit Inductor': '编辑电感',
  'Edit Voltage': '编辑电源',
  'Edit Switch': '编辑开关',
  'Edit Diode': '编辑二极管',
  'Edit LED': '编辑 LED',
  'Edit Lamp': '编辑灯泡',
  'Edit Ammeter': '编辑电流表',
  'Edit Probe': '编辑电压表',
  'Edit Ground': '编辑接地',
  'Edit Current': '编辑电流源',
  'Edit Pot': '编辑电位器',
  'Edit Transistor': '编辑三极管',
  'Edit Mosfet': '编辑 MOS 管',
  'Edit Op Amp': '编辑运放',
  'Edit Transformer': '编辑变压器',
  'Edit Fuse': '编辑保险丝',
  'Edit Relay': '编辑继电器',
  'Edit Relay Coil': '编辑继电器线圈',
  'Edit Relay Contact': '编辑继电器触点',
  'Edit Scope': '编辑示波器',
  'Edit Text': '编辑文字',
  'Edit Box': '编辑方框',
  'Edit Labeled Node': '编辑标注节点',
  'Edit Logic Input': '编辑逻辑输入',
  'Edit Logic Output': '编辑逻辑输出',
  'Edit Label': '编辑标签',
  'Edit Battery': '编辑电池',
  'Edit Spark Gap': '编辑火花间隙',
  'Edit Crystal': '编辑晶振',
  'Edit Photoresistor': '编辑光敏电阻',
  'Edit Thermistor': '编辑热敏电阻',
  'Edit Memristor': '编辑忆阻器',
  'Edit Analog Switch': '编辑模拟开关',
  'Edit Current Source': '编辑电流源',
  'Edit Voltage Source': '编辑电压源',
}

const txt = fs.readFileSync(FILE, 'utf8')
const map = new Map()
for (const line of txt.split(/\r?\n/)) {
  if (line.charAt(0) !== '"') continue
  const i = line.indexOf('"', 1)
  if (i < 0) continue
  const k = line.substring(1, i)
  const v = line.substring(i + 3, line.length - 1)
  map.set(k, v)
}

let added = 0
for (const [k, v] of Object.entries(TITLES)) {
  if (!map.has(k)) {
    map.set(k, v)
    added++
  }
}

const out = [...map].map(([k, v]) => `"${k}"="${v}"`).join('\n') + '\n'
fs.writeFileSync(FILE, out)
console.log('added titles:', added, 'total keys:', map.size)
