/**
 * dsh-circuit 学生面板。
 *
 * 面板与仿真内核（CircuitJS1）通过 iframe 通信，只使用内核公开的 window.CircuitJS1
 * API：getElements()（每个元件对象带 getType/getVoltageDiff/getCurrent/getInfo）、
 * importCircuit(text, reset)、isRunning()、setSimRunning(bool)、getTime()、
 * exportCircuit()。面板自身不重算电路，只读内核给的数——读数因此与屏幕上看到的
 * 颜色/电流点一致，不会出现"面板说 50mA、画面说别的"这种双份事实。
 *
 * 波形采样来自每个动画帧读取 getTime() 与所选元件的电压/电流，按真实仿真时间
 * 打点（不是按帧数），所以示波器里的周期与内核显示的时间步一致。
 */

const SIM_FRAME_ID = 'simframe'
// 静态资源根路径（与 lib/index.js 的 APP_BASE 一致），预设电路从这里取。
const APP_ASSET_BASE = '/dsh-circuit/app'
const SAMPLE_WINDOW_S = 3.0      // 波形最多显示最近 3 秒（仿真时间）
const SAMPLE_MIN_DT = 2e-5       // 仿真时间每前进 20µs 记一个点（避免同一步重复记点）
const ELEMENT_CACHE_MS = 500     // 元件列表刷新节流

const CHANNEL_COLORS = [
  '#4ea1ff', // 电压主通道
  '#f0883e',
  '#39d353',
  '#d2a8ff',
  '#ff7b72',
  '#79c0ff',
]

/** 元件中文名：键为内核 getType() 返回的类名。 */
const TYPE_LABELS = {
  ResistorElm: '电阻',
  CapacitorElm: '电容',
  InductorElm: '电感',
  WireElm: '导线',
  GroundElm: '接地',
  VoltageElm: '电压源',
  DCVoltageElm: '直流电源',
  SwitchElm: '开关',
  DiodeElm: '二极管',
  LEDElm: '发光二极管 LED',
  LampElm: '灯泡',
  AmmeterElm: '电流表',
  ProbeElm: '示波器探头',
  OutputElm: '示波器探头',
  LabeledNodeElm: '标注节点',
  TextElm: '文字',
  BoxElm: '方框',
  CurrentElm: '电流源',
  PotElm: '电位器',
  NMosfetElm: 'MOS 管',
  MosfetElm: 'MOS 管',
  TransistorElm: '三极管',
  NTransistorElm: '三极管',
  PTransistorElm: '三极管',
  OpAmpElm: '运放',
  LogicInputElm: '逻辑输入',
  LogicOutputElm: '逻辑输出',
  ScopeElm: '示波器',
  FuseElm: '保险丝',
  RelayElm: '继电器',
  RelayCoilElm: '继电器线圈',
  RelayContactElm: '继电器触点',
  ACVoltageElm: '交流电源',
  TransformerElm: '变压器',
  DCVoltageElm2: '直流电源',
  SparkGapElm: '火花间隙',
  CrystalElm: '晶振',
  PhotoresistorElm: '光敏电阻',
  ThermistorElm: '热敏电阻',
  MemristorElm: '忆阻器',
}

function typeLabel(type) {
  return TYPE_LABELS[type] || type
}

/** 元件快选：按钮标签 → 内核 Draw 菜单里的条目名。 */
const PARTS = [
  { key: 'wire', label: '导线', glyph: '〰', menu: 'Add Wire' },
  { key: 'resistor', label: '电阻', glyph: '▭', menu: 'Add Resistor' },
  { key: 'ground', label: '接地', glyph: '⏚', menu: 'Add Ground' },
  { key: 'voltage', label: '直流电源', glyph: '＋－', menu: 'Add Voltage Source (2-terminal)' },
  { key: 'ac', label: '交流电源', glyph: '∿', menu: 'Add A/C Voltage Source (2-terminal)' },
  { key: 'capacitor', label: '电容', glyph: '｜｜', menu: 'Add Capacitor' },
  { key: 'inductor', label: '电感', glyph: '〰〰', menu: 'Add Inductor' },
  { key: 'switch', label: '开关', glyph: '／', menu: 'Add Switch' },
  { key: 'diode', label: '二极管', glyph: '▷', menu: 'Add Diode' },
  { key: 'led', label: 'LED', glyph: '☀', menu: 'Add LED' },
  { key: 'lamp', label: '灯泡', glyph: '💡', menu: 'Add Lamp' },
  { key: 'ammeter', label: '电流表', glyph: 'A', menu: 'Add Ammeter' },
  // 内核里 "Voltmeter/Scope Probe" 是同一个元件（ProbeElm）：既能当电压表读数，
  // 也是示波器的测量探头。这里单独列成"示波器探头"，避免用户以为没有探头可放。
  { key: 'probe', label: '示波器探头', glyph: '◎', menu: 'Add Voltmeter/Scope Probe' },
  { key: 'label', label: '标注节点', glyph: '▣', menu: 'Add Labeled Node' },
  { key: 'pot', label: '电位器', glyph: '↗', menu: 'Add Potentiometer' },
  { key: 'text', label: '文字', glyph: 'T', menu: 'Add Text' },
  { key: 'box', label: '方框', glyph: '□', menu: 'Add Box' },
  { key: 'current', label: '电流源', glyph: '⇢', menu: 'Add Current Source' },
]

/* ------------------------------------------------------------------ */
/* 挑战任务：只用真实读数判定，不做"看起来像"这种主观评分。            */
/* 每个条件是一个 (ctx) => {ok, text} 的函数；ctx.elements 是内核元件列表。 */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

const state = {
  api: null,
  elements: [],
  elementAt: 0,
  channels: [],           // { key, type, index, label, color, signal: 'i'|'v' }
  samples: [],            // { t, values: number[] }
  lastSampleAt: 0,
  running: true,
  time: 0,
  placeHint: '',
  toastTimer: null,
  hasBootedOnce: false,
  timerId: null,
  captureArmed: false,
  captureStartT: 0,
  partsCollapsed: false,
  placingMode: false,
  inChannelRender: false,
  // 示波器面板状态（仿真实示波器的档位）
  timebase: 0.1,        // 秒/格（默认 100ms/格，整屏 1 秒）
  voltsPerDiv: 0,       // 0 = 自动量程
  coupling: 'dc',       // 'dc' | 'ac'
  scopeExpanded: false,
  hOffsetDiv: 0,
  vOffsetDiv: 0,
  triggerMode: 'auto',
  triggerArmed: false,
  triggerCapturing: false,
  triggerStartT: 0,
  triggerLastV: null,
  triggerRef: null,
  zoomBox: null,
}

const ui = {}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function fmtA(v) {
  const a = Math.abs(v)
  if (a < 1e-6) return `${(v * 1e9).toFixed(1)} nA`
  if (a < 1e-3) return `${(v * 1e6).toFixed(1)} µA`
  if (a < 1) return `${(v * 1e3).toFixed(2)} mA`
  return `${v.toFixed(3)} A`
}

function fmtV(v) {
  const a = Math.abs(v)
  if (a < 1e-6) return `${(v * 1e9).toFixed(1)} nV`
  if (a < 1e-3) return `${(v * 1e6).toFixed(1)} µV`
  if (a < 1) return `${(v * 1e3).toFixed(2)} mV`
  return `${v.toFixed(3)} V`
}

function fmtTime(t) {
  if (t < 1e-3) return `${(t * 1e6).toFixed(0)} µs`
  if (t < 1) return `${(t * 1e3).toFixed(1)} ms`
  return `${t.toFixed(3)} s`
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v !== undefined && v !== null) node.setAttribute(k, String(v))
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child))
    else if (child) node.appendChild(child)
  }
  return node
}

function toast(message) {
  if (!ui.toast) return
  ui.toast.textContent = message
  ui.toast.classList.add('is-show')
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => ui.toast.classList.remove('is-show'), 2200)
}

/* ------------------------------------------------------------------ */
/* 内核桥接                                                            */
/* ------------------------------------------------------------------ */

function simFrame() {
  return document.getElementById(SIM_FRAME_ID)
}

function simWindow() {
  const frame = simFrame()
  try {
    return frame && frame.contentWindow
  } catch {
    return null
  }
}

/** 等待内核的 window.CircuitJS1 就绪。内核在异步 init 后才挂出该对象。 */
function whenSimReady(callback) {
  const started = Date.now()
  const poll = () => {
    const w = simWindow()
    if (w && w.CircuitJS1) {
      state.api = w.CircuitJS1
      callback(state.api, w)
      return
    }
    if (Date.now() - started > 20000) {
      toast('仿真内核加载超时，请刷新页面')
      return
    }
    setTimeout(poll, 120)
  }
  poll()
}

/** 读取全部元件并缓存测得的电压/电流。 */
function refreshElements() {
  const api = state.api
  if (!api) return []
  let raw
  try {
    raw = api.getElements()
  } catch {
    return state.elements
  }
  const list = []
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i]
    let type = ''
    let vd = 0
    let current = 0
    let info = []
    try {
      type = String(r.getType ? r.getType() : '')
    } catch {
      type = ''
    }
    try {
      vd = Number(r.getVoltageDiff ? r.getVoltageDiff() : 0) || 0
    } catch {
      vd = 0
    }
    try {
      current = Number(r.getCurrent ? r.getCurrent() : 0) || 0
    } catch {
      current = 0
    }
    try {
      info = r.getInfo ? r.getInfo() : []
    } catch {
      info = []
    }
    list.push({ index: i, type, vd, current, info, label: typeLabel(type) })
  }
  state.elements = list
  state.elementAt = Date.now()
  return list
}

/** 从内核的 dump 文本里取出某一元件的"是否被选中"等状态。用于"高频刷新"时规避重活。 */
function simTime() {
  const api = state.api
  if (!api) return 0
  try {
    return Number(api.getTime()) || 0
  } catch {
    return 0
  }
}

function simIsRunning() {
  const api = state.api
  if (!api) return false
  try {
    return Boolean(api.isRunning())
  } catch {
    return false
  }
}

function setSimRunning(flag) {
  const api = state.api
  if (!api) return
  try {
    api.setSimRunning(flag)
  } catch {
    // 内核拒绝时保持界面按钮状态不变由 tick 复读 isRunning 校正。
  }
  state.running = simIsRunning()
}

