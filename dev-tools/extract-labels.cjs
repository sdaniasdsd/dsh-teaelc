const fs = require('node:fs')
const src = fs.readFileSync('D:/circuit电路模拟/dsh-circuit/assets/app/circuitjs.js', 'utf8')
const pats = [
  /new k\(\s*`([^`]{2,70})`/g,
  /new EditInfo\(\s*`([^`]{2,70})`/g,
  /new Checkbox\(\s*`([^`]{2,70})`/g,
  /new Checkbox\(`([^`]{2,70})`/g,
  /getEditInfo\(e\)\{[^}]{0,80}?`([^`]{4,60})`/g,
]
const found = new Set()
for (const re of pats) {
  let m
  while ((m = re.exec(src))) {
    const s = m[1].trim()
    if (s && !/^[\s`]*$/.test(s)) found.add(s)
  }
}
const out = [...found].sort()
console.log('TOTAL', out.length)
fs.writeFileSync('D:/circuit电路模拟/dev-tools/dev/dialog-labels.txt', out.join('\n'))
console.log(out.slice(0, 80).join('\n'))
