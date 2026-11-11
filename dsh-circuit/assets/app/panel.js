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
  channels: [],           // { key, type, index, label, color, signal: 'i'|'v' }
  // 电路代次：每次整体换电路（加载预设/清空）就 +1。
  // 通道记下自己属于哪一代；代次不符就报"断线"，绝不去新电路里按 (type,index)
  // 重新找元件 —— 那会静默读到另一个元件的数值（实测：加载新预设后 CH2 显示
  // 的是新电路里同序号电阻的电流，数字看着正常但是错的）。
  circuitGen: 0,
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
  // 武装时刻（仿真时间）：单次触发的"到时兜底"以它为起点，抓到的永远是武装之后的数据
  triggerArmedAt: 0,
  zoomBox: null,
  // 被用户 × 掉的窗口 id 集合。存在 localStorage 里跟着窗口几何一起走，
  // 但「面板」菜单永远能把它们重新打开 —— 这样"关窗"不再是单向门。
  closedWins: {},
  // 帮助窗口是否已经自动打开过一次（只自动弹一次，之后由用户从「面板」菜单开）
  helpSeen: false,
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
    gen: state.circuitGen,
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
 * 单次触发要攒够的采样点数（约一屏能画满的量）。
 *
 * 按**点数**而不是按时间：采样密度由电路决定（5µs 步长的 RC 电路跑 10 秒真实时间
 * 才推进几十毫秒仿真时间），按时间要客户干等一分钟以上。点数判据对快慢电路都一致。
 */
const TRIGGER_CAPTURE_SAMPLES = 240
/** 武装后最多等这么多点还抓不到边沿，就改用"从武装点起算"（单调信号如 RC 充电走这条）。 */
const TRIGGER_ARM_SAMPLES = 80

/**
 * 选择触发源通道：第一个当前有有效读数、且处于启用状态的通道。
 * @param values 本帧各通道的读数
 * @returns 通道下标；没有任何可用通道时返回 -1
 */
function pickTriggerChannel(values) {
  for (let ci = 0; ci < state.channels.length; ci += 1) {
    if (!state.channels[ci].enabled) continue
    if (Number.isFinite(values[ci])) return ci
  }
  return -1
}

/** state.samples 里 t >= since 的点数。 */
function countSamplesSince(since) {
  if (!since) return state.samples.length
  let n = 0
  for (let i = state.samples.length - 1; i >= 0; i -= 1) {
    if (state.samples[i].t < since) break
    n += 1
  }
  return n
}

/**
 * 从已有样本里算出第 ci 个通道的触发电平（(最大值 + 最小值) / 2）。
 *
 * 这就是示波器 AUTO 触发做的事：把电平放在信号摆幅的中点，任何周期波形都会
 * 稳定地穿过它。样本还不足以定出摆幅时返回 null（此时继续等，不假装触发）。
 *
 * @param ci 通道下标
 * @returns 参考电平，或 null
 */
