const fs = require('node:fs')

const PANEL = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
const SNIPPET = 'D:/circuit电路模拟/dev-tools/presets-snippet.js'

let s = fs.readFileSync(PANEL, 'utf8')
const snippet = fs.readFileSync(SNIPPET, 'utf8')

if (s.includes('const PRESET_CIRCUITS')) {
  console.log('already present — nothing to do')
  process.exit(0)
}

// 1) 插入预设数据与渲染函数（放在 WINDOW_DEFS 之前）
const anchor = 'const WINDOW_DEFS = ['
if (!s.includes(anchor)) {
  console.error('WINDOW_DEFS anchor missing')
  process.exit(1)
}
s = s.replace(anchor, snippet + anchor)

// 2) 在窗口列表里加一个"经典电路"窗口
const scopeDef = [
  '{',
  "    id: 'dc-win-scope',",
  "    title: '示波器',",
  '    build: () => renderScopeSection(),',
  '    default: { x: 322, y: 12, w: 520, h: 420 },',
  '  },',
].join('\n')
if (!s.includes(scopeDef)) {
  console.error('scope window def not found')
  process.exit(1)
}
const newDef = scopeDef + [
  '\n  {',
  "    id: 'dc-win-presets',",
  "    title: '经典电路',",
  '    build: () => renderPresetsSection(),',
  '    default: { x: 860, y: 12, w: 400, h: 560 },',
  '  },',
].join('\n')
s = s.replace(scopeDef, newDef)

// 3) APP_ASSET_BASE 常量（如果没有就补）
if (!s.includes('APP_ASSET_BASE')) {
  const constAnchor = "const SIM_FRAME_ID = 'simframe'"
  s = s.replace(constAnchor, constAnchor + "\n// 静态资源根路径（与 lib/index.js 的 APP_BASE 一致）\nconst APP_ASSET_BASE = '/dsh-circuit/app'")
  console.log('APP_ASSET_BASE added')
}

fs.writeFileSync(PANEL, s)
console.log('presets injected')
