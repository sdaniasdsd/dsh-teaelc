const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

const fn = [
'/**',
' * 视觉上移除内核顶栏菜单，但**保留它的 DOM**。',
' *',
' * 为什么不能直接把 hideMenu=true 传给内核：那样内核根本不创建菜单 DOM，',
' * 而 LED / 灯泡 / 电流表 / 电压表 这些元件只存在于菜单里（工具栏只有 9 个图标，',
' * 但面板提供 18 种元件），放置功能会直接失效。',
' *',
' * 所以这里改成注入一条 CSS：把菜单栏移出可视区但仍在文档里，',
' * 用户看不到那排英文菜单，代码仍然能点它来放置元件。',
' */',
'function hideKernelMenuBar() {',
'  const w = simWindow()',
'  if (!w) return',
'  let doc',
'  try { doc = w.document } catch { return }',
'  if (!doc) return',
'  const id = \'dsh-circuit-kernel-style\'',
'  const apply = () => {',
'    try {',
'      const old = doc.getElementById(id)',
'      if (old) old.remove()',
'      const style = doc.createElement(\'style\')',
'      style.id = id',
'      style.textContent = `',
'        /* 顶栏菜单：移出可视区，但保留 DOM（放置元件要用） */',
'        .gwt-MenuBar.gwt-MenuBar-horizontal {',
'          position: absolute !important;',
'          left: -99999px !important;',
'          top: 0 !important;',
'          width: 1px !important;',
'          height: 1px !important;',
'          overflow: hidden !important;',
'          opacity: 0 !important;',
'          pointer-events: none !important;',
'        }',
'        /* 保留主工具栏（Add Resistor / Add Wire 等图标在这里） */',
'        .mainToolbar { display: flex !important; }',
'      `',
'      ;(doc.head || doc.documentElement).appendChild(style)',
'    } catch {',
'      // 注入失败不阻塞其余功能；此时用户能看到菜单栏，但一切仍可用。',
'    }',
'  }',
'  apply()',
'  // 内核对布局有几次重排，稍后再兜一次。',
'  setTimeout(apply, 800)',
'  setTimeout(apply, 2500)',
'}',
'',
''].join('\n')

if (!s.includes('function hideKernelMenuBar')) {
  s = s.replace('function boot() {', fn + 'function boot() {')
  fs.writeFileSync(P, s)
  console.log('hideKernelMenuBar defined')
} else {
  console.log('already defined')
}
