const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

const oldBlock = [
  '  const probes = collectProbePoints()',
  '  if (probes.length === 0) {',
  "    toast('电路里还没有可用的测量点：先放元件')",
  '    return',
  '  }',
].join('\n')

const newBlock = [
  '  const probes = collectProbePoints().filter((p) => p.kind === \'probe\')',
  '  if (probes.length === 0) {',
  "    toast('电路里还没有探头：先在\"元件快选\"里放\"示波器探头\"')",
  '    return',
  '  }',
].join('\n')

if (s.includes(oldBlock)) {
  s = s.replace(oldBlock, newBlock)
  console.log('addProbeChannel now requires a real probe element')
} else {
  console.log('anchor not found — checking current text')
  const idx = s.indexOf('function addProbeChannel')
  console.log(s.slice(idx, idx + 320))
}

fs.writeFileSync(P, s)
console.log('done')