/**
 * 通过内核的 Draw 菜单放置元件：先点顶栏"绘制"，再在展开的菜单里找目标条目，
 * 点击后元件进入"待放置"状态；随后用户在画布上拖动即可放下。
 *
 * 这是内核官方交互路径的复刻，不是私有 API——因此元件属性、默认值、撤销记录
 * 都与用户手动操作完全一致。
 */
function choosePartFromMenu(menuLabel, displayName) {
  // 选新元件前，先把上一次可能残留的放置状态清掉——否则内核会卡在
  // "待放置"里，画布点不动（这正是用户报的"换不回鼠标"）。
  cancelPlacing()

  const w = simWindow()
  if (!w) {
    toast('仿真内核还没准备好')
    return false
  }
  let doc
  try {
    doc = w.document
  } catch {
    toast('无法访问仿真内核界面（可能是浏览器安全限制）')
    return false
  }
  const topItem = [...doc.querySelectorAll('.gwt-MenuItem')]
    .find((x) => (x.textContent || '').trim().startsWith('绘制') || (x.textContent || '').trim().startsWith('Draw'))
  if (!topItem) {
    toast('找不到内核的"绘制"菜单')
    return false
  }
  topItem.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const target = findMenuItem(doc, menuLabel, displayName)
  if (!target) {
    closeMenus(doc)
    toast(`内核菜单里没有找到"${displayName}"`)
    return false
  }
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  closeMenus(doc)
  state.placingMode = true
  state.placeHint = `已选中"${displayName}"，请在黑色画布上按住拖动来放置`
  renderPlaceHint()
  return true
}

/**
 * 取消内核的"待放置元件"状态，把鼠标交还给正常编辑。
 *
 * 内核（CircuitJS1）在用户从菜单选择元件后进入 MODE_ADD_ELM，此时画布会一直
 * 跟随鼠标画一个待放置的元件，左键点击/拖动是在放新元件，而不是选择已有元件。
 * 退出这件事只有一条官方路径：按 **Esc**。内核的 onKeyDown 里对 Esc 调用
 * setMouseMode(MODE_SELECT) 并把提示恢复成 "Select"。
 *
 * 注意 Esc 必须派发到内核文档（iframe 内部），派发到外层页面没用。键盘事件
 * 需要 keyCode=27 —— 内核读的是 e.keyCode 而不是 e.key。
 */
function cancelPlacing() {
  const w = simWindow()
  const wasPlacing = state.placingMode
  state.placingMode = false
  state.placeHint = ''
  renderPlaceHint()
  if (!w) return wasPlacing
  let doc
  try {
    doc = w.document
  } catch {
    return wasPlacing
  }
  try {
    const ev = new w.KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    })
    ;(doc.body || doc).dispatchEvent(ev)
    // 有些内核对 document 级监听更敏感，再补一次到 document。
    doc.dispatchEvent(ev)
  } catch {
    // 拿不到内核文档时无法自动退出，提示用户自己按 Esc。
  }
  if (wasPlacing) toast('已取消放置，鼠标恢复为选择/拖动')
  return wasPlacing
}
/**
 * 在内核菜单（含二级子菜单）里定位目标条目并展开祖先分组。
 *
 * 内核把快捷键字母直接粘在条目名后面（Add Resistor 后面跟一个 r），中文 locale
 * 只翻译菜单标题、不改条目名，所以按“前缀 + 至多 2 个字符”匹配。二级条目
 * （如输出与标注下的 Add Ammeter）必须先展开所在分组才会响应点击。
 */
function findMenuItem(doc, menuLabel, displayName) {
  const wanted = normalizeMenuText(menuLabel)
  if (!wanted) return null
  const leaves = []
  for (const item of doc.querySelectorAll('.menuItem')) {
    // 分组项自身带有子菜单容器，不是可点击的叶条目。
    if (item.querySelector('.menuDropdown')) continue
    const text = normalizeMenuText(item.textContent || '')
    if (text === wanted) return item
    if (!text.startsWith(wanted)) continue
    const extra = text.slice(wanted.length)
    if (extra.length <= 2) leaves.push({ item, extra: extra.length })
  }
  if (leaves.length === 0) return null
  leaves.sort((a, b) => a.extra - b.extra)
  const leaf = leaves[0].item
  expandAncestors(doc, leaf)
  return leaf
}

/** 向上逐层派发 mouseover，让内核把祖先分组菜单展开。 */
function expandAncestors(doc, leaf) {
  let node = leaf.parentElement
  while (node && node !== doc.body) {
    if (node.classList && node.classList.contains('menuItem')) {
      node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    }
    node = node.parentElement
  }
}

function normalizeMenuText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[✓✔√]\s*/g, '')
    .replace(/►/g, '')
    .trim()
}

function closeMenus(doc) {
  for (const node of doc.querySelectorAll('.gwt-MenuItem.open, .topMenuItem.open')) {
    node.classList.remove('open')
  }
}

/* ------------------------------------------------------------------ */
/* 波形采样                                                            */
/* ------------------------------------------------------------------ */

/**
 * 添加示波器通道。
 *
 * 通道绑定的是**测量位置引用**（哪个元件的第几号测点），而不是元件本身。
 * 这样即便电路被清空、元件被删除，通道条目仍然存在，示波器窗口也照常开着，
 * 只是该通道读数变成"断线"——这才是示波器应有的行为。
 */
function addChannel(type, index, signal) {
  const target = state.elements.find((e) => e.index === index && e.type === type)
  if (!target) return
  const key = `${type}#${index}:${signal}`
  if (state.channels.some((c) => c.key === key)) {
    toast('这个通道已经在了')
    return
  }
  if (state.channels.length >= 6) {
    toast('最多同时记录 6 个通道')
    return
  }
  state.channels.push({
    key,
    type,
    index,
    signal,
    label: `${target.label} ${signal === 'i' ? '电流' : '电压'}`,
    color: CHANNEL_COLORS[state.channels.length % CHANNEL_COLORS.length],
    enabled: true,
  })
  state.samples = []
  renderChannels()
  // 表格行里的通道开关高亮要跟着变；同样需要防重入。
  if (!state.inChannelRender) {
    state.inChannelRender = true
    try {
      renderTable()
    } finally {
      state.inChannelRender = false
    }
  }
}

function removeChannel(key) {
  state.channels = state.channels.filter((c) => c.key !== key)
  state.samples = []
  if (state.channels.length === 0) state.samples = []
  renderChannels()
  // 通道开关就画在表格行里，需要重绘表格来更新高亮；但本函数可能正是从
  // 表格按钮里调用的，用重入标记避免无限递归。
  if (!state.inChannelRender) {
    state.inChannelRender = true
    try {
      renderTable()
    } finally {
      state.inChannelRender = false
    }
  }
}

/**
 * 采样一次。值为 NaN 时保留 NaN，绘图时跳过，避免把无效点画成 0。
 *
 * 必须按**仿真时间**判断该不该记点，而不是按墙上时间节流：电路在 5µs 时间步下
 * 1 秒真实时间可能只推进几十毫秒仿真时间，用墙上时间节流会把绝大多数真实推进
 * 丢掉。这里改为"仿真时间前进超过 SAMPLE_MIN_DT 才记一个点"。
 */
function sampleTick() {
  const api = state.api
  if (!api || state.channels.length === 0) return

  const t = simTime()
  const prev = state.samples.length ? state.samples[state.samples.length - 1].t : null
  // 首次采样，或仿真时间已足够前进，才记点。
  if (prev !== null && t - prev < SAMPLE_MIN_DT && t >= prev) return
  // 重置/回到起点（仿真时间倒退）时清空旧样本，避免把两段不相干的数据连成一条线。
  if (prev !== null && t < prev) state.samples = []

  const values = []
  for (const channel of state.channels) {
    // 电流通道：直接读该元件的电流。
    if (channel.measure === 'current') {
      const el = state.elements.find((e) => e.index === channel.currentIndex && e.type === channel.currentType)
      values.push(el ? el.current : Number.NaN)
      continue
    }
    // 电位差通道：V = V(正端) − V(负端)，与真实示波器的正负端接线语义一致。
    // 负端默认接地，因此默认就是"单端对地测量"；选两个探头就是差分测量。
    if (channel.measure === 'voltage' || channel.type === 'probe') {
      const pos = probeValue(channel.positive)
      const neg = probeValue(channel.negative)
      values.push(pos === null || neg === null ? Number.NaN : pos - neg)
      continue
    }
    // 兼容旧式"绑定元件"通道：元件被删除后记 NaN，波形断开，但通道本身保留。
    const el = state.elements.find((e) => e.index === channel.index && e.type === channel.type)
    values.push(el ? (channel.signal === 'i' ? el.current : el.vd) : Number.NaN)
  }
  state.time = t
  state.lastSampleAt = Date.now()
  state.samples.push({ t, values })

  // 单次触发：等第一个通道出现上升穿越，然后记满一屏就暂停仿真。
  // 这是真实示波器 "Single" 模式的语义：抓一个边沿，冻结画面。
  if (state.triggerMode === 'single' && state.triggerArmed && values.length > 0) {
    const v0 = values[0]
    if (Number.isFinite(v0)) {
      if (state.triggerLastV === null || state.triggerLastV === undefined) {
        state.triggerLastV = v0
      } else {
        const meanish = state.triggerRef === null ? v0 : state.triggerRef
        if (v0 > meanish && state.triggerLastV <= meanish) {
          // 检测到上升沿：开始正式记录
          state.triggerArmed = false
          state.samples = [{ t, values }]
          state.triggerStartT = t
          state.triggerCapturing = true
        }
        state.triggerLastV = v0
      }
    }
  }
  if (state.triggerCapturing) {
    const span = t - (state.triggerStartT || t)
    if (span >= (state.timebase || 0.1) * 10) {
      state.triggerCapturing = false
      setSimRunning(false)
      renderSimState()
      toast('单次触发完成：已冻结一屏波形')
    }
  }

  const cutoff = t - (SAMPLE_WINDOW_S * 2.2)
  while (state.samples.length > 2 && state.samples[0].t < cutoff) state.samples.shift()
}

/**
 * 读取一个测量点的数值（探头正端/负端用）。
 * 返回 null 表示"该点当前不可用"（元件被删除或尚未插入电路）。
 */
function probeValue(id) {
  if (!id || id === '__gnd__') return 0
  const m = /^(.+)#(\d+):([vi])$/.exec(id)
  if (!m) return null
  const [, type, idxStr, kind] = m
  const idx = Number(idxStr)
  const e = state.elements.find((x) => x.type === type && x.index === idx)
  if (!e) return null
  if (kind === 'i') return e.current
  // 单端元件（探头本身）的 vd 就是它对地的电位
  return e.vd
}

