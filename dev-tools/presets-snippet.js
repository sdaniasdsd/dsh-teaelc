/**
 * 预设电路。
 *
 * 每个条目都指向 assets/app/circuits/ 下的一个文件——这些是 CircuitJS1 上游自带的
 * 示例电路（GPL-2.0，随插件一起分发）。这里只做分类与中文命名，不重新编造网表，
 * 所以每个电路都是上游长期验证过的，不会因为手写网表出错。
 *
 * 点击条目 = 把该电路加载到画布，学生可以直接在上面拖动元件、改参数、接探头。
 */
const PRESET_CIRCUITS = [
  {
    level: '初中',
    items: [
      { file: 'ohms.txt', name: '欧姆定律', note: '一个电阻加电源，改电压看电流跟着变' },
      { file: 'resistors.txt', name: '串并联电阻', note: '串联和并联的等效电阻比较' },
      { file: 'voltdivide.txt', name: '分压电路', note: '两个电阻串联，中间取出一半电压' },
      { file: 'potdivide.txt', name: '滑动变阻器分压', note: '拖动滑杆改变分压比' },
      { file: 'cap.txt', name: '电容器充放电', note: '看电容两端电压慢慢变化' },
      { file: 'induct.txt', name: '电感与电流', note: '电感阻碍电流突变' },
      { file: 'ledarray.txt', name: 'LED 点亮', note: '多个 LED 与限流电阻' },
    ],
  },
  {
    level: '高中',
    items: [
      { file: 'res-series.txt', name: 'LRC 串联谐振', note: '电阻、电感、电容串联，看谐振' },
      { file: 'lrc.txt', name: 'LRC 振荡电路', note: '电容与电感能量来回转换' },
      { file: 'capseries.txt', name: '电容串联', note: '串联电容的等效值' },
      { file: 'cappar.txt', name: '电容并联', note: '并联电容的等效值' },
      { file: 'indseries.txt', name: '电感串联', note: '串联电感的等效值' },
      { file: 'indpar.txt', name: '电感并联', note: '并联电感的等效值' },
      { file: 'rectify.txt', name: '半波整流', note: '二极管只让电流单向通过' },
      { file: 'thevenin.txt', name: '戴维南定理', note: '复杂电路等效成一个电源加内阻' },
      { file: 'norton.txt', name: '诺顿定理', note: '复杂电路等效成电流源并联电阻' },
    ],
  },
  {
    level: '大学',
    items: [
      { file: 'opamp.txt', name: '运算放大器', note: '理想运放的放大与反馈' },
      { file: 'opampfeedback.txt', name: '运放反馈电路', note: '负反馈对增益的影响' },
      { file: 'fullrect.txt', name: '全波整流', note: '桥式整流把交流变直流' },
      { file: 'amp-fullrect.txt', name: '全波整流加滤波', note: '加电容滤波后的输出波形' },
      { file: 'diodecurve.txt', name: '二极管伏安特性', note: '实测二极管 I-V 曲线' },
      { file: 'res-par.txt', name: '并联谐振', note: '并联 LC 的谐振特性' },
      { file: 'wienbridge.txt', name: '文氏桥振荡器', note: 'RC 选频网络产生正弦波' },
    ],
  },
]

/**
 * 预设电路面板。
 *
 * 按学段分组列出经典电路，点一下即加载到画布。
 * 加载走内核的 importCircuit(text, false)，与用户手动
 * "Import From Text" 是同一条路径，所以电路会正常居中并保持可编辑。
 */
function renderPresetsSection() {
  const wrap = el('div', { class: 'dc-preset-wrap' })
  const status = el('div', { class: 'dc-preset-status', text: '' })

  const load = async (item, btn) => {
    const w = simWindow()
    if (!w || !w.CircuitJS1) {
      toast('内核还没准备好')
      return
    }
    try {
      btn.classList.add('is-loading')
      status.textContent = `正在加载「${item.name}」…`
      const url = `${APP_ASSET_BASE}/circuits/${item.file}`
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      w.CircuitJS1.importCircuit(text, false)
      status.textContent = `已加载「${item.name}」——可以直接拖动元件、改参数`
      toast(`已加载「${item.name}」`)
      refreshElements()
      renderTable()
      state.samples = []
      drawScope()
    } catch (err) {
      status.textContent = `加载失败：${err.message}`
      toast(`加载「${item.name}」失败：${err.message}`)
    } finally {
      btn.classList.remove('is-loading')
    }
  }

  for (const group of PRESET_CIRCUITS) {
    wrap.appendChild(el('div', { class: 'dc-preset-level', text: group.level }))
    const list = el('div', { class: 'dc-preset-list' })
    for (const item of group.items) {
      const btn = el('button', {
        class: 'dc-preset-btn',
        type: 'button',
        title: item.note,
        onclick: () => load(item, btn),
      }, [
        el('span', { class: 'dc-preset-name', text: item.name }),
        el('span', { class: 'dc-preset-note', text: item.note }),
      ])
      list.appendChild(btn)
    }
    wrap.appendChild(list)
  }
  wrap.appendChild(status)

  return el('section', { class: 'dc-section', id: 'dc-presets-section' }, [
    el('div', { class: 'dc-section-head' }, [
      el('h2', { text: '经典电路' }),
      el('span', { class: 'dc-hint', text: '点击加载' }),
    ]),
    el('div', { class: 'dc-section-body' }, [wrap]),
  ])
}