function triggerLevelFromSamples(ci) {
  if (state.samples.length < 4) return null
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const s of state.samples) {
    const v = s.values[ci]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  // 摆幅太小说明是直流（没有可触发的边沿），返回 null 继续等
  if (max - min < Math.max(Math.abs(max), 1e-12) * 1e-3) return null
  return (max + min) / 2
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
      if (channel.gen !== undefined && channel.gen !== state.circuitGen) {
        values.push(Number.NaN)
        continue
      }
      const el = state.elements.find((e) => e.index === channel.currentIndex && e.type === channel.currentType)
      values.push(el ? el.current : Number.NaN)
      continue
    }
    // 电位差通道：V = V(正端) − V(负端)，与真实示波器的正负端接线语义一致。
    // 负端默认接地，因此默认就是"单端对地测量"；选两个探头就是差分测量。
    if (channel.measure === 'voltage' || channel.type === 'probe') {
      const pos = probeValue(channel.positive, channel.gen)
      const neg = probeValue(channel.negative, channel.gen)
      values.push(pos === null || neg === null ? Number.NaN : pos - neg)
      continue
    }
    // 兼容旧式"绑定元件"通道：元件被删除后记 NaN，波形断开，但通道本身保留。
    if (channel.gen !== undefined && channel.gen !== state.circuitGen) {
      values.push(Number.NaN)
      continue
    }
    const el = state.elements.find((e) => e.index === channel.index && e.type === channel.type)
    values.push(el ? (channel.signal === 'i' ? el.current : el.vd) : Number.NaN)
  }
  state.time = t
  state.lastSampleAt = Date.now()
  state.samples.push({ t, values })

  // 单次触发（Single）：抓一段波形后冻结仿真，这是真实示波器 Single 的语义。
  //
  // 触发条件有两种，必须都支持 —— 原实现只判"上升穿越参考电平"，对教学里最常见的
  // 信号根本不成立：
  //   a) **边沿触发**：信号双向穿越参考电平（周期波形：正弦、方波）。
  //   b) **到时触发**：从武装起攒够一屏时间（单调信号：电容充电曲线一路往上，
  //      物理上只有一个上升沿，而且发生在武装之前，永远等不到第二次穿越）。
  //      实测「电容器充放电」预设正是这种情况：电压从 4.53 V 一路升到 4.88 V 不回穿，
  //      原实现于是永远不冻结。
  //
  // 参考电平用已积累样本的 (max+min)/2（示波器 AUTO 电平的做法），不拿当前样点当参考
  // ——原来 `meanish = triggerRef === null ? v0 : triggerRef` 里 triggerRef 从未赋值，
  // 条件恒假，这是"单次触发没反应"的直接原因。
  // 触发源：第一个**有有效读数**的启用通道。
  //
  // 不能固定用 CH1：客户换电路后旧通道可能已经断线（读数是 NaN），此时 CH1 永远
  // 不产生边沿，而 CH2 明明是正常的波形 —— 单次触发就再也不工作了。实测正是如此。
  const triggerIndex = pickTriggerChannel(values)
  if (state.triggerMode === 'single' && triggerIndex >= 0) {
    const v0 = values[triggerIndex]

    if (state.triggerArmed && Number.isFinite(v0)) {
      if (state.triggerRef === null || state.triggerRef === undefined) {
        const level = triggerLevelFromSamples(triggerIndex)
        if (level !== null) state.triggerRef = level
      }
      const ref = state.triggerRef
      if (ref !== null && ref !== undefined && state.triggerLastV !== null) {
        // 双向穿越：上升沿和下降沿都算（真实示波器可选边沿极性，教学场景取任一沿即可）
        const crossed = (state.triggerLastV < ref && v0 >= ref) || (state.triggerLastV > ref && v0 <= ref)
        if (crossed) {
          state.triggerArmed = false
          state.samples = [{ t, values }]
          state.triggerStartT = t
          state.triggerCapturing = true
        }
      }
      state.triggerLastV = v0

      // (b) 兜底：武装后攒够 TRIGGER_ARM_SAMPLES 个点还没等到边沿，就从武装点起算。
      //
      // 为什么不能用"仿真时间够一屏"当兜底：一屏时长是 effectiveTimebase() 算出来的，
      // 而它本身又由"已攒了多少数据"决定 —— 目标会跟着数据一起长大，永远追不上
      // （实测：武装后仿真时间推进 0.074s，需求窗同时长到 0.080s，差一点点，永不触发）。
      // 改成按**采样点个数**判定，个数是单调递增且与窗口大小无关的，一定收敛。
      if (state.triggerArmed && countSamplesSince(state.triggerArmedAt) >= TRIGGER_ARM_SAMPLES) {
        state.triggerArmed = false
        const recent = state.samples.filter((sm) => sm.t >= state.triggerArmedAt)
        state.samples = recent.length >= 2 ? recent : state.samples.slice(-2)
        state.triggerStartT = state.samples.length ? state.samples[0].t : t
        state.triggerCapturing = true
      }
    }

    if (state.triggerCapturing) {
      // 完成条件：攒够一屏的点数，或仿真时间已跑满一屏（高速信号用后者）。
      // 两个条件都是"只增不减"的量，保证一定会结束。
      const captured = countSamplesSince(state.triggerStartT)
      if (captured >= TRIGGER_CAPTURE_SAMPLES || t - (state.triggerStartT || t) >= screenSpan()) {
        state.triggerCapturing = false
        state.triggerArmed = false
        setSimRunning(false)
        renderSimState()
        toast('单次触发完成：已冻结一屏波形（改回"自动滚动"继续观察）')
      }
    }
  }

  // 裁剪历史样本。注意要保住"触发武装点"和"触发起点"之后的数据 —— 否则单次触发
  // 攒点期间旧点被裁掉，countSamplesSince 的起点就失效了。
  const cutoff = t - (SAMPLE_WINDOW_S * 2.2)
  const keepFrom = Math.max(
    cutoff,
    state.triggerArmed && state.triggerArmedAt ? Math.min(state.triggerArmedAt, cutoff) : cutoff,
    state.triggerCapturing && state.triggerStartT ? Math.min(state.triggerStartT, cutoff) : cutoff,
  )
  while (state.samples.length > 2 && state.samples[0].t < keepFrom) state.samples.shift()
}

/**
 * 读取一个测量点的数值（探头正端/负端用）。
 * 返回 null 表示"该点当前不可用"（元件被删除或尚未插入电路）。
 */