/* ------------------------------------------------------------------ */
/* 绘图                                                                */
/* ------------------------------------------------------------------ */

/**
 * 绘制示波器。
 *
 * 按真实示波器的习惯组织：
 *  - 屏幕分 10 格（竖） × 8 格（横），主格线略亮、中间加细分刻度；
 *  - 横轴由"时基"档位决定（每格代表多少秒）；
 *  - 纵轴由"电压/格"档位决定，选"自动"时按数据自适应；
 *  - 耦合方式 AC 时先扣除每个通道的均值（示波器上的 AC 耦合就是干这个）。
 *
 * 所有数值都从真实采样来，自动量程失败或数据不足时不画假线。
 */
/**
 * 用鼠标滚轮缩放时间轴。
 *
 * 向上滚（deltaY < 0）→ 选更短的时基 → 放大细节；
 * 向下滚 → 选更长的时基 → 看到更宽的时段。
 * 直接在 TIMEBASE 档位表里跳一档，所以缩放是"咔哒"式的，和真实示波器的
 * 时基旋钮手感一致，不会得到 37.4ms/格 这种怪值。
 */
/**
 * 框选放大（zoom box）。
 *
 * 在波形上按住拖动会画出一个矩形，松开后把视图放大到这个矩形覆盖的
 * 时间-电压范围。真实示波器上这叫 "Zoom / Window" 功能。
 *
 * 实现要点：
 *  - 记录鼠标在画布上的像素坐标，绘制时转成时间和电压；
 *  - 松开时按框的宽度改时基（跳到能装下该时间段的档位），
 *  - 按框的高度改垂直档位（选能覆盖该电压范围的"伏/格"）；
 *  - 同时把水平/垂直位置调到框的中心，让放大后的画面居中。
 *  - 框太窄（<8px）视为误触，忽略。
 */
function canvasPos(canvas, ev) {
  const r = canvas.getBoundingClientRect()
  return {
    x: ev.clientX - r.left,
    y: ev.clientY - r.top,
    w: r.width,
    h: r.height,
  }
}

function beginZoomBox(ev) {
  const canvas = ui.scopeCanvas
  if (!canvas) return
  if (ev.button !== 0) return
  const p = canvasPos(canvas, ev)
  state.zoomBox = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, active: true }
}

function updateZoomBox(ev) {
  if (!state.zoomBox || !state.zoomBox.active) return
  const canvas = ui.scopeCanvas
  const p = canvasPos(canvas, ev)
  state.zoomBox.x1 = p.x
  state.zoomBox.y1 = p.y
  drawScope()
}

function cancelZoomBox() {
  if (state.zoomBox) {
    state.zoomBox = null
    drawScope()
  }
}

function endZoomBox(ev) {
  const box = state.zoomBox
  if (!box || !box.active) return
  box.active = false
  const canvas = ui.scopeCanvas
  const p = canvasPos(canvas, ev)
  box.x1 = p.x
  box.y1 = p.y

  const dx = Math.abs(box.x1 - box.x0)
  const dy = Math.abs(box.y1 - box.y0)
  state.zoomBox = null

  // 太小的框视为误触，不做处理
  if (dx < 8 && dy < 8) {
    drawScope()
    return
  }

  const scopeView = state.scopeView
  if (!scopeView) {
    drawScope()
    return
  }

  // ---- 横向：按框宽度选时基并居中 ----
  if (dx >= 8) {
    const xa = Math.min(box.x0, box.x1) / p.w
    const xb = Math.max(box.x0, box.x1) / p.w
    const frac = xb - xa
    const curSpan = scopeView.tRight - scopeView.tStart
    const boxSpan = curSpan * frac
    // 选一个能装下 boxSpan 且尽量填满屏幕的档位（10 格）
    const needPerDiv = boxSpan / 10
    const fit = TIMEBASE.filter((t) => t.v >= needPerDiv * 0.85)
    if (fit.length > 0) {
      state.timebase = fit[0].v
      if (ui.timebaseSelect) ui.timebaseSelect.value = String(state.timebase)
      // 把框中心对齐到屏幕中心
      const centerFrac = (xa + xb) / 2
      const centerT = scopeView.tStart + curSpan * centerFrac
      const newSpan = state.timebase * 10
      const desiredStart = centerT - newSpan / 2
      const nowStart = scopeView.tEnd - newSpan
      state.hOffsetDiv = (desiredStart - nowStart) / (newSpan || 1)
      if (ui.hposRange) {
        ui.hposRange.value = String(Math.max(-50, Math.min(50, Math.round(state.hOffsetDiv * 100))))
      }
    }
  }

  // ---- 纵向：按框高度选电压/格 ----
  if (dy >= 8 && scopeView.hi !== undefined) {
    const ya = Math.min(box.y0, box.y1) / p.h
    const yb = Math.max(box.y0, box.y1) / p.h
    // 像素 y=0 是顶部(hi)，y=h 是底部(lo)
    const vTop = scopeView.hi - (scopeView.hi - scopeView.lo) * ya
    const vBot = scopeView.hi - (scopeView.hi - scopeView.lo) * yb
    const boxVspan = Math.abs(vTop - vBot)
    const needPerDivV = boxVspan / 8
    const fitV = VOLTS_PER_DIV.filter((v) => v >= needPerDivV * 0.85)
    if (fitV.length > 0) {
      state.voltsPerDiv = fitV[0]
      if (ui.vdivSelect) ui.vdivSelect.value = String(state.voltsPerDiv)
      const centerV = (vTop + vBot) / 2
      state.vOffsetDiv = centerV / (state.voltsPerDiv * 8)
      if (ui.vposRange) {
        ui.vposRange.value = String(Math.max(-50, Math.min(50, Math.round(state.vOffsetDiv * 100))))
      }
    }
  }

  drawScope()
  toast('已放大到选中区域（滚轮可继续缩放）')
}

function zoomTimebase(direction) {
  const current = state.timebase || 0.1
  let idx = TIMEBASE.findIndex((t) => Math.abs(t.v - current) < 1e-12)
  if (idx < 0) {
    // 不在档位表里（自动时基临时改过），找最接近的
    idx = TIMEBASE.reduce((best, t, i) =>
      Math.abs(t.v - current) < Math.abs(TIMEBASE[best].v - current) ? i : best, 0)
  }
  const next = Math.max(0, Math.min(TIMEBASE.length - 1, idx + (direction < 0 ? -1 : 1)))
  if (next === idx) return
  state.timebase = TIMEBASE[next].v
  if (ui.timebaseSelect) ui.timebaseSelect.value = String(state.timebase)
  drawScope()
}

