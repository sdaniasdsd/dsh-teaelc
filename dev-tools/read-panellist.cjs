const fs = require('node:fs')

const ASAR = 'C:/Users/AA/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'
const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const dataStart = 8 + headerSize
const hb = Buffer.alloc(headerSize)
fs.readSync(fd, hb, 0, headerSize, 16)
const text = hb.toString('utf8')
const json = JSON.parse(text.slice(0, text.lastIndexOf('}') + 1))

function read(rel) {
  let n = json
  for (const p of rel.split('/').filter(Boolean)) n = n.files[p]
  if (!n || !n.size) return ''
  const b = Buffer.alloc(n.size)
  fs.readSync(fd, b, 0, n.size, dataStart + Number(n.offset))
  return b.toString('utf8')
}

const target = process.argv[2] || 'dsh/node_modules/@deepseek-ai/dsh-client-ui-schedule/lib/client.js'
const src = read(target)
console.log('size:', src.length)

let idx = 0
let count = 0
while (count < 4) {
  idx = src.indexOf('sidebar.panellist', idx + 1)
  if (idx < 0) break
  count += 1
  console.log('\n=== occurrence', count, 'at', idx, '===')
  console.log(src.substring(Math.max(0, idx - 800), idx + 1200))
}
