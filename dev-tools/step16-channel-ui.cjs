const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

const start = s.indexOf('/** 渲染每个通道的"正端 / 负端"选择行。 */')
const endMarker = '/** 依据正负端选择刷新通道显示名。 */'

if (start < 0 || !s.includes(endMarker)) {
  console.error('anchors not found')
  process.exit(1)
}

const end = s.indexOf(endMarker)

const newCode = `/**
 * 渲染通道编辑行。
 *
 * 电压通道和电流通道的界面不同，因为它们的物理接线不同：
 *   - 电压通道：两个探头，显示 正端 − 负端，单位 V
 *   - 电流通道：一个元件，显示流过它的电流，单位 A
 *
 * 两种都带 ON/OFF 开关和删除按钮，和真实示波器的通道控制一致。
 */
function renderProbeRows() {
  if (!ui.probeRows) return
  ui.probeRows.innerHTML = ''
  if (state.channels.length === 0) {
    ui.probeRows.appendChild(el('div', {
      class: 'dc-probe-empty',
      text: '点下面的"+ 电压通道"或"+ 电流通道"。电压通道接两个探头（正端−负端），电流通道选一个元件。',
    }))
    return
  }

  const points = collectProbePoints()
  const probeOpts = points.filter((p) => p.kind === 'probe' || p.kind === 'gnd')
  const currentOpts = points.filter((p) => p.kind === 'current')

  const buildProbeOpts = () => probeOpts.map((p) => el('option', { value: p.id, text: p.label }))
  const buildCurrentOpts = () => currentOpts.map((p) => el('option', { value: p.id, text: p.label }))

  state.channels.forEach((ch, ci) => {
    const isCurrent = channelIsCurrent(ch)
    const dot = el('span', { class: 'dc-dot' })
    dot.style.background = ch.color

    const onBtn = el('button', {
      class: 'dc-ch-toggle' + (ch.enabled ? ' is-on' : ''),
      type: 'button',
      title: ch.enabled ? '关闭这个通道' : '开启这个通道',
      text: ch.enabled ? 'ON' : 'OFF',
      onclick: () => {
        ch.enabled = !ch.enabled
        renderChannels()
        renderProbeRows()
        renderScopeReadouts()
        drawScope()
      },
    })

    const removeBtn = el('button', {
      class: 'dc-chip-x', type: 'button', text: '×', title: '删除这个通道',
      onclick: () => removeChannel(ch.key),
    })

    const head = [
      dot,
      el('span', { class: 'dc-probe-ch', text: 'CH' + (ci + 1) }),
      el('span', { class: 'dc-ch-unit' + (isCurrent ? ' is-current' : ''), text: isCurrent ? 'A' : 'V' }),
    ]

    if (isCurrent) {
      const sel = el('select', { class: 'dc-scope-select dc-probe-sel', title: '选择要测电流的元件' }, buildCurrentOpts())
      const wantId = ch.currentType + '#' + ch.currentIndex + ':i'
      sel.value = currentOpts.some((p) => p.id === wantId) ? wantId : (currentOpts[0] ? currentOpts[0].id : '')
      sel.addEventListener('change', () => {
        const p = currentOpts.find((x) => x.id === sel.value)
        if (p) {
          ch.currentType = p.type
          ch.currentIndex = p.index
        }
        updateChannelLabel(ch)
        renderChannels()
        renderProbeRows()
        renderScopeReadouts()
        drawScope()
      })
      ui.probeRows.appendChild(el('div', { class: 'dc-probe-row' }, [
        ...head, sel, onBtn, removeBtn,
      ]))
    } else {
      const makeProbeSel = (current, onPick, tip) => {
        const sel = el('select', { class: 'dc-scope-select dc-probe-sel', title: tip }, buildProbeOpts())
        const valid = probeOpts.some((p) => p.id === current)
        sel.value = valid ? current : '__gnd__'
        sel.addEventListener('change', () => {
          onPick(sel.value)
          updateChannelLabel(ch)
          renderChannels()
          renderProbeRows()
          renderScopeReadouts()
          drawScope()
        })
        return sel
      }
      const posSel = makeProbeSel(ch.positive, (v) => { ch.positive = v }, '正端探头')
      const negSel = makeProbeSel(ch.negative, (v) => { ch.negative = v }, '负端探头')
      ui.probeRows.appendChild(el('div', { class: 'dc-probe-row' }, [
        ...head,
        el('span', { class: 'dc-probe-plus', text: '＋' }),
        posSel,
        el('span', { class: 'dc-probe-minus', text: '−' }),
        negSel,
        onBtn,
        removeBtn,
      ]))
    }
  })

  // 底部提示：缺什么就告诉用户去放什么
  const hasProbe = probeOpts.some((p) => p.kind === 'probe')
  const hasCurrent = currentOpts.length > 0
  if (!hasProbe || !hasCurrent) {
    const hint = []
    if (!hasProbe) hint.push('电路里还没有探头 → 放"示波器探头"才能测电压')
    if (!hasCurrent) hint.push('电路里还没有元件 → 放元件后才能测电流')
    ui.probeRows.appendChild(el('div', { class: 'dc-probe-hint', text: hint.join('；') }))
  }
}

`

s = s.slice(0, start) + newCode + s.slice(end)
fs.writeFileSync(P, s)
console.log('renderProbeRows rewritten')