function drawScope() {
  const canvas = ui.scopeCanvas
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || 360
  const cssH = canvas.clientHeight || 168
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const COLS = 10
  const ROWS = 8
  const cellW = cssW / COLS
  const cellH = cssH / ROWS

  // 背景
  ctx.fillStyle = '#060a0f'
  ctx.fillRect(0, 0, cssW, cssH)

  // 细分刻度（每格 5 等分）
  ctx.strokeStyle = '#101a22'
  ctx.lineWidth = 1
  for (let i = 0; i <= COLS * 5; i += 1) {
    const x = (i / (COLS * 5)) * cssW
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, cssH)
    ctx.stroke()
  }
  for (let i = 0; i <= ROWS * 5; i += 1) {
    const y = (i / (ROWS * 5)) * cssH
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(cssW, y)
    ctx.stroke()
  }
  // 主格线
  ctx.strokeStyle = '#1b2a36'
  for (let i = 1; i < COLS; i += 1) {
    const x = i * cellW
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, cssH)
    ctx.stroke()
  }
  for (let i = 1; i < ROWS; i += 1) {
    const y = i * cellH
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(cssW, y)
    ctx.stroke()
  }

  // 没有数据时也要暴露一个视图范围，否则框选放大拿不到坐标反算的依据。
  // 用"当前仿真时刻往前一屏"作为空态视图，坐标系统仍然有意义。
  if (state.channels.length === 0 || state.samples.length < 2) {
    const baseTime = simTime()
    const baseSpan = (state.timebase || 0.1) * COLS
    state.scopeView = {
      tStart: baseTime - baseSpan,
      tRight: baseTime,
      tEnd: baseTime,
      lo: -1,
      hi: 1,
      viewSpan: baseSpan,
      cssW,
      cssH,
    }
    return
  }

  // ---- 时间窗：由时基决定（10 格） ----
  // 真实示波器不会"数据不够也硬按 1s/格 显示"，那样曲线只会缩在右边一条竖线。
  // 这里做和真实设备相同的处理：采样跨度明显小于一屏时，自动降到能填满屏幕
  // 的档位（只影响这一次绘制，不回写用户的档位选择）。
  // ---- 时间轴 ----
  // 真实示波器有两种行为，这里都实现：
  //   1) 数据不足一屏时，轨迹从**左侧**开始向右画（就像扫描线扫过屏幕），
  //      而不是把整段数据挤到最右边——这是用户反馈的"波形一直在右侧不动"。
  //   2) 数据填满一屏后，左侧固定为"当前时刻 − 一屏时间"，轨迹持续向左滚动。
  //
  // 时基档位：优先用用户的档位；但数据明显填不满一屏时，按**数据实际跨度**
  // 连续收缩视窗，而不是硬套 10 格档位。
  //
  // 为什么不能只用档位：档位是离散的（1ms → 10ms 跳一大级），数据跨度 25ms
  // 时最接近的 10ms/格 会让整屏变成 100ms，曲线只占 25% 宽——看起来就是
  // 贴着左边的一小段。真实示波器有 1-2-5 步进的细腻度，这里用连续值补上。
  const dataSpan = state.samples.length
    ? state.samples[state.samples.length - 1].t - state.samples[0].t
    : 0
  const userTimebase = state.timebase || 0.1
  let timebase = userTimebase
  if (dataSpan > 0 && dataSpan < userTimebase * COLS * 0.75) {
    // 连续收缩：让数据跨度占满约 92% 屏宽（留一点边），且不细于 10µs/格
    timebase = Math.max(dataSpan / COLS / 0.92, 10e-6)
  }
  const viewSpan = timebase * COLS
  const tEnd = state.samples[state.samples.length - 1].t
  const tFirst = state.samples[0].t
  // 关键：还没攒够一屏时，右端对齐"当前时刻"，左端从数据起点开始，
  // 这样轨迹从左边生长出来，视觉上就是实时推进。
  const filled = tEnd - tFirst >= viewSpan
  // 水平位置：把窗口沿时间轴平移（真实示波器的 HORIZONTAL POSITION 旋钮）。
  const hShift = (state.hOffsetDiv || 0) * viewSpan
  const tStart = (filled ? tEnd - viewSpan : tFirst) - hShift
  const tRight = (filled ? tEnd : Math.max(tFirst + viewSpan, tEnd)) - hShift

  // 只取窗口内的样本（两端留一点余量，避免边界切掉一截）
  const pad = (tRight - tStart) * 0.02
  const visible = state.samples.filter((s) => s.t >= tStart - pad && s.t <= tRight + pad)
  if (visible.length < 2) return

  // ---- AC 耦合：每通道减去自己的均值 ----
  const means = state.channels.map((_, ci) => {
    if (state.coupling !== 'ac') return 0
    let sum = 0
    let n = 0
    for (const s of visible) {
      const v = s.values[ci]
      if (Number.isFinite(v)) {
        sum += v
        n += 1
      }
    }
    return n ? sum / n : 0
  })

  // ---- 纵向量程 ----
  // 手动档位：对称量程 ±(伏/格 * 4格)；自动：按数据自适应（单极性从 0 起算）。
  let lo
  let hi
  if (state.voltsPerDiv > 0) {
    const half = state.voltsPerDiv * (ROWS / 2)
    lo = -half
    hi = half
  } else {
    let vMin = Number.POSITIVE_INFINITY
    let vMax = Number.NEGATIVE_INFINITY
    for (const s of visible) {
      for (let ci = 0; ci < state.channels.length; ci += 1) {
        const v = s.values[ci]
        if (!Number.isFinite(v)) continue
        const d = v - means[ci]
        if (d < vMin) vMin = d
        if (d > vMax) vMax = d
      }
    }
    if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) return
    const span = vMax - vMin
    if (span < 1e-15) {
      const pad = Math.max(Math.abs(vMax) * 0.25, 1e-9)
      lo = vMax - pad
      hi = vMax + pad
    } else if (vMin >= 0) {
      lo = 0
      hi = vMax * 1.08
    } else if (vMax <= 0) {
      lo = vMin * 1.08
      hi = 0
    } else {
      const pad = span * 0.06
      lo = vMin - pad
      hi = vMax + pad
    }
  }
  const range = hi - lo || 1

  // 暴露当前视图范围，供框选放大反算时间/电压。
  state.scopeView = { tStart, tRight, tEnd, lo, hi, viewSpan, cssW, cssH }

  const xOf = (t) => ((t - tStart) / (tRight - tStart || viewSpan)) * cssW
  // 垂直位置：轨迹整体上下平移（真实示波器的 VERTICAL POSITION 旋钮）
  const vShift = (state.vOffsetDiv || 0) * cssH
  const yOf = (v) => cssH - 4 - ((v - lo) / range) * (cssH - 8) + vShift

  // 零线
  if (lo < 0 && hi > 0) {
    const zeroY = yOf(0)
    ctx.strokeStyle = '#2f4457'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, zeroY)
    ctx.lineTo(cssW, zeroY)
    ctx.stroke()
  }

  // ---- 逐通道绘制 ----
  let anyDrawn = false
  let allFlat = true
  state.channels.forEach((channel, ci) => {
    if (!channel.enabled) return
    ctx.beginPath()
    ctx.strokeStyle = channel.color
    ctx.lineWidth = 1.6
    ctx.lineJoin = 'round'
    let started = false
    let firstVal = Number.NaN
    for (const s of visible) {
      const raw = s.values[ci]
      if (!Number.isFinite(raw)) {
        started = false
        continue
      }
      const v = raw - means[ci]
      if (Number.isNaN(firstVal)) firstVal = v
      else if (Math.abs(v - firstVal) > Math.abs(firstVal) * 1e-6 + 1e-12) allFlat = false
      const x = xOf(s.t)
      const y = yOf(v)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
      anyDrawn = true
    }
    ctx.stroke()
  })

  // 值全程恒定：画出来没信息量，改为文字提示（不是 bug，是教学提示）
  if (anyDrawn && allFlat) {
    ctx.fillStyle = '#8b98a5'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('各通道数值全程恒定，没有波形', cssW / 2, cssH / 2 - 4)
    ctx.fillText('换一个会变化的量（电容电压 / 交流源），或切到 AC 耦合看波动', cssW / 2, cssH / 2 + 12)
    ctx.textAlign = 'left'
  }

  // ---- 轴标注：显示 时基 与 量程，像真实示波器那样标在角上 ----
  ctx.fillStyle = '#6f8296'
  ctx.font = '10px ui-monospace, monospace'
  const tbText = timebase < 1e-3
    ? `${(timebase * 1e6).toFixed(0)} µs/格`
    : timebase < 1
      ? `${(timebase * 1e3).toFixed(timebase * 1e3 < 10 ? 1 : 0)} ms/格`
      : `${timebase.toFixed(timebase < 1 ? 2 : 0)} s/格`
  ctx.fillText(tbText, 5, cssH - 5)
  // 纵轴单位跟着通道走：只有电流通道时才用 A，否则用 V。
  const anyCurrent = state.channels.some((c) => c.enabled && channelIsCurrent(c))
  const onlyCurrent = state.channels.filter((c) => c.enabled).every((c) => channelIsCurrent(c))
  const unitFmt = onlyCurrent && anyCurrent ? fmtA : fmtV
  const vText = state.voltsPerDiv > 0
    ? `${unitFmt(state.voltsPerDiv)}/格`
    : `${unitFmt(hi)} ~ ${unitFmt(lo)}`
  ctx.fillText(vText, 5, 12)

  // ---- 框选放大的选框：用半透明蓝框 + 虚线边，和真实示波器的 Zoom 框一致 ----
  const box = state.zoomBox
  if (box && (box.active || box.x1 !== box.x0)) {
    const bx = Math.min(box.x0, box.x1)
    const by = Math.min(box.y0, box.y1)
    const bw = Math.abs(box.x1 - box.x0)
    const bh = Math.abs(box.y1 - box.y0)
    ctx.save()
    ctx.fillStyle = 'rgba(78, 161, 255, 0.14)'
    ctx.fillRect(bx, by, bw, bh)
    ctx.strokeStyle = '#4ea1ff'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh)
    ctx.restore()
  }

  if (ui.scopeMeta) {
    const last = visible[visible.length - 1]
    const parts = []
    state.channels.forEach((c, ci) => {
      if (!c.enabled) return
      const raw = last.values[ci]
      if (!Number.isFinite(raw)) {
        parts.push(`${c.label}（断线）`)
        return
      }
      parts.push(`${c.label} ${channelIsCurrent(c) ? fmtA(raw) : fmtV(raw)}`)
    })
    const couplingText = state.coupling === 'ac' ? ' · AC 耦合' : ''
    ui.scopeMeta.textContent = parts.length
      ? `最近：${parts.join('　')}${couplingText}`
      : '没有启用的通道'
  }
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

/**
 * 浮动窗口系统。
 *
 * 用户要求"每个框可移动，不要链接到一起"。所以不再用竖向排列 + 分隔条，
 * 而是每个区块都是一个独立浮在画布上的窗口：
 *   - 拖标题栏移动，位置单独保存；
 *   - 拖右下角缩放，尺寸单独保存；
 *   - 标题栏可折叠/关闭，互不影响。
 *
 * 关键隔离点：**示波器必须是独立窗口，且不依赖电路里的任何元件**。
 * 删掉全部元件时示波器窗口仍在，只显示"无通道"，不会消失。
 */
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
 * 清空画布：通过内核的「文件 → New Blank Circuit」菜单执行。
 *
 * 为什么不直接用 importCircuit：内核的 importCircuit(text, isSubcircuitLibrary)
 * 第二个参数是"这是子电路库吗"，并不控制是否清空；直接导入会把新电路叠加到
 * 原有电路上。走菜单"新建空白电路"才是内核官方的清场路径，会同时重置仿真时间、
 * 撤销记录和电路标题。
 *
 * 菜单被 CSS 移出可视区但 DOM 仍在，所以这里的点击依然有效。
 */
function clearCircuit(w) {
  try {
    const doc = w.document
    const fileMenu = [...doc.querySelectorAll('.gwt-MenuItem')]
      .find((x) => (x.textContent || '').trim().startsWith('文件') || (x.textContent || '').trim().startsWith('File'))
    if (!fileMenu) return false
    fileMenu.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const blank = [...doc.querySelectorAll('.menuItem')]
      .find((x) => /New Blank Circuit|新建空白/.test((x.textContent || '')))
    if (!blank) {
      closeMenus(doc)
      return false
    }
    blank.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    closeMenus(doc)
    return true
  } catch {
    return false
  }
}

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
      // 关键：importCircuit(text, isSubcircuitLibrary) 的第二个参数是"这是子电路库吗"，
      // 不是"是否清空"。传 false 不会清空原有电路，会把新旧元件叠在一起。
      // 所以先用内核的"新建空白电路"清场。
      clearCircuit(w)
      // 菜单点击到电路真正清空之间有异步间隙（内核要走一遍 analyze），
      // 立刻导入会和清空动作撞车，结果画布变空。等一会儿再导。
      await new Promise((resolve) => setTimeout(resolve, 150))
      w.CircuitJS1.importCircuit(text, false)
      await new Promise((resolve) => setTimeout(resolve, 120))
      refreshElements()
      status.textContent = `已加载「${item.name}」——可以直接拖动元件、改参数`
      toast(`已加载「${item.name}」`)
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

const WINDOW_DEFS = [
  {
    id: 'dc-win-parts',
    title: '元件快选',
    build: () => renderPartsSection(),
    default: { x: 12, y: 12, w: 300, h: 300 },
  },
  {
    id: 'dc-win-measure',
    title: '测量台',
    build: () => renderMeasureSection(),
    default: { x: 12, y: 322, w: 300, h: 300 },
  },
  {
    id: 'dc-win-scope',
    title: '示波器',
    build: () => renderScopeSection(),
    default: { x: 322, y: 12, w: 520, h: 420 },
  },
  {
    id: 'dc-win-presets',
    title: '经典电路',
    build: () => renderPresetsSection(),
    default: { x: 860, y: 12, w: 400, h: 560 },
  },
]

const WIN_GEOM_KEY = 'dsh-circuit:window-geom'

