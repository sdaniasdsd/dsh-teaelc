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

const targets = [
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js',
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js',
]

const slotRe = /"([a-zA-Z0-9._-]+)"/g
for (const t of targets) {
  const src = read(t)
  if (!src) {
    console.log('MISSING', t)
    continue
  }
  console.log('===', t, 'size', src.length)
  // 抓形如 a.b.c 的字符串
  const dotted = [...src.matchAll(/"([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9._-]+)"/g)].map((m) => m[1])
  const uniq = [...new Set(dotted)]
  const relevant = uniq.filter((s) => /(sidebar|shell|main|pane|tab)/i.test(s))
  console.log('relevant:', relevant.length)
  relevant.slice(0, 60).forEach((s) => console.log('  ', s))
}