function probeValue(id, gen) {
  if (!id || id === '__gnd__') return 0
  // 代次不符 = 这个测点属于上一份电路，当前电路里同序号元件是**另一个**元件，
  // 读它会静默给出错误的数。直接报"不可用"（NaN 断开），让客户自己重新接。
  if (gen !== undefined && gen !== state.circuitGen) return null
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

/**
 * 当前"一屏"实际用的时基（秒/格）。
 *
 * 规则与示波器的自动时基一致：
 *  - 默认用用户选的档位；
 *  - 数据跨度明显填不满一屏时，连续收缩到刚好占满约 92% 屏宽（不细于 10µs/格）。
 *
 * 抽出来给触发逻辑共用，保证"触发抓一屏"和"屏幕上看到一屏"是同一个时间窗。
 */
function effectiveTimebase() {
  const userTimebase = state.timebase || 0.1
  const dataSpan = state.samples.length
    ? state.samples[state.samples.length - 1].t - state.samples[0].t
    : 0
  if (dataSpan > 0 && dataSpan < userTimebase * 10 * 0.75) {
    return Math.max(dataSpan / 10 / 0.92, 10e-6)
  }
  return userTimebase
}

/** 一屏的时间跨度（秒）。 */
function screenSpan() {
  return effectiveTimebase() * 10
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
  // 有效时基 = 用户档位，但数据填不满一屏时按实际跨度连续收缩。
  // 抽成函数是因为「单次触发」必须用同一个值：它原来看的是用户档位（默认 100ms/格
  // = 一屏 1 秒仿真时间），而教学电路（如 RC 充电）跑 10 秒真实时间才推进几十毫秒
  // 仿真时间 —— 按用户档位等"一屏"等于永远等不到，触发永远不冻结。
  const timebase = effectiveTimebase()
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
      // 换了整份电路：旧通道一律作废（见 state.circuitGen 的注释）。
      // 必须在 import 之后 +1，这样表格重建时高亮判定立刻按新代次走。
      state.circuitGen += 1
      state.samples = []
      await new Promise((resolve) => setTimeout(resolve, 120))
      refreshElements()
      status.textContent = `已加载「${item.name}」——可以直接拖动元件、改参数`
      toast(`已加载「${item.name}」`)
      // 通道名要在新代次下重算：否则显示的还是上一份电路的"电阻#0"，而电路已经换了。
      for (const ch of state.channels) updateChannelLabel(ch)
      renderTable()
      renderChannels()
      renderProbeRows()
      renderScopeReadouts()
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

/**
 * 顶部给「面板」菜单条预留的高度。
 *
 * 菜单条固定在左上角（窗口全关后它是唯一入口），所以默认窗口一律从它下面开始，
 * 否则第一个窗口的标题栏会被菜单条压住，客户点不到拖动区。
 */
const MENUBAR_H = 34

const WINDOW_DEFS = [
  {
    id: 'dc-win-parts',
    title: '元件快选',
    build: () => renderPartsSection(),
    default: { x: 12, y: MENUBAR_H + 4, w: 300, h: 300 },
  },
  {
    id: 'dc-win-measure',
    title: '测量台',
    build: () => renderMeasureSection(),
    default: { x: 12, y: MENUBAR_H + 4 + 310, w: 300, h: 300 },
  },
  {
    id: 'dc-win-scope',
    title: '示波器',
    build: () => renderScopeSection(),
    default: { x: 322, y: MENUBAR_H + 4, w: 520, h: 430 },
  },
  {
    id: 'dc-win-presets',
    title: '经典电路',
    build: () => renderPresetsSection(),
    // 高度收敛到 460：客户笔记本常见 1366×768，右列若占 560 再叠「怎么用」窗，
    // 加起来必然超出屏幕高度（实测底边到 856，超出 88px）。
    default: { x: 860, y: MENUBAR_H + 4, w: 400, h: 460 },
  },
  {
    id: 'dc-win-help',
    title: '怎么用',
    build: () => renderHelpSection(),
    // 帮助窗落在「经典电路」下面那格（右列底部），**不能压住中间画布**。
    // 客户看完帮助的第一步就是去画布上放元件；窗口盖在画布中部会让那一下点空
    // （实测：帮助窗放在 322,478 时，客户在 (420,700) 拖放电阻，点击被窗口吃掉，
    //  元件数停在 1 不动）。右列 x=860 本来就是面板列，底部空着，放这里两头不挡。
    default: { x: 860, y: MENUBAR_H + 4 + 466, w: 400, h: 236 },
  },
]

/**
 * 一个窗口至少要有这么多像素留在可视区内，否则用户再也抓不到它的标题栏。
 * 取 48：足够露出标题文字和右半边的 —/× 按钮。
 */
const WIN_KEEP_VISIBLE = 48
/** 标题栏高度：窗口顶部允许拖到负值，但不能把整条标题栏拖出屏幕。 */
const WIN_BAR_H = 30

/**
 * 把一组窗口几何夹进当前可视区。
 *
 * 为什么必须有这一步：几何存在 localStorage 里，客户今天在 1920 宽的显示器上摆好，
 * 明天换 1366 的笔记本，若不夹取，窗口坐标原样恢复 → 窗口落在可视区之外，
 * 而且**没有任何入口能把它拉回来**（这正是"误点 × 后整个插件变砖"的同源问题）。
 *
 * @param g 形如 { x, y, w, h } 的几何
 * @param fallback 兜底默认几何（视口太小时按它缩）
 * @returns 夹取后的新对象，不修改入参
 */
function clampGeom(g, fallback) {
  const vw = Math.max(window.innerWidth || 0, 320)
  const vh = Math.max(window.innerHeight || 0, 240)
  const base = fallback || { x: 12, y: 12, w: 300, h: 260 }
  const out = {
    x: Number.isFinite(g.x) ? g.x : base.x,
    y: Number.isFinite(g.y) ? g.y : base.y,
    w: Number.isFinite(g.w) ? g.w : base.w,
    h: Number.isFinite(g.h) ? g.h : base.h,
  }
  // 尺寸：不小于最小宽高，也不大于视口（否则永远看不到右下角的缩放柄）
  out.w = Math.min(Math.max(out.w, 220), Math.max(220, vw - 8))
  out.h = Math.min(Math.max(out.h, 120), Math.max(120, vh - MENUBAR_H - 8))
  // .dc-win 有 1px 边框，getBoundingClientRect 比 style 宽高各大 2px；
  // 夹取时预留出来，否则"刚好贴底"在视觉上仍然是溢出 2px。
  const BORDER = 2

  // 位置夹取规则：**先挪，挪不动再缩**。
  // 客户在 1920 宽屏上把窗口摆在 y=900，换 1366×768 笔记本后必须把 y 挪回屏内；
  // 但若窗口本身比屏幕还高，光挪没用 —— 此时要压缩高度，否则底部（含右下角缩放柄）
  // 永远在屏幕外，客户既看不到内容、也调不回来。实测「怎么用」窗在 768 高的屏上
  // 底边到 856，属于这一类。
  out.x = Math.max(0, Math.min(out.x, vw - WIN_KEEP_VISIBLE))
  // 负坐标必须先夹到 0：只判"底边超出"的话，y=-800 这种"窗口在屏幕上方之外"
  // 会被漏掉（底边 -368 < vh，条件不成立），客户永远拖不回来。实测复现过。
  out.y = Math.max(0, Math.min(out.y, vh - WIN_BAR_H))
  if (out.y + out.h + BORDER > vh) {
    out.y = Math.max(0, vh - out.h - BORDER)
    if (out.y + out.h + BORDER > vh) {
      out.y = MENUBAR_H + 4
      out.h = Math.max(120, vh - out.y - 4 - BORDER)
    }
  }
  if (out.y + WIN_BAR_H > vh) out.y = Math.max(0, vh - WIN_BAR_H)
  if (out.x + out.w + BORDER > vw) out.w = Math.max(220, vw - out.x - 4 - BORDER)
  return out
}

const WIN_GEOM_KEY = 'dsh-circuit:window-geom'
const HELP_SEEN_KEY = 'dsh-circuit:help-seen'

function loadGeom() {
  try {
    const raw = JSON.parse(localStorage.getItem(WIN_GEOM_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function saveGeom(all) {
  try {
    localStorage.setItem(WIN_GEOM_KEY, JSON.stringify(all))
  } catch {
    // localStorage 可能被浏览器策略拒绝（隐私模式/禁用存储）。窗口位置存不下
    // 只影响"下次打开还记得摆哪"，不影响使用，所以静默忽略。
  }
}

/** 清掉全部窗口几何并重建全部窗口：客户点「恢复默认布局」走这条路径。 */
function resetLayout() {
  try {
    localStorage.removeItem(WIN_GEOM_KEY)
  } catch {
    // 同 saveGeom：存不下不影响恢复动作本身。
  }
  state.closedWins = {}
  renderShell()
  renderTable()
  renderChannels()
  renderProbeRows()
  renderSimState()
  renderPlaceHint()
  toast('已恢复默认布局')
}

/** 创建一个浮动窗口：标题栏拖动移动，右下角拖动缩放。 */
function makeWindow(def) {
  const geom = loadGeom()
  // 关键：几何先夹进当前视口再使用。客户换分辨率后旧坐标可能整窗在屏幕外。
  const g = clampGeom({ ...def.default, ...(geom[def.id] || {}) }, def.default)

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
    class: 'dc-win-btn', type: 'button', title: '关闭（可从"面板"菜单重新打开）', text: '×',
    onclick: () => {
      win.style.display = 'none'
      // 记住"这个窗口被关了"，刷新页面也保持关闭；但「面板」菜单永远能重新打开。
      state.closedWins[def.id] = true
      persistGeom(win)
      renderPanelMenu()
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
  // 只在标题栏空白处拖动：按到 —/× 按钮时不能触发移动（否则点了按钮窗口会跳）。
  const target = ev.target
  if (target && target.closest && target.closest('.dc-win-btn')) return
  if (ev.button !== 0) return
  ev.preventDefault()
  const startX = ev.clientX
  const startY = ev.clientY
  const ox = win.offsetLeft
  const oy = win.offsetTop
  const vw = Math.max(window.innerWidth || 0, 320)
  const vh = Math.max(window.innerHeight || 0, 240)
  const onMove = (e) => {
    // 拖动过程中就夹取，而不是只夹左/上：老实现只做 Math.max(0, ...)，
    // 客户把窗口拖到屏幕右边外面后松手，窗口就此"飞了"再也拖不回来。
    const nx = ox + (e.clientX - startX)
    const ny = oy + (e.clientY - startY)
    g.x = Math.max(0, Math.min(nx, vw - WIN_KEEP_VISIBLE))
    g.y = Math.max(0, Math.min(ny, vh - WIN_BAR_H))
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
  if (ev.button !== 0) return
  ev.preventDefault()
  ev.stopPropagation()
  const startX = ev.clientX
  const startY = ev.clientY
  const ow = win.offsetWidth
  const oh = win.offsetHeight
  const vw = Math.max(window.innerWidth || 0, 320)
  const vh = Math.max(window.innerHeight || 0, 240)
  const onMove = (e) => {
    // 上限：不能把窗口拉得比视口还大，否则右下角缩放柄跑到屏幕外，客户再也没法调回来。
    g.w = Math.max(220, Math.min(ow + (e.clientX - startX), vw - g.x - 4))
    g.h = Math.max(140, Math.min(oh + (e.clientY - startY), vh - g.y - 4))
    win.style.width = `${g.w}px`
    win.style.height = `${g.h}px`
    // 尺寸变了：示波器画布必须跟着重设 bitmap，否则波形被拉伸/裁切。
    scheduleScopeResize()
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    persistGeom(win)
    scheduleScopeResize(true)
  }
  document.body.style.cursor = 'nwse-resize'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/** 拖动缩放时按帧节流重绘示波器：每像素重设一次 canvas bitmap 太浪费。 */
let scopeResizePending = false
function scheduleScopeResize(force) {
  if (force) {
    scopeResizePending = false
    requestAnimationFrame(() => drawScope())
    return
  }
  if (scopeResizePending) return
  scopeResizePending = true
  requestAnimationFrame(() => {
    scopeResizePending = false
    drawScope()
  })
}

function persistGeom(win) {
  const all = loadGeom()
  all[win.id] = { ...win.__geom }
  all.__closed = { ...state.closedWins }
  saveGeom(all)
}

function renderShell() {
  const panel = document.getElementById('panel')
  panel.innerHTML = ''
  panel.classList.add('dc-floating')

  const closed = loadGeom().__closed
  if (closed && typeof closed === 'object') state.closedWins = { ...closed }

  for (const def of WINDOW_DEFS) {
    const win = makeWindow(def)
    // 上次被 × 掉的窗口保持关闭，但下面那个「面板」菜单能重新打开它。
    if (state.closedWins[def.id]) win.style.display = 'none'
    panel.appendChild(win)
  }

  ui.toast = el('div', { class: 'dc-toast' })
  document.body.appendChild(ui.toast)

  renderPanelMenu()
  applyResponsiveLayout()
}

/**
 * 「面板」菜单：整个插件的逃生舱。
 *
 * 为什么必须有：每个浮窗标题栏上都有 ×，客户误点一下窗口就没了。原实现里
 * "关掉 = 永久消失"，只能刷新页面（而刷新后几何又从 localStorage 恢复成关闭态，
 * 等于刷新也救不回来）。这里提供一个常驻的、不受浮窗状态影响的入口：
 *   - 列出全部窗口，勾选 = 打开，取消 = 关闭；
 *   - 「恢复默认布局」清空 localStorage 并重建；
 *   - 「帮助」随时重新打开说明窗。
 *
 * 菜单本身挂在 #panel 内的固定角落，pointer-events 单独打开，所以窗口全关时它还在。
 */
function renderPanelMenu() {
  if (ui.menuBar) {
    ui.menuBar.innerHTML = ''
  } else {
    ui.menuBar = el('div', { class: 'dc-menubar', id: 'dc-menubar' })
    const panel = document.getElementById('panel')
    if (!panel) return
    panel.appendChild(ui.menuBar)
    document.addEventListener('click', (ev) => {
      if (!ui.menuBar) return
      if (ui.menuBar.contains(ev.target)) return
      const dd = ui.menuBar.querySelector('.dc-menu-dropdown')
      if (dd) dd.classList.remove('is-open')
    })
  }

  const title = el('span', { class: 'dc-menubar-title' })
  title.innerHTML = probeIconSvg('#4ea1ff', 13) + '<b>电路小实验</b>'
  ui.menuBar.appendChild(title)

  const dropdown = el('div', { class: 'dc-menu-dropdown' })
  for (const def of WINDOW_DEFS) {
    const isOpen = !state.closedWins[def.id]
    const item = el('button', {
      class: `dc-menu-item${isOpen ? ' is-on' : ''}`,
      type: 'button',
      onclick: () => {
        toggleWindow(def.id)
        renderPanelMenu()
      },
    }, [
      el('span', { class: 'dc-menu-check', text: isOpen ? '✓' : '' }),
      el('span', { text: def.title }),
    ])
    dropdown.appendChild(item)
  }
  dropdown.appendChild(el('div', { class: 'dc-menu-sep' }))
  dropdown.appendChild(el('button', {
    class: 'dc-menu-item', type: 'button', text: '恢复默认布局',
    onclick: () => {
      dropdown.classList.remove('is-open')
      resetLayout()
      renderPanelMenu()
    },
  }))
  dropdown.appendChild(el('button', {
    class: 'dc-menu-item', type: 'button', text: '清除界面记忆并刷新',
    title: '清掉窗口位置记忆后重新加载页面（界面错乱时的最后一招）',
    onclick: () => {
      try { localStorage.removeItem(WIN_GEOM_KEY) } catch { /* 存不下不影响刷新 */ }
      window.location.reload()
    },
  }))

  const trigger = el('button', {
    class: 'dc-menubar-btn', type: 'button', text: '面板 ▾',
    title: '打开/关闭各个面板窗口，或恢复默认布局',
    onclick: (ev) => {
      ev.stopPropagation()
      dropdown.classList.toggle('is-open')
    },
  })
  ui.menuBar.appendChild(trigger)
  ui.menuBar.appendChild(dropdown)
}

/** 打开或关闭某个窗口（by id），并同步记忆与菜单勾选状态。 */
function toggleWindow(id) {
  const win = document.getElementById(id)
  if (!win) return
  const willOpen = win.style.display === 'none'
  win.style.display = willOpen ? '' : 'none'
  if (willOpen) {
    state.closedWins[id] = false
    // 重新打开时确保它在可视区内（可能是上次在别的分辨率下关掉的）
    const def = WINDOW_DEFS.find((d) => d.id === id)
    const all = loadGeom()
    const g = clampGeom({ ...(def ? def.default : {}), ...(all[id] || {}) }, def ? def.default : undefined)
    win.style.left = `${g.x}px`
    win.style.top = `${g.y}px`
    win.style.width = `${g.w}px`
    win.style.height = `${g.h}px`
    if (win.__geom) Object.assign(win.__geom, g)
    scheduleScopeResize(true)
  } else {
    state.closedWins[id] = true
  }
  const all = loadGeom()
  all.__closed = { ...state.closedWins }
  saveGeom(all)
}

/**
 * 窄屏兜底：客户笔记本常见 1366×768，默认布局右边界 1262 刚好贴边，
 * 更窄（1280、或浏览器缩放到 125%）时「经典电路」会被推到屏幕外。
 * 这里在首次渲染和窗口尺寸变化时把每个窗口夹回可视区。
 */
function applyResponsiveLayout() {
  for (const def of WINDOW_DEFS) {
    const win = document.getElementById(def.id)
    if (!win || win.style.display === 'none') continue
    const g = win.__geom
    if (!g) continue
    const c = clampGeom(g, def.default)
    if (c.x !== g.x || c.y !== g.y || c.w !== g.w || c.h !== g.h) {
      Object.assign(g, c)
      win.style.left = `${c.x}px`
      win.style.top = `${c.y}px`
      win.style.width = `${c.w}px`
      win.style.height = `${c.h}px`
    }
  }
  scheduleScopeResize(true)
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

/**
 * 「怎么用」面板。
 *
 * 客户第一次打开时看到的是四个浮窗 + 一块黑色画布，没有任何文字告诉他下一步做什么
 * （菜单栏被 CSS 移出可视区、元件名仍是英文）。这个面板就是补上这条最短路径：
 * 四步走完一个能跑的电路，再看读数、再上示波器。
 */
function renderHelpSection() {
  const wrap = el('div', { class: 'dc-help' })

  const steps = [
    ['① 放元件', '左边「元件快选」里点一个（例如「电阻」），然后把鼠标移到黑色画布上按住拖动，松手就放好了。放完会自动回到选择状态。'],
    ['② 连成回路', '点「导线」，在画布上从元件的一端拖到另一端。连不通的地方会显示成半截线，补一段导线即可。'],
    ['③ 接电源和接地', '点「直流电源」放一个，再用「接地」放一个。电路里必须有接地，否则求解器算不出各点电位。'],
    ['④ 看读数', '「测量台」每一行就是一个元件，右边是它的电压和电流，每半秒刷新一次。'],
    ['⑤ 看波形', '在「测量台」某一行点 V 或 I，这个量就接到「示波器」上。滚轮缩放时间轴，框选放大细节。'],
  ]
  for (const [head, body] of steps) {
    wrap.appendChild(el('div', { class: 'dc-help-step' }, [
      el('b', { class: 'dc-help-head', text: head }),
      el('span', { class: 'dc-help-body', text: body }),
    ]))
  }

  wrap.appendChild(el('div', { class: 'dc-help-tip' }, [
    el('b', { text: '不想自己搭？' }),
    el('span', { text: '右边「经典电路」里点一个现成的（欧姆定律、分压、RC 充电……），加载后可以直接拖动、改数值。' }),
  ]))
  wrap.appendChild(el('div', { class: 'dc-help-tip' }, [
    el('b', { text: '窗口不见了？' }),
    el('span', { text: '左上角「面板 ▾」里可以重新打开任意窗口，或点「恢复默认布局」。' }),
  ]))
  wrap.appendChild(el('div', { class: 'dc-help-tip' }, [
    el('b', { text: '改元件的值：' }),
    el('span', { text: '在画布上右键元件 → Edit，或把鼠标停在该元件上滚轮微调。' }),
  ]))

  return el('section', { class: 'dc-section', id: 'dc-help-section' }, [
    el('div', { class: 'dc-section-head' }, [
      el('h2', { text: '怎么用' }),
      el('span', { class: 'dc-hint', text: '五步搭出一个能跑的电路' }),
    ]),
    el('div', { class: 'dc-section-body' }, [wrap]),
  ])
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

  // 画布尺寸跟随容器：CSS 给了 height:100%，但 canvas 的 bitmap 需要显式重设，
  // 否则窗口拉高后波形还是按旧高度画（原实现实测：窗口 422→550 高，canvas 仍然
  // 200 高，多出来的空白区什么都不画）。resize 由 drawScope 自己按 clientWidth/
  // clientHeight 重设 bitmap，这里只负责在尺寸变化时触发一次重绘。
  if (typeof ResizeObserver === 'function') {
    state.scopeObserver = new ResizeObserver(() => scheduleScopeResize())
    state.scopeObserver.observe(ui.scopeCanvas)
  }
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

  // 垂直档位：自动 / 手动「每格多少」。
  //
  // 单位跟着**当前启用的通道**走：只测电流时列 A/格，否则列 V/格。
  // 原实现恒列 V/格，客户量 50mA 却只能选"1 V/格"，档位名与实际量纲不符。
  ui.vdivSelect = el('select', { class: 'dc-scope-select' })
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
    // 不清空样本：耦合只影响**绘制时**是否减去各自均值（见 drawScope 的 means），
    // 样本本身始终是真实测量值。清空会让客户一切换就丢失刚抓到的波形。
    drawScope()
    renderScopeReadouts()
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
      state.triggerArmedAt = simTime()
      // triggerRef 必须一起归零：否则会沿用上一次触发（可能来自另一个电路）的电平，
      // 结果永远等不到穿越。
      state.triggerRef = null
      toast('单次触发：正在等上升沿，抓到后冻结一屏')
    } else {
      state.triggerArmed = false
      state.triggerCapturing = false
      state.triggerRef = null
      state.triggerLastV = null
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
    // 顺序有讲究：通道读数（峰峰/RMS/频率）排在探头选择行**之前**。
    // 探头行随通道数增长，若排在读数前面，3 通道时读数会被挤出窗口底部（实测被裁掉），
    // 而读数才是学生最常看的东西。
    el('div', { class: 'dc-section-body' }, [
      ui.chips, ctl1, ctl2, ui.scopeWrap, ui.scopeMeta, ui.readouts, ctl3, ui.probeRows,
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
      gen: state.circuitGen,
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
      gen: state.circuitGen,
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

  // 新增通道必须立刻算好显示名：原实现 label 留空，客户在通道条上看到的是
  // 一片空白，几乎无法判断这个通道测的是什么。
  updateChannelLabel(state.channels[state.channels.length - 1])

  state.samples = []
  renderChannels()
  renderProbeRows()
  renderScopeReadouts()
  // 测量台对应行的高亮要跟着变（与 addChannel 保持一致，同样防重入）。
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

  // 电流测点：电流表、导线、以及有电流的元件。
  //
  // 排序很重要：`addProbeChannel('current')` 默认取第一个测点。原来的顺序就是
  // 电路里的元件顺序，实测第一个常常是 VarRailElm（电位器滑杆）或导线 ——
  // 对初中教学来说几乎总是错的答案。这里按"测量意义"分组，让电阻/灯泡/LED/
  // 电容/电感/电流表排在前面，导线与电源垫底。
  const CURRENT_MEANINGFUL = [
    'AmmeterElm',
    'ResistorElm', 'LampElm', 'LEDElm', 'DiodeElm',
    'CapacitorElm', 'InductorElm',
    'PotElm', 'SwitchElm',
  ]
  const rank = (type) => {
    const i = CURRENT_MEANINGFUL.indexOf(type)
    if (i >= 0) return i
    if (type === 'WireElm') return 900
    if (type === 'VoltageElm' || type === 'DCVoltageElm' || type === 'ACVoltageElm') return 950
    return 500
  }
  const currentPoints = []
  for (const e of state.elements) {
    if (e.type === 'ProbeElm' || e.type === 'OutputElm' || e.type === 'GroundElm') continue
    const hint = elementValueHint(e)
    currentPoints.push({
      id: `${e.type}#${e.index}:i`,
      label: hint ? `${e.label}#${e.index} ${hint} 电流（${fmtA(e.current)}）` : `${e.label}#${e.index} 电流（${fmtA(e.current)}）`,
      kind: 'current',
      type: e.type,
      index: e.index,
      rank: rank(e.type),
    })
  }
  currentPoints.sort((a, b) => a.rank - b.rank || a.index - b.index)
  for (const p of currentPoints) points.push(p)
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
      // 措辞跟着实际布局走：按钮在探头行之上，所以是"上面"。
      text: '点上面的"+ 电压通道"或"+ 电流通道"。电压通道接两个探头（正端−负端），电流通道选一个元件。',
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
      const stale = ch.gen !== undefined && ch.gen !== state.circuitGen
      const wantId = ch.currentType + '#' + ch.currentIndex + ':i'
      // 断线通道不要把"新电路里第一个元件"顶上来当选中项：那会让客户以为它已经接好了，
      // 实际读的却是另一个元件。留空，等客户自己重新选（选完会更新代次）。
      sel.value = currentOpts.some((p) => p.id === wantId) && !stale ? wantId : ''
      if (!sel.value && currentOpts.length && !stale) sel.value = currentOpts[0].id
      sel.addEventListener('change', () => {
        const p = currentOpts.find((x) => x.id === sel.value)
        if (p) {
          ch.currentType = p.type
          ch.currentIndex = p.index
          // 客户重新指定了测点 = 这个通道重新接回当前电路
          ch.gen = state.circuitGen
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
        const stale = ch.gen !== undefined && ch.gen !== state.circuitGen
        const valid = probeOpts.some((p) => p.id === current) && !stale
        sel.value = valid ? current : '__gnd__'
        sel.addEventListener('change', () => {
          // 客户动了这个下拉 = 把通道重新接回当前电路
          ch.gen = state.circuitGen
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

/**
 * 从内核 getInfo() 里取这元件的**参数摘要**，用来区分同类元件。
 *
 * 为什么需要：一个电路里常常有好几个电阻。原实现给通道起名叫"电阻 电压"，
 * 两个电阻就得到两个一模一样的名字，客户在下拉框里根本分不清哪个是哪个。
 * 内核的 getInfo() 会给出真实参数（`R = 1 kΩ`），直接取来做后缀即可。
 *
 * @param e state.elements 里的一项
 * @returns 形如 `1 kΩ` 的短标签；取不到时返回空串（不编造）
 */
function elementValueHint(e) {
  if (!e || !Array.isArray(e.info)) return ''
  for (const raw of e.info) {
    const line = String(raw || '')
    const m = /^[A-Za-z_]+\s*=\s*(.+)$/.exec(line)
    if (!m) continue
    const value = m[1].trim()
    // 电流/电压/功率是**测量结果**，不是元件参数：拿它命名会让名字每帧都变。
    if (/^(I|V|Vd|P|W)\s*=/.test(line)) continue
    if (!value) continue
    return value
  }
  return ''
}

/** 在通道列表里给同名通道加序号，保证客户能分辨（电阻(1) / 电阻(2)）。 */
function uniqueChannelLabel(label, self) {
  const same = state.channels.filter((c) => c !== self && c.label === label)
  if (same.length === 0) return label
  const used = new Set(state.channels.filter((c) => c !== self).map((c) => c.label))
  for (let i = 1; i <= state.channels.length + 2; i += 1) {
    const candidate = `${label} #${i}`
    if (!used.has(candidate)) return candidate
  }
  return label
}

/** 依据测量点选择刷新通道显示名。 */
function updateChannelLabel(ch) {
  const all = collectProbePoints()
  const lookup = (id) => {
    if (id === '__gnd__' || !id) return '接地'
    const p = all.find((x) => x.id === id)
    return p ? p.label : '（已断开）'
  }

  // 代次不符：这个通道属于上一份电路。必须直接标明"已断开"，绝不能去新电路里
  // 按 (type,index) 找同序号元件 —— 那会给出一个看起来正常、实际错误的读数。
  if (ch.gen !== undefined && ch.gen !== state.circuitGen) {
    ch.label = '（已断开 · 换过电路）'
    return
  }

  if (channelIsCurrent(ch)) {
    const target = state.elements.find((e) => e.type === ch.currentType && e.index === ch.currentIndex)
    if (!target) {
      ch.label = '（已断开）'
    } else {
      const hint = elementValueHint(target)
      // 编号跟着元件序号走：同型号的第二个电阻叫"电阻#3"，客户能对上表格。
      const base = `${target.label}#${target.index}`
      ch.label = hint ? `${base} ${hint} 电流` : `${base} 电流`
    }
  } else {
    // 电压通道：区分"单端对地"和"两点电位差"
    const pos = lookup(ch.positive)
    const neg = lookup(ch.negative)
    ch.label = neg === '接地' ? `${pos}（对地）` : `电位差 (${pos} − ${neg})`
  }
  ch.label = uniqueChannelLabel(ch.label, ch)
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

  // 签名里带上内核给的参数摘要：客户把电阻从 1k 改成 2k 后，表格里"±"数值靠
  // 500ms 轮询能刷，但通道名/下拉选项里的 `R = 1 kΩ` 是构建期取的，不重建就永远是旧值。
  const signature = state.elements.map((e) => `${e.type}#${e.index}:${elementValueHint(e)}`).join('|')
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

    // 高亮判定必须同时认两代通道写法：
    //  - 旧式：addChannel() 写的 { type, index, signal }
    //  - 新式：addProbeChannel() 写的 { measure:'current', currentType, currentIndex }
    // 只判旧式的话，用示波器面板"+ 电流通道"加进来的通道在表格里永远不高亮，
    // 客户点了按钮看不到任何反馈，会以为功能坏了。
    const hasV = state.channels.some((c) => c.type === e.type && c.index === e.index && c.signal === 'v' && !channelIsCurrent(c))
    const hasI = state.channels.some((c) => channelIsCurrent(c) && (
      (c.currentType === e.type && c.currentIndex === e.index)
      || (c.type === e.type && c.index === e.index && c.signal === 'i')
    ))
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


/**
 * 重建纵向档位下拉，单位跟着当前启用通道走（全电流 → A/格，否则 V/格）。
 *
 * 只在"单位或档位列表"真的变了时重建，避免每帧重设 select 把用户的选择冲掉。
 */
function rebuildVerticalScale() {
  if (!ui.vdivSelect) return
  const enabled = state.channels.filter((c) => c.enabled)
  const onlyCurrent = enabled.length > 0 && enabled.every((c) => channelIsCurrent(c))
  const unit = onlyCurrent ? 'A' : 'V'
  const table = onlyCurrent ? AMPS_PER_DIV : VOLTS_PER_DIV
  const fmt = onlyCurrent ? fmtA : fmtV
  const sig = `${unit}:${table.join(',')}`
  if (ui.vdivSig === sig) return
  ui.vdivSig = sig

  // 保留用户已选的档位（若新表里没有就退回自动）
  const prev = state.voltsPerDiv
  ui.vdivSelect.innerHTML = ''
  ui.vdivSelect.appendChild(el('option', { value: '0', text: '自动' }))
  for (const v of table) {
    ui.vdivSelect.appendChild(el('option', { value: String(v), text: `${fmt(v)}/格` }))
  }
  if (prev > 0 && table.some((v) => Math.abs(v - prev) < 1e-18)) {
    ui.vdivSelect.value = String(prev)
  } else {
    if (prev > 0) state.voltsPerDiv = 0
    ui.vdivSelect.value = '0'
  }
}

function renderChannels() {
  if (!ui.chips) return
  rebuildVerticalScale()
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

  // 两个窗口各有一个运行按钮（测量台 + 示波器），状态必须同步。
  // 原实现只更新测量台那个，客户在示波器里点暂停后按钮仍显示"运行"，看起来像没反应。
  if (ui.runBtn) ui.runBtn.textContent = state.running ? '暂停仿真' : '继续仿真'
  if (ui.scopeRunBtn) {
    ui.scopeRunBtn.textContent = state.running ? '运行' : '已暂停'
    ui.scopeRunBtn.classList.toggle('is-on', !state.running)
  }
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

  // 视口变化（客户改窗口大小、换接显示器、浏览器缩放）时把窗口夹回可视区。
  // 不做这一步：客户在 1920 上摆好布局，缩到 1280 后右半边窗口全部跑到屏幕外。
  window.addEventListener('resize', () => {
    applyResponsiveLayout()
  })

  // 第一次打开时自动展开「怎么用」。只自动弹一次（记在 localStorage），
  // 之后由「面板 ▾」菜单手动打开，免得每次刷新都挡着画布。
  try {
    const seen = localStorage.getItem(HELP_SEEN_KEY) === '1'
    if (!seen) {
      localStorage.setItem(HELP_SEEN_KEY, '1')
      const helpWin = document.getElementById('dc-win-help')
      if (helpWin && state.closedWins['dc-win-help']) {
        delete state.closedWins['dc-win-help']
        helpWin.style.display = ''
        renderPanelMenu()
      }
    } else if (!state.closedWins['dc-win-help']) {
      // 已看过但没关它：保持默认打开
    } else {
      const helpWin = document.getElementById('dc-win-help')
      if (helpWin) helpWin.style.display = 'none'
    }
  } catch {
    // localStorage 不可用时就不做"只弹一次"的记忆，帮助窗按默认几何显示。
  }

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