function loadGeom() {
  try {
    return JSON.parse(localStorage.getItem(WIN_GEOM_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveGeom(all) {
  try {
    localStorage.setItem(WIN_GEOM_KEY, JSON.stringify(all))
  } catch {
    // 忽略
  }
}

/** 创建一个浮动窗口：标题栏拖动移动，右下角拖动缩放。 */
function makeWindow(def) {
  const geom = loadGeom()
  const g = { ...def.default, ...(geom[def.id] || {}) }

  const body = el('div', { class: 'dc-win-body' }, [def.build()])

  const titleSpan = el('span', { class: 'dc-win-title', text: def.title })
  const minBtn = el('button', {
    class: 'dc-win-btn', type: 'button', title: '折叠', text: '—',
    onclick: () => {
      const collapsed = body.style.display === 'none'
      body.style.display = collapsed ? '' : 'none'
      minBtn.textContent = collapsed ? '—' : '▢'
      if (collapsed) setTimeout(() => drawScope(), 50)
    },
  })
  const closeBtn = el('button', {
    class: 'dc-win-btn', type: 'button', title: '关闭', text: '×',
    onclick: () => {
      win.style.display = 'none'
    },
  })

  const bar = el('div', { class: 'dc-win-bar', onmousedown: (ev) => startMoveWin(ev, win, g) }, [
    titleSpan, el('span', { class: 'dc-win-grip' }), minBtn, closeBtn,
  ])

  const resize = el('div', {
    class: 'dc-win-resize',
    title: '拖动缩放',
    onmousedown: (ev) => startResizeWin(ev, win, g),
  })

  const win = el('div', { class: 'dc-win', id: def.id }, [bar, body, resize])
  win.style.left = `${g.x}px`
  win.style.top = `${g.y}px`
  win.style.width = `${g.w}px`
  win.style.height = `${g.h}px`

  // 点任意位置把窗口提到最上层（不干扰拖动逻辑）
  win.addEventListener('mousedown', () => {
    const z = (parseInt(window.__dcTopZ || '10', 10) + 1).toString()
    window.__dcTopZ = z
    win.style.zIndex = String(1000 + parseInt(z, 10))
  }, true)

  win.__geom = g
  return win
}

function startMoveWin(ev, win, g) {
  if (ev.target === win.querySelector('.dc-win-btn')) return
  ev.preventDefault()
  const startX = ev.clientX
  const startY = ev.clientY
  const ox = win.offsetLeft
  const oy = win.offsetTop
  const onMove = (e) => {
    g.x = Math.max(0, ox + (e.clientX - startX))
    g.y = Math.max(0, oy + (e.clientY - startY))
    win.style.left = `${g.x}px`
    win.style.top = `${g.y}px`
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    persistGeom(win)
  }
  document.body.style.cursor = 'move'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function startResizeWin(ev, win, g) {
  ev.preventDefault()
  ev.stopPropagation()
  const startX = ev.clientX
  const startY = ev.clientY
  const ow = win.offsetWidth
  const oh = win.offsetHeight
  const onMove = (e) => {
    g.w = Math.max(220, ow + (e.clientX - startX))
    g.h = Math.max(140, oh + (e.clientY - startY))
    win.style.width = `${g.w}px`
    win.style.height = `${g.h}px`
    // 尺寸变了要重设画布分辨率
    drawScope()
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    persistGeom(win)
    drawScope()
  }
  document.body.style.cursor = 'nwse-resize'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function persistGeom(win) {
  const all = loadGeom()
  all[win.id] = { ...win.__geom }
  saveGeom(all)
}

function renderShell() {
  const panel = document.getElementById('panel')
  panel.innerHTML = ''
  panel.classList.add('dc-floating')

  for (const def of WINDOW_DEFS) {
    panel.appendChild(makeWindow(def))
  }

  ui.toast = el('div', { class: 'dc-toast' })
  document.body.appendChild(ui.toast)

}



function renderPartsSection() {
  const grid = el('div', { class: 'dc-grid' })
  for (const part of PARTS) {
    grid.appendChild(el('button', {
      class: 'dc-part-btn',
      type: 'button',
      title: part.menu,
      onclick: () => {
        const ok = choosePartFromMenu(part.menu, part.label)
        if (ok) sampleAndRender()
      },
    }, [
      el('span', { class: 'dc-part-glyph', text: part.glyph }),
      el('span', { class: 'dc-part-name', text: part.label }),
    ]))
  }
  ui.placeHint = el('div', { class: 'dc-place-hint', text: '先点元件，再在画布上按住拖动即可放置。' })

  // 放置中显示的"取消放置"按钮：这是把鼠标还给选择/拖动的唯一开关。
  ui.cancelBtn = el('button', {
    class: 'dc-btn dc-btn-cancel',
    type: 'button',
    text: '取消放置，回到鼠标操作',
    style: 'display:none;width:100%;margin-top:7px',
    onclick: () => {
      cancelPlacing()
      sampleAndRender()
    },
  })

  // 可折叠：元件区是常驻工具，不该占掉半屏把波形挤到折叠线以下。
  const body = el('div', { class: 'dc-section-body' }, [grid, ui.placeHint, ui.cancelBtn])
  const head = el('div', {
    class: 'dc-section-head dc-collapsible',
    onclick: () => {
      state.partsCollapsed = !state.partsCollapsed
      body.style.display = state.partsCollapsed ? 'none' : ''
      head.classList.toggle('is-collapsed', state.partsCollapsed)
    },
  }, [
    el('h2', { text: '元件快选' }),
    el('span', { class: 'dc-hint', text: state.partsCollapsed ? '展开 ▾' : '收起 ▴' }),
  ])
  if (state.partsCollapsed) body.style.display = 'none'
  return el('section', { class: 'dc-section', id: 'dc-parts' }, [head, body])
}

function renderMeasureSection() {
  ui.simState = el('div', { class: 'dc-simstate' })
  ui.tableWrap = el('div', { class: 'dc-table-wrap' })
  const toolbar = el('div', { class: 'dc-toolbar' }, [
    ui.runBtn = el('button', { class: 'dc-btn', type: 'button', text: '暂停仿真', onclick: toggleRun }),
    el('button', { class: 'dc-btn', type: 'button', text: '刷新读数', onclick: () => { refreshElements(); renderTable() } }),
  ])
  return el('section', { class: 'dc-section', id: 'dc-measure' }, [
    el('div', { class: 'dc-section-head' }, [
      el('h2', { text: '测量台' }),
      el('span', { class: 'dc-hint', text: '实时读数' }),
    ]),
    el('div', { class: 'dc-section-body' }, [toolbar, ui.simState, ui.tableWrap]),
  ])
}

/* ------------------------------------------------------------------ */
/* 示波器档位（仿真实示波器的旋钮档位）                                  */
/* ------------------------------------------------------------------ */

/** 时基（时间/格）。每条主要竖线 = 1 格，共 10 格。 */
const TIMEBASE = [
  { label: '10 µs', v: 10e-6 },
  { label: '100 µs', v: 100e-6 },
  { label: '1 ms', v: 1e-3 },
  { label: '10 ms', v: 10e-3 },
  { label: '100 ms', v: 100e-3 },
  { label: '1 s', v: 1 },
  { label: '3 s', v: 3 },
]

/** 电压档位（伏/格）。 */
const VOLTS_PER_DIV = [1e-6, 10e-6, 100e-6, 1e-3, 10e-3, 100e-3, 1, 10, 100]

/** 电流档位（安/格）。 */
const AMPS_PER_DIV = [1e-9, 10e-9, 100e-9, 1e-6, 10e-6, 100e-6, 1e-3, 10e-3, 1]

function renderScopeSection() {
  ui.chips = el('div', { class: 'dc-chips' })
  ui.scopeCanvas = el('canvas', { class: 'dc-scope' })
  // 滚轮缩放：在波形上滚轮，向上一档放大时基（看更细节），向下一档拉宽时间窗。
  // 这是用户要求的交互方式——不再弹覆盖层窗口。
  ui.scopeCanvas.addEventListener('wheel', (ev) => {
    ev.preventDefault()
    zoomTimebase(ev.deltaY < 0 ? -1 : 1)
  }, { passive: false })

  // 框选放大：在波形上按住拖动拉出一个框，松开即放大到该区域。
  // 这是用户要求的"拉一个框看波形细节"。
  ui.scopeCanvas.addEventListener('mousedown', (ev) => beginZoomBox(ev))
  ui.scopeCanvas.addEventListener('mousemove', (ev) => updateZoomBox(ev))
  ui.scopeCanvas.addEventListener('mouseup', (ev) => endZoomBox(ev))
  ui.scopeCanvas.addEventListener('mouseleave', () => cancelZoomBox())
  ui.scopeCanvas.style.cursor = 'crosshair'
  ui.scopeMeta = el('div', { class: 'dc-scope-meta' }, [el('span', { text: '还没开始记录' })])
  ui.scopeEmpty = el('div', { class: 'dc-scope-empty' }, [
    el('div', { class: 'dc-scope-empty-title', text: '还没有通道' }),
    el('div', {
      class: 'dc-scope-empty-body',
      text: '在"测量台"里点某个元件的 V 或 I，把它的电压/电流接到示波器上。',
    }),
  ])
  ui.scopeWrap = el('div', { class: 'dc-scope-wrap' }, [ui.scopeCanvas, ui.scopeEmpty])

  // ---- 控制条：仿示波器前面板 ----
  // 时基：整屏 10 格
  ui.timebaseSelect = el('select', { class: 'dc-scope-select' },
    TIMEBASE.map((item, i) => el('option', { value: String(item.v), text: item.label, selected: i === 5 ? '' : undefined })))
  ui.timebaseSelect.value = String(TIMEBASE[4].v)
  ui.timebaseSelect.addEventListener('change', () => {
    state.timebase = Number(ui.timebaseSelect.value) || 0.1
    drawScope()
  })

  // 垂直档位：自动 / 手动伏格
  ui.vdivSelect = el('select', { class: 'dc-scope-select' },
    [{ v: 0, label: '自动' }, ...VOLTS_PER_DIV.map((v) => ({ v, label: `${fmtV(v)}/格` }))]
      .map((item) => el('option', { value: String(item.v), text: item.label })))
  ui.vdivSelect.value = '0'
  ui.vdivSelect.addEventListener('change', () => {
    state.voltsPerDiv = Number(ui.vdivSelect.value)
    drawScope()
  })

  // 耦合方式：DC 直通 / AC 交流耦合（去直流分量）
  ui.couplingSelect = el('select', { class: 'dc-scope-select' },
    ['DC 耦合', 'AC 耦合'].map((label, i) => el('option', { value: String(i), text: label })))
  ui.couplingSelect.value = '0'
  ui.couplingSelect.addEventListener('change', () => {
    state.coupling = ui.couplingSelect.value === '1' ? 'ac' : 'dc'
    state.samples = []
    drawScope()
    toast(state.coupling === 'ac' ? '已切到交流耦合：会滤掉直流分量，只看波动' : '已切回直流耦合：显示真实数值')
  })

  // 暂停/运行
  ui.scopeRunBtn = el('button', {
    class: 'dc-btn', type: 'button', text: '运行',
    onclick: () => {
      setSimRunning(!state.running)
      renderSimState()
      ui.scopeRunBtn.textContent = state.running ? '运行' : '已暂停'
      ui.scopeRunBtn.classList.toggle('is-on', !state.running)
    },
  })

  ui.scopeClearBtn = el('button', {
    class: 'dc-btn', type: 'button', text: '清除',
    onclick: () => { state.samples = []; drawScope(); renderScopeReadouts() },
  })

  // 缩放提示（不再用"放大"按钮弹覆盖层——那个会盖住整个面板，是 bug）
  ui.scopeExpandBtn = el('span', {
    class: 'dc-scope-hint',
    text: '滚轮缩放',
    title: '在波形区滚动鼠标滚轮：向上放大、向下缩小',
  })

  // ---- 探头选择行：按示波器的物理语义接通道 ----
  // 通道 = 正端探头 − 负端探头。负端子选"接地"即为单端对地测量；
  // 选另一个探头就是差分测量（例如测某个电阻两端的电压）。
  ui.probeRows = el('div', { class: 'dc-probe-rows' })
  // 两个独立按钮：电压通道（电位差）与电流通道。单位不同，不能混在一起。
  ui.probeAddBtn = el('button', {
    class: 'dc-btn', type: 'button', text: '+ 电压通道',
    title: '电位差测量：接两个探头，显示正端 − 负端',
    onclick: () => addProbeChannel('voltage'),
  })
  ui.currentAddBtn = el('button', {
    class: 'dc-btn', type: 'button', text: '+ 电流通道',
    title: '电流测量：选一个元件，显示流过它的电流',
    onclick: () => addProbeChannel('current'),
  })

  // ---- 第二行：水平位置 / 触发 / 运行模式（示波器的基本操作） ----
  // 水平位置：整个波形在屏幕上左右平移（真实示波器的 HORIZONTAL POSITION 旋钮）
  ui.hposRange = el('input', {
    class: 'dc-scope-range', type: 'range', min: '-50', max: '50', step: '1', value: '0',
    title: '水平位置：左右平移波形',
  })
  ui.hposRange.addEventListener('input', () => {
    state.hOffsetDiv = Number(ui.hposRange.value) / 100   // -0.5 ~ +0.5 屏
    drawScope()
  })

  // 垂直位置（每通道伯偏移？做成全局，简化）
  ui.vposRange = el('input', {
    class: 'dc-scope-range', type: 'range', min: '-50', max: '50', step: '1', value: '0',
    title: '垂直位置：上下平移波形',
  })
  ui.vposRange.addEventListener('input', () => {
    state.vOffsetDiv = Number(ui.vposRange.value) / 100
    drawScope()
  })

  // 触发模式：自动（自由滚动）/ 单次（捕获一段后停）
  ui.triggerSelect = el('select', { class: 'dc-scope-select' }, [
    el('option', { value: 'auto', text: '自动滚动' }),
    el('option', { value: 'single', text: '单次触发' }),
  ])
  ui.triggerSelect.addEventListener('change', () => {
    state.triggerMode = ui.triggerSelect.value
    if (state.triggerMode === 'single') {
      state.samples = []
      state.triggerArmed = true
      state.triggerCapturing = false
      state.triggerLastV = null
      toast('单次触发：正在等上升沿，抓到后冻结一屏')
    } else {
      state.triggerArmed = false
      state.triggerCapturing = false
    }
    drawScope()
  })

  const ctl1 = el('div', { class: 'dc-scope-row' }, [
    el('span', { class: 'dc-scope-cap', text: '时基' }), ui.timebaseSelect,
    el('span', { class: 'dc-scope-cap', text: '电压' }), ui.vdivSelect,
    el('span', { class: 'dc-scope-cap', text: '耦合' }), ui.couplingSelect,
    el('span', { class: 'dc-scope-cap', text: '触发' }), ui.triggerSelect,
  ])
  const ctl2 = el('div', { class: 'dc-scope-row' }, [
    ui.scopeRunBtn, ui.scopeClearBtn, ui.scopeExpandBtn, ui.probeAddBtn, ui.currentAddBtn,
  ])
  const ctl3 = el('div', { class: 'dc-scope-row' }, [
    el('span', { class: 'dc-scope-cap', text: '水平' }), ui.hposRange,
    el('span', { class: 'dc-scope-cap', text: '垂直' }), ui.vposRange,
  ])

  // ---- 读数条：每通道的 峰峰值 / 频率 / RMS ----
  ui.readouts = el('div', { class: 'dc-readouts' })

  return el('section', { class: 'dc-section', id: 'dc-scope-section' }, [
    el('div', { class: 'dc-section-head' }, [
      el('h2', { text: '示波器' }),
      el('span', { class: 'dc-hint', text: '通道 = 正端 − 负端' }),
    ]),
    el('div', { class: 'dc-section-body' }, [
      ui.chips, ctl1, ctl2, ctl3, ui.probeRows, ui.scopeWrap, ui.scopeMeta, ui.readouts,
    ]),
  ])
}

/**
 * 新增一个示波器通道（按探头）。
 *
 * 通道的物理定义：`V通道 = V(正端) − V(负端)`。
 * 这里把每个测量点抽象成一个"探头"，其数值取自电路里某个元件的电位；
 * 负端默认接地（0 V），因此默认就是单端对地测量。
 */
/**
 * 新增一个示波器通道。
 *
 * 两种测量类型，单位不同：
 *   - `voltage` 电位差：需要两个探头（正端 − 负端），单位 V
 *   - `current` 电流：需要一个元件，读流过它的电流，单位 A
 *
 * 默认加电压通道（示波器最常见的用途）；没有探头时退回电流通道。
 */
function addProbeChannel(kind) {
  if (state.channels.length >= 6) {
    toast('最多 6 个通道')
    return
  }
  const points = collectProbePoints()
  const probes = points.filter((p) => p.kind === 'probe')
  const currents = points.filter((p) => p.kind === 'current')

  const wantCurrent = kind === 'current' || (kind !== 'voltage' && probes.length === 0)

  if (wantCurrent) {
    if (currents.length === 0) {
      toast('电路里还没有可测电流的元件')
      return
    }
    state.channels.push({
      key: `I-${Date.now()}`,
      measure: 'current',
      type: 'current',
      index: -1,
      signal: 'i',
      currentType: currents[0].type,
      currentIndex: currents[0].index,
      label: '',
      color: CHANNEL_COLORS[state.channels.length % CHANNEL_COLORS.length],
      enabled: true,
    })
  } else {
    if (probes.length === 0) {
      toast('电路里还没有探头：先在"元件快选"里放"示波器探头"')
      return
    }
    state.channels.push({
      key: `V-${Date.now()}`,
      measure: 'voltage',
      type: 'probe',
      index: -1,
      signal: 'v',
      positive: probes[0].id,
      negative: '__gnd__',
      label: '',
      color: CHANNEL_COLORS[state.channels.length % CHANNEL_COLORS.length],
      enabled: true,
    })
  }

  state.samples = []
  renderChannels()
  renderProbeRows()
  renderScopeReadouts()
}

/**
 * 收集可用的**探头**（不是任意元件）。
 *
 * 用户要求"每个通道右边提供两个探头可获取的位置"——所以这里只认真正插在电路里的
 * 示波器探头（`ProbeElm` / `OutputElm`），它们各自测得所在节点的电位。
 * 一个通道 = 一个正探头 + 一个负探头，这才是示波器的物理接线方式。
 */
/**
 * 收集可用的测量点，分两类：
 *
 *  1) **电位探头**（kind: 'probe'）——电路里插着的示波器探头，读的是该节点的电位。
 *     两个探头相减 = 该两点的电位差（差分测量，等价于示波器正负端接线）。
 *
 *  2) **电流测点**（kind: 'current'）——电路里的元件/电流表，读的是流过它的电流。
 *     串联进回路的电流表、导线的电流都可以作为电流通道。
 *
 * 这样示波器既能测电压（电位差），也能测电流，两者单位不同、分别格式化。
 */
function collectProbePoints() {
  const points = []
  points.push({ id: '__gnd__', label: '接地 (0 V)', kind: 'gnd' })

  // 电位探头
  for (const e of state.elements) {
    if (e.type !== 'ProbeElm' && e.type !== 'OutputElm') continue
    points.push({
      id: `${e.type}#${e.index}:v`,
      label: `探头 ${e.index}（${fmtV(e.vd)}）`,
      kind: 'probe',
      type: e.type,
      index: e.index,
    })
  }

  // 电流测点：电流表、导线、以及有电流的元件
  for (const e of state.elements) {
    if (e.type === 'ProbeElm' || e.type === 'OutputElm' || e.type === 'GroundElm') continue
    points.push({
      id: `${e.type}#${e.index}:i`,
      label: `${e.label} 电流（${fmtA(e.current)}）`,
      kind: 'current',
      type: e.type,
      index: e.index,
    })
  }
  return points
}

/**
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

/** 依据测量点选择刷新通道显示名。 */
function updateChannelLabel(ch) {
  const all = collectProbePoints()
  const lookup = (id) => {
    if (id === '__gnd__' || !id) return '接地'
    const p = all.find((x) => x.id === id)
    return p ? p.label : '（已断开）'
  }

  if (channelIsCurrent(ch)) {
    const el2 = state.elements.find((e) => e.type === ch.currentType && e.index === ch.currentIndex)
    ch.label = el2 ? `${el2.label} 电流` : '（已断开）'
    return
  }

  // 电压通道：区分"单端对地"和"两点电位差"
  const pos = lookup(ch.positive)
  const neg = lookup(ch.negative)
  ch.label = neg === '接地' ? `${pos}（对地）` : `电位差 (${pos} − ${neg})`
}

/**
 * 从采样数据里算频率。
 *
 * 做法：取最后一个通道，找出所有"向上穿过均值"的位置，取相邻间隔的中位数
 * 作为周期。比 FFT 简单可靠，对初中电路的正弦/方波已经够用；无法测量时
 * 明确返回 null，不编造数字。
 */
function estimateFrequency(values, sampleTimes) {
  const n = values.length
  if (n < 8) return null
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length < 8) return null
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length
  let min = Infinity
  let max = -Infinity
  for (const v of finite) {
    if (v < min) min = v
    if (v > max) max = v
  }
  // 波动太小（近似直流）就谈不上频率
  if (max - min < Math.max(Math.abs(mean), 1e-12) * 1e-3) return null

  const crossings = []
  for (let i = 1; i < n; i += 1) {
    const a = values[i - 1]
    const b = values[i]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    if (a < mean && b >= mean) crossings.push(sampleTimes[i])
  }
  if (crossings.length < 3) return null
  const periods = []
  for (let i = 1; i < crossings.length; i += 1) {
    const p = crossings[i] - crossings[i - 1]
    if (p > 0) periods.push(p)
  }
  if (periods.length === 0) return null
  periods.sort((a, b) => a - b)
  const median = periods[Math.floor(periods.length / 2)]
  if (median <= 0) return null
  return 1 / median
}

/** 每个通道的峰峰值 / RMS / 频率，用真实采样算，不做任何估计填充。 */
function renderScopeReadouts() {
  if (!ui.readouts) return
  ui.readouts.innerHTML = ''
  if (state.channels.length === 0) return
  if (state.samples.length < 8) {
    ui.readouts.appendChild(el('div', { class: 'dc-readout-empty', text: '数据不足，继续运行一会儿' }))
    return
  }

  const times = state.samples.map((s) => s.t)
  for (let ci = 0; ci < state.channels.length; ci += 1) {
    const ch = state.channels[ci]
    const vals = state.samples.map((s) => s.values[ci])
    const finite = vals.filter((v) => Number.isFinite(v))
    if (finite.length < 8) continue
    let min = Infinity
    let max = -Infinity
    let sumSq = 0
    for (const v of finite) {
      if (v < min) min = v
      if (v > max) max = v
      sumSq += v * v
    }
    // 单位由"测点种类"决定，不能看 channel.signal：
    // 探头型通道的 signal 恒为 'v'，但正端可能接的是电流测点（id 以 :i 结尾），
    // 此时必须用电流单位，否则 47 mA 会被显示成 47 mV。
    const fmt = channelIsCurrent(ch) ? fmtA : fmtV
    const vpp = max - min
    const rms = Math.sqrt(sumSq / finite.length)
    const freq = estimateFrequency(vals, times)

    const row = el('div', { class: 'dc-readout-row' }, [
      probeChip(ch.color),
      el('span', { class: 'dc-readout-name', text: ch.label }),
      el('span', { class: 'dc-readout-kv' }, [el('i', { text: '峰峰' }), fmt(vpp)]),
      el('span', { class: 'dc-readout-kv' }, [el('i', { text: 'RMS' }), fmt(rms)]),
      freq === null
        ? el('span', { class: 'dc-readout-kv dc-readout-na', text: '频率 —' })
        : el('span', { class: 'dc-readout-kv' }, [el('i', { text: '频率' }), `${fmtHz(freq)}`]),
    ])
    ui.readouts.appendChild(row)
  }
}

/**
 * 这个通道记录的是电流还是电压。
 *
 * 探头通道：看正端测点的 id 后缀（`...:i` 为电流，`...:v` 为电压）。
 * 旧式元件通道：看 signal 字段。
 */
/**
 * 这个通道记录的是电流还是电压。
 *
 * 三种来源：
 *  - `voltage` 型（电位差）：正端探头 − 负端探头 → 电压
 *  - `current` 型：读取某个元件的电流 → 电流
 *  - 旧式 `probe` 型：看正端测点 id 后缀（`:i` 电流，`:v` 电压）
 */
function channelIsCurrent(ch) {
  if (ch.measure === 'current') return true
  if (ch.measure === 'voltage') return false
  if (ch.type === 'probe') {
    const pos = ch.positive || ''
    return pos.endsWith(':i')
  }
  return ch.signal === 'i'
}

/**
 * 示波器探头图案（自制 SVG，不是图标字体）。
 *
 * 画的是真实无源探头的三段结构：
 *   - 左端 BNC 接头（圆环 + 芯针）
 *   - 中间 10× 衰减盒（矩形，带 "10×" 刻度感）
 *   - 右端探针尖（细长锥形 + 地线夹）
 * 颜色随传入色显示，用来标识不同通道。
 *
 * @param color 主色（十六进制）
 * @param size 像素尺寸，默认 14
 */
function probeIconSvg(color, size) {
  const s2 = size || 14
  return `<svg width="${s2}" height="${s2}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="4" cy="12" r="3.2" stroke="${color}" stroke-width="1.6"/>` +
    `<circle cx="4" cy="12" r="1.1" fill="${color}"/>` +
    `<rect x="7.5" y="8.5" width="7" height="7" rx="1.4" stroke="${color}" stroke-width="1.6"/>` +
    `<path d="M14.5 12h2.2" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M16.7 12l3.6-2.6M16.7 12l3.6 2.6" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/>` +
    `<path d="M12 19.5v2.2" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="1.4 1.2"/>` +
    `</svg>`
}

/**
 * 一个小容器，把探头图案按指定颜色渲染出来（直接插入 DOM）。
 * 用 DOM 解析 SVG 字符串，避免各处再拼一遍 innerHTML。
 */
function probeChip(color) {
  const box = el('span', { class: 'dc-probe-chip' })
  box.innerHTML = probeIconSvg(color, 14)
  return box
}

function fmtHz(f) {
  if (!Number.isFinite(f) || f <= 0) return '—'
  if (f < 1e3) return `${f.toFixed(f < 10 ? 2 : 0)} Hz`
  if (f < 1e6) return `${(f / 1e3).toFixed(2)} kHz`
  return `${(f / 1e6).toFixed(2)} MHz`
}









/**
 * 测量台：每个元件一行，右侧直接给出「波形」开关。
 *
 * 这是本次重构的核心交互——用户不需要再跳到一个单独的"波形区"里挑元件，
 * 而是在电压表/电流表所在的这一行就能把它的量接到示波器上（你的原始设想）。
 * 已接入的通道用一个高亮小圆点表示，再点一次即断开。
 */
/**
 * 测量台表格。
 *
 * 重要：这个函数每秒会被调用几次。如果每次都重建整张表，用户点下去的按钮
 * 会在 DOM 被替换后失效（表现为"点了 V 没反应"）。所以这里做两段式：
 *   - 只有**元件结构或通道开关状态**变了，才重建表格；
 *   - 其余时候只就地更新电压/电流两列的文字。
 */
function renderTable() {
  if (!ui.tableWrap) return

  const signature = state.elements.map((e) => `${e.type}#${e.index}`).join('|')
  const channelSig = state.channels.map((c) => c.key).join('|')
  const structural = `${signature}::${channelSig}`

  if (ui.tableSig === structural && ui.tableCells) {
    // 结构没变：只刷新数值
    for (let i = 0; i < state.elements.length; i += 1) {
      const e = state.elements[i]
      const cells = ui.tableCells[i]
      if (!cells) continue
      const vText = Math.abs(e.vd) < 1e-12 ? '0' : fmtV(e.vd)
      const iText = Math.abs(e.current) < 1e-12 ? '0' : fmtA(e.current)
      if (cells.v.textContent !== vText) cells.v.textContent = vText
      if (cells.i.textContent !== iText) cells.i.textContent = iText
    }
    return
  }

  // 结构变了：重建
  ui.tableSig = structural
  ui.tableCells = []

  const t = el('table', { class: 'dc-table' })
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', { text: '元件' }),
      el('th', { text: '电压', style: 'text-align:right' }),
      el('th', { text: '电流', style: 'text-align:right' }),
      el('th', { text: '波形', style: 'text-align:center;width:76px' }),
    ]),
  ])
  t.appendChild(thead)
  const tbody = el('tbody')
  for (const e of state.elements) {
    const tr = el('tr')
    tr.appendChild(el('td', { class: 'dc-type', text: `${e.label}` }))
    const vCell = el('td', { class: `dc-val${Math.abs(e.vd) < 1e-12 ? ' dc-zero' : ''}`, text: Math.abs(e.vd) < 1e-12 ? '0' : fmtV(e.vd) })
    const iCell = el('td', { class: `dc-val${Math.abs(e.current) < 1e-12 ? ' dc-zero' : ''}`, text: Math.abs(e.current) < 1e-12 ? '0' : fmtA(e.current) })
    tr.appendChild(vCell)
    tr.appendChild(iCell)

    const hasV = state.channels.some((c) => c.type === e.type && c.index === e.index && c.signal === 'v')
    const hasI = state.channels.some((c) => c.type === e.type && c.index === e.index && c.signal === 'i')
    const cell = el('td', { class: 'dc-ch-cell' })
    cell.appendChild(el('button', {
      class: `dc-ch-toggle${hasV ? ' is-on' : ''}`,
      type: 'button',
      title: '把这个元件的电压送到示波器',
      text: hasV ? 'V ✓' : 'V',
      onclick: (ev) => {
        ev.stopPropagation()
        if (hasV) removeChannel(`${e.type}#${e.index}:v`)
        else addChannel(e.type, e.index, 'v')
      },
    }))
    cell.appendChild(el('button', {
      class: `dc-ch-toggle${hasI ? ' is-on' : ''}`,
      type: 'button',
      title: '把这个元件的电流送到示波器',
      text: hasI ? 'I ✓' : 'I',
      onclick: (ev) => {
        ev.stopPropagation()
        if (hasI) removeChannel(`${e.type}#${e.index}:i`)
        else addChannel(e.type, e.index, 'i')
      },
    }))
    tr.appendChild(cell)
    tbody.appendChild(tr)
    ui.tableCells.push({ v: vCell, i: iCell })
  }
  t.appendChild(tbody)
  ui.tableWrap.innerHTML = ''
  if (state.elements.length === 0) {
    ui.tableWrap.appendChild(el('div', { class: 'dc-empty', text: '还没有元件。先在"元件快选"里点一个，再到左边画布上拖动放置。' }))
  } else {
    ui.tableWrap.appendChild(t)
  }
}


function renderChannels() {
  if (!ui.chips) return
  ui.chips.innerHTML = ''
  if (state.channels.length === 0) {
    ui.chips.appendChild(el('span', { class: 'dc-empty', style: 'padding:2px 0', text: '还没有记录通道' }))
    if (ui.scopeEmpty) ui.scopeEmpty.style.display = ''
    return
  }
  if (ui.scopeEmpty) ui.scopeEmpty.style.display = 'none'
  for (const channel of state.channels) {
    const dot = el('span', { class: 'dc-dot' })
    dot.style.background = channel.color
    // 通道开关：点通道名切换启用/停用（示波器上每个通道都有自己的 ON/OFF）
    const nameBtn = el('button', {
      class: `dc-chip-name${channel.enabled ? '' : ' is-off'}`,
      type: 'button',
      title: channel.enabled ? '点击暂停这个通道' : '点击启用这个通道',
      text: channel.label,
      onclick: () => {
        channel.enabled = !channel.enabled
        renderChannels()
        renderScopeReadouts()
      },
    })
    ui.chips.appendChild(el('span', { class: 'dc-chip' }, [
      dot,
      nameBtn,
      el('button', { class: 'dc-chip-x', type: 'button', text: '×', onclick: () => removeChannel(channel.key) }),
    ]))
  }
  renderProbeRows()
  drawScope()
}

function renderPlaceHint() {
  if (!ui.placeHint) return
  ui.placeHint.textContent = state.placeHint || '先点元件，再在画布上按住拖动即可放置。'
  ui.placeHint.className = `dc-place-hint${state.placeHint ? ' is-live' : ''}`
  // 只在放置中显示"取消放置"，平时不占版面。
  if (ui.cancelBtn) ui.cancelBtn.style.display = state.placingMode ? '' : 'none'
}

function renderSimState() {
  if (!ui.simState) return
  ui.simState.innerHTML = ''
  ui.simState.appendChild(el('span', {}, [el('b', { text: state.running ? '运行中' : '已暂停' })]))
  ui.simState.appendChild(el('span', {}, ['仿真时间 ', el('b', { text: fmtTime(state.time) })]))
  ui.simState.appendChild(el('span', {}, ['元件 ', el('b', { text: String(state.elements.length) })]))
  if (ui.runBtn) ui.runBtn.textContent = state.running ? '暂停仿真' : '继续仿真'
}

function toggleRun() {
  setSimRunning(!state.running)
  renderSimState()
}



/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

function sampleAndRender() {
  state.running = simIsRunning()
  state.time = simTime()
  refreshElements()
  sampleTick()
  renderSimState()
  renderTable()
  drawScope()
}

/**
 * 面板侧键盘监听：用户在外层面板按 Esc 时，把按键转发给内核 iframe。
 *
 * iframe 内的内核只监听自己的 document，外层按下 Esc 它收不到。用户在画布外
 * 按 Esc 时如果没有这条转发，会以为 Esc 失灵。
 */
function bindPanelEscape() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !state.placingMode) return
    cancelPlacing()
    sampleAndRender()
  })
}

