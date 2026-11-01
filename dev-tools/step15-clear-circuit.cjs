const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

const fn = [
  '/**',
  ' * 清空画布：通过内核的「文件 → New Blank Circuit」菜单执行。',
  ' *',
  ' * 为什么不直接用 importCircuit：内核的 importCircuit(text, isSubcircuitLibrary)',
  ' * 第二个参数是"这是子电路库吗"，并不控制是否清空；直接导入会把新电路叠加到',
  ' * 原有电路上。走菜单"新建空白电路"才是内核官方的清场路径，会同时重置仿真时间、',
  ' * 撤销记录和电路标题。',
  ' *',
  ' * 菜单被 CSS 移出可视区但 DOM 仍在，所以这里的点击依然有效。',
  ' */',
  'function clearCircuit(w) {',
  '  try {',
  '    const doc = w.document',
  '    const fileMenu = [...doc.querySelectorAll(\'.gwt-MenuItem\')]',
  '      .find((x) => (x.textContent || \'\').trim().startsWith(\'文件\') || (x.textContent || \'\').trim().startsWith(\'File\'))',
  '    if (!fileMenu) return false',
  '    fileMenu.dispatchEvent(new MouseEvent(\'click\', { bubbles: true }))',
  '    const blank = [...doc.querySelectorAll(\'.menuItem\')]',
  '      .find((x) => /New Blank Circuit|新建空白/.test((x.textContent || \'\')))',
  '    if (!blank) {',
  '      closeMenus(doc)',
  '      return false',
  '    }',
  '    blank.dispatchEvent(new MouseEvent(\'click\', { bubbles: true }))',
  '    closeMenus(doc)',
  '    return true',
  '  } catch {',
  '    return false',
  '  }',
  '}',
  '',
  '',
].join('\n')

if (!s.includes('function clearCircuit')) {
  // 放在 renderPresetsSection 之前
  const anchor = '/**\n * 预设电路面板。'
  if (s.includes(anchor)) {
    s = s.replace(anchor, fn + anchor)
    console.log('clearCircuit added')
  } else {
    console.error('anchor missing')
  }
} else {
  console.log('already present')
}

fs.writeFileSync(P, s)
console.log('done')
