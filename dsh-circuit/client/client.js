/* dsh-circuit — 浏览器端 bundle（左侧边栏入口 + 主区页面）。
 *
 * 装载协议：dsh-client-modules 按 package.json 的 `dsh.client` 与 `exports["./client"]`
 * 找到本文件，映射到 /plugins/dsh-circuit/client.js，由 window.__ModuleLoader__.load 执行。
 *
 * 关键约束（曾经踩过坑，别再改回去）：
 *  1) `dsh.client.inject` 里写的**必须是真实存在的包名**。它表示"我要和这些插件的
 *     客户端模块一起装载、并用它们提供的服务"。写一个宿主机上不存在的包名，声明仍能
 *     通过组合期校验，但该行会永远等不到那个模块 → apply 永不执行 → 侧栏没有条目、
 *     页面也打不开（表现就是"装了看不见"）。
 *     本机（DeepSeek Harness 桌面端 0.2.1-rc.3）实测**没有** dsh-client-ui-slots；
 *     它提供的 `slots` 服务是客户端内核本身就有的，不需要也不应该放进 inject。
 *  2) 因此 inject 只保留真正被引用的包，并且 apply 里对每个服务都做**运行时存在性检查**：
 *     服务没到就安全降级，绝不让 factory 抛出（抛了就是整页白屏）。
 *  3) 槽位注册走宿主真实 API：ctx.slots.register({ name, id/key, order, label }, 组件)，
 *     与 dsh-client-ui-sidebar / layout 的用法一致；label 可传字符串或返回字符串的函数。
 *
 * 副产物：宿主路由 /dsh-circuit/* 由 Host 半边（lib/index.js）注册，与客户端是否加载无关。
 * 所以即使客户端没挂上，/dsh-circuit/ 仍然可以直接在浏览器里打开——可以用它来自检。
 */

window.__ModuleLoader__.load({
  id: 'dsh-circuit',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ---- 平台种子：逐个 try，任一缺失都不能让 factory 抛出
    const requireSeed = (name) => {
      try {
        return require(name)
      } catch (err) {
        return null
      }
    }

    const React = requireSeed('react')
    requireSeed('react/jsx-runtime')

    const PANEL_ID = 'dsh-circuit'
    const EMBED_SRC = '/dsh-circuit/?embed=1'
    const FULL_SRC = '/dsh-circuit/'

    /** 侧栏图标：内联 SVG，不依赖宿主 primitives（版本间图标集可能不同）。 */
    function CircuitIcon(props) {
      const size = (props && props.size) || 18
      const h = React.createElement
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 12h3.5M17.5 12H21', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
        h('path', { d: 'M6.5 7.5v9M17.5 7.5v9', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
        h('path', { d: 'M10 12h4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
      )
    }

    /** 主区页面：工具条 + iframe。切走时销毁 iframe 以停止后台仿真。 */
    function CircuitPage() {
      const hostRef = React.useRef(null)

      React.useEffect(() => {
        const host = hostRef.current
        if (!host) return undefined

        const bar = document.createElement('div')
        bar.style.cssText = [
          'flex:0 0 auto',
          'display:flex',
          'align-items:center',
          'gap:10px',
          'height:38px',
          'padding:0 12px',
          'border-bottom:1px solid #22303c',
          'background:#111821',
          'font-size:12.5px',
          'color:#cfe3ff',
        ].join(';')

        const title = document.createElement('span')
        title.textContent = '电路小实验'
        title.style.cssText = 'font-weight:700;letter-spacing:.4px'
        bar.appendChild(title)

        const sub = document.createElement('span')
        sub.textContent = '拖放元件搭电路 · 测量电压电流 · 示波器看波形'
        sub.style.cssText = 'color:#6b7885;font-size:11px'
        bar.appendChild(sub)

        const spacer = document.createElement('span')
        spacer.style.flex = '1 1 auto'
        bar.appendChild(spacer)

        const popBtn = document.createElement('button')
        popBtn.textContent = '独立窗口'
        popBtn.title = '在独立窗口打开完整模拟器'
        popBtn.style.cssText = [
          'appearance:none',
          'border:1px solid #2a3a49',
          'border-radius:5px',
          'background:#18212b',
          'color:#e6edf3',
          'font-family:inherit',
          'font-size:11px',
          'padding:4px 10px',
          'cursor:pointer',
        ].join(';')
        popBtn.addEventListener('click', () => {
          window.open(FULL_SRC, '_blank', 'noopener')
        })
        bar.appendChild(popBtn)

        const frame = document.createElement('iframe')
        frame.src = EMBED_SRC
        frame.allow = 'clipboard-read; clipboard-write'
        frame.style.cssText = [
          'flex:1 1 auto',
          'min-height:0',
          'width:100%',
          'border:0',
          'background:#000',
          'display:block',
        ].join(';')

        const wrap = document.createElement('div')
        wrap.style.cssText = [
          'position:absolute',
          'inset:0',
          'display:flex',
          'flex-direction:column',
          'min-height:0',
          'background:#0d1117',
          'overflow:hidden',
        ].join(';')
        wrap.appendChild(bar)
        wrap.appendChild(frame)
        host.appendChild(wrap)

        return () => {
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap)
        }
      }, [])

      return React.createElement('div', {
        ref: hostRef,
        className: 'dsh-circuit-page',
        style: {
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 0,
        },
      })
    }

    // ---- 注册 --------------------------------------------------------------
    function apply(ctx) {
      // React 拿不到说明平台种子异常，但也不能抛：直接放弃 UI，Host 路由仍然可用。
      if (!React) return

      const slots = ctx && ctx.slots
      if (!slots || typeof slots.register !== 'function') return

      const disposers = []
      const push = (d) => {
        if (typeof d === 'function') disposers.push(d)
      }

      // 1) 左侧边栏图标条目（list slot，条目在左栏占一行）
      push(
        slots.inject('sidebar.panellist', () =>
          slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: '电路小实验',
            },
            CircuitIcon,
          ),
        ),
      )

      // 2) 主区页面：点左侧条目后按 key 选中这块面板
      push(
        slots.inject('main', () =>
          slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              label: '电路小实验',
            },
            CircuitPage,
          ),
        ),
      )

      const disposeAll = () => {
        for (const d of disposers) {
          try {
            d()
          } catch {}
        }
      }

      if (typeof ctx.effect === 'function') {
        ctx.effect(() => disposeAll, 'dsh-circuit: slots')
      }

      return disposeAll
    }

    module.exports = {
      name: 'dsh-circuit-client',
      apply,
      // 只注入客户端内核本来就有、且本文件真正用到的服务。
      // 不要加任何宿主机上不存在的包（血的教训，见文件头注释）。
      inject: ['slots'],
    }
    return module.exports
  },
})
