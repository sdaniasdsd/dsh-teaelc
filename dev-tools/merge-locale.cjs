const fs = require('node:fs')
const path = require('node:path')

const DIR = 'D:/circuit电路模拟/dsh-circuit/assets/app/locale'

function parse(file) {
  const map = new Map()
  const text = fs.readFileSync(file, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('"')) continue
    const i = line.indexOf('"', 1)
    if (i < 0) continue
    const k = line.substring(1, i)
    const v = line.substring(i + 3, line.length - 1)
    if (k) map.set(k, v)
  }
  return map
}

const base = parse(path.join(DIR, 'locale_zh.txt'))
const dlg = parse(path.join(DIR, 'locale_zh_dialog.txt'))
let dup = 0
let conflict = 0
for (const [k, v] of dlg) {
  if (base.has(k)) {
    dup++
    if (base.get(k) !== v) {
      conflict++
      console.log('CONFLICT', JSON.stringify(k), '|', base.get(k), '|', v)
    }
  } else {
    base.set(k, v)
  }
}
console.log('base:', parse(path.join(DIR, 'locale_zh.txt')).size, 'dialog:', dlg.size, 'dup:', dup, 'conflict:', conflict)

const lines = [...base].map(([k, v]) => `"${k}"="${v}"`).join('\n') + '\n'
fs.writeFileSync(path.join(DIR, 'locale_zh.txt'), lines)
console.log('merged total:', base.size)
