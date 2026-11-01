/* dsh-circuit — 浏览器端 bundle（左侧边栏入口 + 主区页面）。
 *
 * 加载方式：dsh-client-modules 把插件的 ./client 产物挂到 /plugins/dsh-circuit/client.js，
 * 由 shell 的 lazy-CJS 模块表执行（window.__ModuleLoader__.load）。
 *
 * 挂载点（取自宿主 dsh-client-ui-sidebar / ui-layout 的真实 slot 定义）：
 *   1) sidebar.panellist —— 左侧边栏的图标条目（list slot），这就是"左侧栏留个位置"
 *   2) main              —— 点左侧图标后打开的主内容页（键控 slot）
 *
 * 页面内容用 iframe 指向 /dsh-circuit/?embed=1，复用同一个模拟器：
 * 模拟器是 1MB 的 GWT 内核 + 一整套自绘浮层面板，重写成 React 没有收益，
 * 而 iframe 与宿主 React 渲染隔离，切走页面时销毁，不占后台 CPU。
 */

window.__ModuleLoader__.load({
  id: 'dsh-circuit',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ---- 平台种子：逐个 try，任一缺失都不能让 factory 抛出（否则 DSH 报插件加载失败）
    const seedProbe = { lastError: null }
    const requireSeed = (name) => {
      try {
        return require(name)
      } catch (err) {
        seedProbe.lastError = err
        return null
      }
    }

    requireSeed('react/jsx-runtime')
    const React = requireSeed('react')

    const PANEL_ID = 'dsh-circuit'
    const EMBED_SRC = '/dsh-circuit/?embed=1'
    const FULL_SRC = '/dsh-circuit/'

    /** 侧栏图标：内联 SVG，不依赖宿主 primitives（版本间图标集可能不同）。 */
    function CircuitIcon(props) {
      const size = (props && props.size) || 18
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        React.createElement('path', {
          d: 'M3 12h3.5M17.5 12H21',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
        React.createElement('path', {
          d: 'M6.5 7.5v9M17.5 7.5v9',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
        React.createElement('path', {
          d: 'M10 12h4',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
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
      if (!React) return

      const disposers = []
      const push = (d) => {
        if (typeof d === 'function') disposers.push(d)
      }

      const slots = ctx.slots
      if (!slots || typeof slots.inject !== 'function') return

      // 1) 左侧边栏图标条目
      push(
        slots.inject('sidebar.panellist', () =>
          slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: () => '电路小实验',
            },
            CircuitIcon,
          ),
        ),
      )

      // 2) 主区页面：点左侧图标后显示
      push(
        slots.inject('main', () =>
          slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              label: () => '电路小实验',
            },
            CircuitPage,
          ),
        ),
      )

      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          for (const d of disposers) {
            try {
              d()
            } catch {}
          }
        })
      }

      return () => {
        for (const d of disposers) {
          try {
            d()
          } catch {}
        }
      }
    }

    module.exports = {
      name: 'dsh-circuit-client',
      apply,
      inject: ['slots'],
    }
    return module.exports
  },
})
