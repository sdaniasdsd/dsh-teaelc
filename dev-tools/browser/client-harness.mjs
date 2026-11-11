/**
 * 在真实浏览器里跑 dsh-circuit 的**客户端半边**（client/client.js）。
 *
 * 为什么要这个：client.js 只能由 DSH 的 client-modules 装载，单独开 /dsh-circuit/
 * 根本不会执行它 —— 而 0.1.0 那次"装完看不见"的事故正是死在这一半，宿主的 HTTP
 * 路由测试却全绿。这里按宿主真实源码复刻装载协议与 slots 契约，然后真正执行它。
 *
 * 契约来源（均摘自 app.asar 内的宿主源码）：
 *  - window.__ModuleLoader__ 的 mode:"queue"/pendingQueue/load()   dsh-client-modules/lib/index.js bootInjections()
 *  - factory(require) 的 require 只提供平台种子（react 等）
 *  - ctx.slots.inject(name, fn) / slots.register(options, Component) / entriesOfSlot(name)
 *      —— dsh-client-ui-sidebar/lib/client.js、dsh-client-ui-layout/lib/client.js
 *  - 槽位声明：sidebar 声明 "sidebar.panellist"(kind:"list")，layout 声明 "main"(kind:"keyed")
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { startServer } from './serve.mjs'
import { open, OUTDIR } from './drive.mjs'

const CLIENT_SRC = readFileSync(
  resolve('D:/circuit电路模拟/dsh-circuit/client/client.js'),
  'utf8',
)

const results = []
const check = (n, cond, e) => {
  results.push({ ok: !!cond, name: n, extra: e })
  console.log(cond ? '  PASS' : '  FAIL', n, e === undefined ? '' : String(e).slice(0, 300))
}

const { url, server } = await startServer()
const { browser, page, logs } = await open(`${url}/dsh-circuit/`)

const out = await page.evaluate(async (src) => {
  const report = {
    registeredIds: [],
    slots: {},
    errors: [],
    applyReturned: null,
    componentsRenderable: {},
    disposers: 0,
  }

  // ---- 1) 复刻 __ModuleLoader__（语义同 dsh-client-modules 的 boot 注入） ----
  const pendingQueue = []
  const registered = new Map()
  window.__ModuleLoader__ = {
    mode: 'queue',
    pendingQueue,
    load(registration) { pendingQueue.push(registration) },
    create() {
      this.mode = 'live'
      for (const reg of pendingQueue) registered.set(reg.id, reg)
    },
  }

  // ---- 2) 平台种子 ----
  const reactStub = {
    createElement: (tag, props, ...kids) => ({ $$el: true, tag, props: props || {}, kids }),
    useRef: (v) => ({ current: v }),
    useEffect: (fn) => { try { fn() } catch (e) { report.errors.push('useEffect: ' + e.message) } },
    useState: (v) => [v, () => {}],
    Fragment: 'Fragment',
  }

  // ---- 3) slots 契约 ----
  const slotEntries = new Map()
  const slots = {
    entriesOfSlot(n) { return slotEntries.get(n) ?? [] },
    entries(n) { return slotEntries.get(n) ?? [] },
    inject(slotName, fn) { return fn() },
    register(options, component) {
      const name = options && options.name
      if (typeof name !== 'string' || !name) throw new Error('slots.register: options.name 必填')
      const list = slotEntries.get(name) ?? []
      list.push({ options, component })
      slotEntries.set(name, list)
      report.slots[name] = (report.slots[name] ?? 0) + 1
      return () => {
        const cur = slotEntries.get(name) ?? []
        slotEntries.set(name, cur.filter((e) => e !== list[list.length - 1]))
        report.disposers += 1
      }
    },
    provideRoot() { return () => {} },
    subscribe() { return () => {} },
  }

  let effectRun = false
  const ctx = {
    slots,
    locale: { register: () => () => {}, bind: () => (k) => k, subscribe: () => () => {} },
    effect: (fn) => { effectRun = true; const d = fn(); return typeof d === 'function' ? d : () => {} },
    get: () => undefined,
  }

  // ---- 4) 执行真实的 client.js ----
  try {
    ;(0, eval)(src)
  } catch (e) {
    report.errors.push('eval: ' + (e && e.message))
    return report
  }

  // 宿主启动顺序：先 create()（把 queue 里的注册搬进 live 表），再按 id materialize + apply
  window.__ModuleLoader__.create()
  report.registeredIds = [...registered.keys()]

  const reg = registered.get('dsh-circuit')
  if (!reg) { report.errors.push('client.js 没有注册 id="dsh-circuit"'); return report }

  const requireStub = (name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return reactStub
    const err = new Error("Cannot find module '" + name + "'")
    err.code = 'MODULE_NOT_FOUND'
    throw err
  }

  let mod
  try {
    mod = reg.factory(requireStub)
  } catch (e) {
    report.errors.push('factory threw: ' + (e && e.stack || e))
    return report
  }

  report.exportsName = mod && mod.name
  report.exportsInject = mod && mod.inject
  report.hasApply = typeof (mod && mod.apply) === 'function'

  try {
    report.applyReturned = typeof mod.apply === 'function' ? typeof mod.apply(ctx) : 'no apply'
  } catch (e) {
    report.errors.push('apply threw: ' + (e && e.stack || e))
  }

  // ---- 5) 校验注册结果与真实宿主契约是否吻合 ----
  const panellist = slots.entriesOfSlot('sidebar.panellist')
  const main = slots.entriesOfSlot('main')
  report.panellistCount = panellist.length
  report.mainCount = main.length
  report.panellistOptions = panellist.map((e) => e.options)
  report.mainOptions = main.map((e) => e.options)

  // 组件能否被渲染（用 stub React 调一次，捕获运行时错误）
  const render = (entry) => {
    try {
      const node = entry.component({ size: 18, active: false })
      return node && node.$$el ? 'ok' : 'unexpected'
    } catch (e) {
      return 'threw: ' + e.message
    }
  }
  report.componentsRenderable.panellist = panellist.map(render)
  report.componentsRenderable.main = main.map(render)

  report.slotNames = [...slotEntries.keys()]
  return report
}, CLIENT_SRC)

console.log('\n== 客户端半边装载 ==')
console.log(JSON.stringify(out, null, 2))

console.log('\n== 断言 ==')
check('client.js 注册了 id="dsh-circuit"', out.registeredIds.includes('dsh-circuit'), out.registeredIds)
check('factory 没有抛异常', out.errors.filter((e) => /factory threw/.test(e)).length === 0, out.errors.join(' | '))
check('导出 apply 函数', out.hasApply === true)
check('导出的 inject 只有 slots（服务名，不是包名）',
  JSON.stringify(out.exportsInject) === JSON.stringify(['slots']),
  JSON.stringify(out.exportsInject))
check('注册进 sidebar.panellist（侧栏入口）', out.panellistCount === 1, JSON.stringify(out.panellistOptions))
check('注册进 main（主区页面）', out.mainCount === 1, JSON.stringify(out.mainOptions))
check('没有注册到不存在的槽位', (out.mainCount + out.panellistCount) === out.slotNames.length, JSON.stringify(out.slotNames))

const pl = out.panellistOptions[0] || {}
const mn = out.mainOptions[0] || {}
check('sidebar.panellist 条目带 id/order/label', pl.id === 'dsh-circuit' && pl.order !== undefined && pl.label === '电路小实验', JSON.stringify(pl))
check('main 条目带 key=id 与 label', mn.key === 'dsh-circuit' && mn.label === '电路小实验', JSON.stringify(mn))
check('侧栏图标组件能渲染', out.componentsRenderable.panellist.every((r) => r === 'ok'), JSON.stringify(out.componentsRenderable.panellist))
check('主区页面组件能渲染', out.componentsRenderable.main.every((r) => r === 'ok'), JSON.stringify(out.componentsRenderable.main))
check('apply 期间没有异常', out.errors.length === 0, out.errors.join(' | '))

await page.screenshot({ path: resolve(OUTDIR, 'client-harness.png') })
const failed = results.filter((r) => !r.ok)
console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' passed ====')
await browser.close()
server.close()
process.exit(failed.length ? 1 : 0)