function startLoop() {
  let lastRender = 0
  let lastSignature = ''
  let lastCount = 0

  /** 一次完整的采样 + 重绘。rAF 与定时器都会调它。 */
  const tick = () => {
    try {
      const now = Date.now()
      // 每帧都读一次元件（内核这一调用只是给每个元件建一个轻量代理对象），
      // 这样用户放下元件后，面板表格立刻跟上，不会出现"内核 12 个、面板 11 行"。
      refreshElements()
      const signature = `${state.elements.length}|${state.elements.map((e) => e.type).join(',')}`
      const structureChanged = signature !== lastSignature
      const dueForRefresh = now - lastRender > ELEMENT_CACHE_MS
      if (structureChanged || dueForRefresh) {
        lastSignature = signature
        lastRender = now
        state.running = simIsRunning()
        state.time = simTime()
        renderSimState()
        renderTable()
      }
      // 元件数量增加 = 用户刚放下一个元件。内核此时仍停在 MODE_ADD_ELM，
      // 会继续跟着鼠标画下一个待放置元件；自动回到选择模式，免得用户被卡住。
      if (structureChanged && state.placingMode && state.elements.length > lastCount) {
        lastCount = state.elements.length
        cancelPlacing()
      } else {
        lastCount = state.elements.length
      }
      sampleTick()
      drawScope()
      renderScopeReadouts()
    } catch (err) {
      // 单帧异常不应打断整个循环（内核偶尔会在电路重建期间返回临时态）
      console.warn('[dsh-circuit] 采样帧异常', err)
    }
  }

  const loop = () => {
    tick()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  // 浏览器会把后台/失焦窗口的 requestAnimationFrame 降到 1Hz 甚至暂停；
  // 波形采样不能因此中断，所以另起一个定时器兜底（重复采样由 sampleTick 按
  // 仿真时间前进量自行去重，不会多记点）。
  state.timerId = setInterval(tick, 60)
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

/**
 * 视觉上移除内核顶栏菜单，但**保留它的 DOM**。
 *
 * 为什么不能直接把 hideMenu=true 传给内核：那样内核根本不创建菜单 DOM，
 * 而 LED / 灯泡 / 电流表 / 电压表 这些元件只存在于菜单里（工具栏只有 9 个图标，
 * 但面板提供 18 种元件），放置功能会直接失效。
 *
 * 所以这里改成注入一条 CSS：把菜单栏移出可视区但仍在文档里，
 * 用户看不到那排英文菜单，代码仍然能点它来放置元件。
 */
function hideKernelMenuBar() {
  const w = simWindow()
  if (!w) return
  let doc
  try { doc = w.document } catch { return }
  if (!doc) return
  const id = 'dsh-circuit-kernel-style'
  const apply = () => {
    try {
      const old = doc.getElementById(id)
      if (old) old.remove()
      const style = doc.createElement('style')
      style.id = id
      style.textContent = `
        /* 顶栏菜单：移出可视区，但保留 DOM（放置元件要用） */
        .gwt-MenuBar.gwt-MenuBar-horizontal {
          position: absolute !important;
          left: -99999px !important;
          top: 0 !important;
          width: 1px !important;
          height: 1px !important;
          overflow: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        /* 保留主工具栏（Add Resistor / Add Wire 等图标在这里） */
        .mainToolbar { display: flex !important; }
      `
      ;(doc.head || doc.documentElement).appendChild(style)
    } catch {
      // 注入失败不阻塞其余功能；此时用户能看到菜单栏，但一切仍可用。
    }
  }
  apply()
  // 内核对布局有几次重排，稍后再兜一次。
  setTimeout(apply, 800)
  setTimeout(apply, 2500)
}

/**
 * 把宿主外壳切成浮层布局。
 *
 * 宿主的 shellHtml 里 #panel 是右侧固定栏（width:440px; flex:0 0 440px）。
 * 但用户要的是"每个框独立可移动"，所以这里在前端把布局改成：
 *   - #stage 绝对定位铺满整窗（画布全屏）；
 *   - #panel 绝对铺满、pointer-events:none（只有里面的窗口能接收鼠标）。
 * 这样不重启宿主也能立即变成浮动窗口形态。
 */
function applyFloatingLayout() {
  try {
    const stage = document.getElementById('stage')
    const panel = document.getElementById('panel')
    if (stage) {
      stage.style.position = 'absolute'
      stage.style.inset = '0'
      stage.style.flex = 'none'
      stage.style.width = '100%'
    }
    if (panel) {
      panel.style.position = 'absolute'
      panel.style.inset = '0'
      panel.style.width = 'auto'
      panel.style.flex = 'none'
      panel.style.borderLeft = '0'
      panel.style.overflow = 'hidden'
      panel.style.pointerEvents = 'none'
      panel.style.background = 'transparent'
      panel.style.padding = '0'
    }
    document.body.style.position = 'relative'
    document.body.style.display = 'block'
  } catch {
    // 布局改写失败时退回宿主默认布局，功能仍可用。
  }
}

function boot() {
  // 把外壳切成"浮层模式"：画布占满整窗，所有面板都是浮在画布上的独立窗口。
  // 放在前端做是因为外壳 HTML 由宿主进程提供，改它要重启 DSH；在前端重写布局
  // 可以立即生效，不必打断用户。
  applyFloatingLayout()

  // 内核 iframe 参数：
  //   hideSidebar=true  → 去掉右侧那排滑杆侧栏（学生用不上，且是英文）
  //   **不能加 hideMenu=true** → 内核会因此完全不创建菜单 DOM，而我们的"元件快选"
  //   正是通过点「绘制」菜单条目来放置元件，菜单没了整条放置路径就废了。
  //   顶栏菜单本身保留，但用 CSS 把它移出可视区（见 hideKernelMenuBar）。
  const frame = simFrame()
  if (frame) {
    const base = frame.src.split('?')[0]
    frame.src = `${base}?lang=zh&hideSidebar=true`
  }

  hideKernelMenuBar()

  renderShell()
  renderTable()
  renderChannels()
  renderProbeRows()
  renderSimState()
  renderPlaceHint()

  whenSimReady(() => {
    toast('仿真内核已就绪：点元件，然后在画布上拖动放置')
  })

  const simIframe = simFrame()
  if (simIframe) {
    let lastLoadAt = 0
    simIframe.addEventListener('load', () => {
      // 内核首次装配与页面刷新都会触发 load；用时间窗去重，避免首帧被当成"重载"。
      const now = Date.now()
      if (now - lastLoadAt < 1000) return
      lastLoadAt = now
      state.api = null
      state.elements = []
      // 每次内核重新加载，菜单栏都是新建的 DOM，所以要重新注入隐藏样式。
      hideKernelMenuBar()
      whenSimReady(() => {
        hideKernelMenuBar()
        if (state.hasBootedOnce) toast('仿真内核已重新加载')
        state.hasBootedOnce = true
      })
    })
  }

  bindPanelEscape()
  startLoop()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}

// 诊断用只读快照：自动化验证与排障时读取真实采样数据，不参与正常渲染。
window.__dshCircuitDebug = () => ({
  channels: state.channels.map((c) => ({ key: c.key, label: c.label, signal: c.signal })),
  sampleCount: state.samples.length,
  firstT: state.samples.length ? state.samples[0].t : null,
  lastT: state.samples.length ? state.samples[state.samples.length - 1].t : null,
  spanT: state.samples.length ? state.samples[state.samples.length - 1].t - state.samples[0].t : null,
  lastValues: state.samples.length ? state.samples[state.samples.length - 1].values : [],
  elements: state.elements.length,
  simTime: simTime(),
})
