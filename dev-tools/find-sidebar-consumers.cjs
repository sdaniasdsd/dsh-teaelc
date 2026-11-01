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

const files = []
;(function walk(n, p) {
  if (n.files) Object.keys(n.files).forEach((k) => walk(n.files[k], p + '/' + k))
  else files.push(p)
})(json, '')

function read(rel) {
  let n = json
  for (const p of rel.split('/').filter(Boolean)) n = n.files[p]
  if (!n || !n.size) return ''
  const b = Buffer.alloc(n.size)
  fs.readSync(fd, b, 0, n.size, dataStart + Number(n.offset))
  return b.toString('utf8')
}

// 找所有注册/订阅 'sidebar' 或 'rightbar' slot 的客户端包
const patterns = ['name: "sidebar"', "name: 'sidebar'", 'slots.inject("sidebar"', 'slots.subscribe("sidebar"', 'name: "rightbar"', 'slots.inject("rightbar"']
const hits = new Map()
for (const f of files.filter((x) => x.includes('/dsh-client-') && x.endsWith('/client.js'))) {
  let s
  try {
    s = read(f)
  } catch {
    continue
  }
  for (const pat of patterns) {
    if (s.includes(pat)) {
      if (!hits.has(f)) hits.set(f, [])
      hits.get(f).push(pat)
    }
  }
}
console.log('files referencing sidebar/rightbar slot:', hits.size)
for (const [f, pats] of hits) {
  console.log(' ', f.replace('/dsh/node_modules/@deepseek-ai/', ''), '->', pats.join(' | '))
}
