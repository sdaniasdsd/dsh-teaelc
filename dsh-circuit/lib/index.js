/**
 * dsh-circuit — 面向初中/高中物理的电路模拟器 DSH 插件（宿主侧）。
 *
 * 设计边界（重要）：
 *  - 仿真内核与绘图交互全部来自开源项目 CircuitJS1（Paul Falstad / Iain Sharp，
 *    GPL-2.0）。本插件不重新实现求解器，只把官方构建产物通过 HTTP 路由送到浏览器，
 *    并在其外再包一层中文学习面板（元件读数、波形记录、挑战校验）。
 *  - 因此本插件整体按 GPL-2.0 再发布；上游出处见 NOTICE 与 README。
 *  - /dsh-circuit 下的静态资源不依赖任何外网服务（无 CDN、无字体外链）。
 *
 * 宿主接口：只依赖 ctx.webServer。
 *   ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler })
 *   返回值为注销函数，交由 ctx.effect 托管。
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(PACKAGE_ROOT, '..', 'assets', 'app')
const ROUTE_PREFIX = '/dsh-circuit'
const APP_BASE = `${ROUTE_PREFIX}/app`
/** 全限定包名：插件自报标识与健康检查共用同一常量，避免两处漂移。 */
const PLUGIN_NAME = '@commonworks/dsh-circuit'

/** 允许服务的资源扩展名与 MIME。未列出的扩展名一律 404，避免暴露仓库其它文件。 */
const MIME_BY_EXT = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
])

/**
 * 站内图标：内联 SVG data URI。
 *
 * 为什么不放 favicon.ico：浏览器会自动请求 /favicon.ico，而本插件只占用
 * /dsh-circuit/* 前缀，宿主那张 404 会出现在控制台里，客户看到红字就以为坏了。
 * 内联在 <link rel="icon"> 里则不产生任何额外请求。
 */
const FAVICON_DATA_URI = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<rect width="24" height="24" rx="5" fill="#0d1117"/>' +
  '<path d="M3 12h3.5M17.5 12H21M6.5 7.5v9M17.5 7.5v9M10 12h4" ' +
  'stroke="#4ea1ff" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
)

/**
 * 上游 CircuitJS1 的控制台噪声兜底。
 *
 * 上游构建产物里做了两件会 404 的事，客户只看控制台会以为插件坏了：
 *  1) circuitjs.css 引用 images/hborder.png（GWT 菜单栏九宫格贴图）；
 *  2) 启动时无条件向 service-worker.js 注册 Service Worker。
 * 两者都不影响功能（菜单栏已被面板 CSS 移出可视区），但报错会一直挂在控制台。
 * 这里给它们各返回一个合法的空响应，把噪声消掉，不改变任何行为。
 */
const QUIET_FILES = new Map([
  // 1×1 透明 PNG：hborder.png 只是菜单栏背景贴图。
  ['images/hborder.png', {
    type: 'image/png',
    body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    ),
  }],
  // 空 Service Worker：注册会成功，然后立刻把自己注销，不留缓存劫持风险。
  ['service-worker.js', {
    type: 'text/javascript; charset=utf-8',
    body: Buffer.from(
      "self.addEventListener('install',()=>self.skipWaiting());" +
      "self.addEventListener('activate',()=>{self.registration.unregister();return self.clients.claim();});\n",
    ),
  }],
])

const CACHE_HEADERS = {
  // 内核 JS 有 1MB+，但版本固定：允许浏览器缓存，同时每次校验（no-cache），
  // 这样开发期改素材立刻生效，又不牺牲加载速度。
  'Cache-Control': 'no-cache',
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

/**
 * 只认回环 Host 的请求栅栏：本插件页面在用户自己的浏览器里跑，正常访问必然是
 * 127.0.0.1 / localhost / ::1。伪造 Host（DNS 重绑定）或明确的跨站请求一律拒绝。
 */
export function hostRejection(req) {
  try {
    const headers = (req && req.headers) || {}
    const rawHost = String(headers.host || '')
    if (!rawHost) return 403
    let parsed
    try {
      parsed = new URL(`http://${rawHost}`)
    } catch {
      return 403
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
    const loopback = hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '::1'
      || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    if (!loopback) return 403
    const site = String(headers['sec-fetch-site'] || '').toLowerCase()
    if (site === 'cross-site') return 403
    const origin = headers.origin
    if (origin) {
      let originHost
      try {
        originHost = new URL(String(origin)).host
      } catch {
        return 403
      }
      if (originHost !== rawHost) return 403
    }
    return null
  } catch {
    return 403
  }
}

/** 把 URL pathname 映射到 assets/app 下的绝对路径；越界或非白名单扩展名返回 null。 */
export function resolveAssetPath(pathname) {
  if (!pathname.startsWith(APP_BASE)) return null
  let rel = pathname.slice(APP_BASE.length)
  if (rel.startsWith('/')) rel = rel.slice(1)
  if (rel === '' || rel === 'index.html') rel = 'sim.html'
  let decoded
  try {
    decoded = decodeURIComponent(rel)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const abs = normalize(join(APP_ROOT, decoded))
  if (!abs.startsWith(APP_ROOT + sep)) return null
  if (!MIME_BY_EXT.has(extname(abs).toLowerCase())) return null
  return abs
}

/**
 * 上游噪声路径的静态响应（见 QUIET_FILES）。命中返回 Buffer，未命中返回 null。
 *
 * 单独抽出来是因为它必须**先于**磁盘查找：这些文件本来就不在 assets/app 里，
 * 走正常流程只会得到一张 404。
 */
export function quietAsset(pathname) {
  if (!pathname.startsWith(APP_BASE)) return null
  let rel = pathname.slice(APP_BASE.length)
  if (rel.startsWith('/')) rel = rel.slice(1)
  let decoded
  try {
    decoded = decodeURIComponent(rel)
  } catch {
    return null
  }
  return QUIET_FILES.get(decoded) ?? null
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

function sendJson(res, status, payload) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(payload))
}

/**
 * 页面外壳。
 *
 * 内核 iframe 只带 hideSidebar=true：右侧那排英文滑杆侧栏对学生没用，去掉。
 *
 * 注意**不能加 hideMenu=true**：内核在 hideMenu 模式下根本不创建菜单 DOM（实测
 * .gwt-MenuItem 数量为 0），而"元件快选"正是通过点击「绘制」菜单里的条目来放置
 * 元件（这是元件默认值、撤销记录都与手动操作一致的唯一官方路径）。菜单一旦消失，
 * 放置功能就整条失效。顶栏菜单保留即可，学生实际在右侧中文面板里操作。
 *
 * 布局：左侧画布 + 右侧面板；示波器放大时覆盖整个画布区（见 panel.js）。
 */
export function shellHtml(embed = false) {
  // 侧栏嵌入模式（?embed=1）：隐藏顶部许可声明条，画面更紧凑；
  // 浮层窗口仍然可用，它们在任何宽度下都能拖动摆放。
  const embedClass = embed ? ' class="is-embed"' : ''
  return `<!DOCTYPE html>
<html lang="zh-CN"${embedClass}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>电路小实验 · 电路模拟器</title>
<meta name="generator" content="CircuitJS1 (Paul Falstad / Iain Sharp, GPL-2.0) wrapped by dsh-circuit">
<link rel="icon" href="${FAVICON_DATA_URI}">
<link rel="stylesheet" href="${APP_BASE}/panel.css">
<style>
  /* 画布占满整窗；所有面板都是浮在画布上的独立窗口。 */
  html,body{height:100%;margin:0;background:#0d1117;color:#e6edf3}
  body{position:relative;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;overflow:hidden}
  #stage{position:absolute;inset:0;background:#000}
  #simframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  #panel{position:absolute;inset:0;pointer-events:none;overflow:hidden}
</style>
</head>
<body>
<div id="stage">
  <iframe id="simframe"
    src="${APP_BASE}/circuitjs.html?lang=zh&hideSidebar=true"
    allow="clipboard-read; clipboard-write"></iframe>
</div>
<aside id="panel"></aside>
<script src="${APP_BASE}/panel.js"></script>
</body>
</html>`
}

/** 注册全部路由，返回卸载函数。 */
export function mountRoutes(ctx) {
  const disposers = []
  dispose(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/`,
    handler(req, res) {
      const denied = hostRejection(req)
      if (denied) return sendText(res, denied, 'forbidden')
      // ?embed=1 走侧栏嵌入模式（更紧凑，供侧栏标签页的 iframe 使用）
      let embed = false
      try {
        embed = new URL(req.url ?? '/', 'http://x').searchParams.get('embed') === '1'
      } catch {
        embed = false
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(shellHtml(embed))
      return undefined
    },
  }))

  dispose(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/api/health`,
    handler(req, res) {
      const denied = hostRejection(req)
      if (denied) return sendText(res, denied, 'forbidden')
      sendJson(res, 200, {
        ok: true,
        plugin: PLUGIN_NAME,
        engine: 'circuitjs1',
        engineLicense: 'GPL-2.0',
        appBase: APP_BASE,
        simEntry: `${APP_BASE}/circuitjs.html`,
        panel: `${APP_BASE}/panel.js`,
      })
      return undefined
    },
  }))

  dispose(ctx.webServer.register({
    kind: 'prefix',
    path: APP_BASE,
    handler(req, res) {
      const denied = hostRejection(req)
      if (denied) return sendText(res, denied, 'forbidden')
      let pathname
      try {
        pathname = new URL(req.url ?? '/', 'http://x').pathname
      } catch {
        return sendText(res, 400, 'bad path')
      }
      // 先查上游噪声兜底表：这些路径本来就不在磁盘上，走查找只会 404。
      const quiet = quietAsset(pathname)
      if (quiet !== null) {
        res.writeHead(200, { 'Content-Type': quiet.type, ...CACHE_HEADERS, 'Content-Length': String(quiet.body.length) })
        res.end(req.method === 'HEAD' ? undefined : quiet.body)
        return undefined
      }
      const abs = resolveAssetPath(pathname)
      if (abs === null) return sendText(res, 404, 'not found: ' + pathname)
      return streamFile(req, res, abs, pathname)
    },
  }))

  return () => {
    for (const d of disposers) {
      try {
        d()
      } catch {
        // 卸载期清理失败不应影响宿主；路由表删除是幂等的。
      }
    }
  }

  function dispose(fn) {
    if (typeof fn === 'function') disposers.push(fn)
  }
}

/** 流式返回一个静态文件；目录穿越已在调用方校验，这里再做一次存在性与类型检查。 */
export async function streamFile(req, res, abs, displayPath) {
  try {
    const st = await stat(abs)
    if (!st.isFile()) return sendText(res, 404, `not found: ${displayPath ?? abs}`)
    const type = MIME_BY_EXT.get(extname(abs).toLowerCase()) ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type, ...CACHE_HEADERS, 'Content-Length': String(st.size) })
    if (req.method === 'HEAD') {
      res.end()
      return undefined
    }
    const stream = createReadStream(abs)
    stream.on('error', () => {
      if (!res.headersSent) sendText(res, 500, 'read error')
      else res.destroy()
    })
    stream.pipe(res)
    return undefined
  } catch {
    return sendText(res, 404, `not found: ${displayPath ?? abs}`)
  }
}

export const name = PLUGIN_NAME

/**
 * 本插件没有需要在宿主启动阶段参与 index.html 注入的逻辑：页面完全由自身路由提供，
 * 所以等服务就绪后再挂载是正确顺序，串行 inject 即可。
 */
export const inject = ['webServer']

export function apply(ctx, _config) {
  const unmount = mountRoutes(ctx)
  if (typeof ctx.effect === 'function') ctx.effect(() => unmount)
  return unmount
}

export const internals = {
  hostRejection,
  resolveAssetPath,
  quietAsset,
  QUIET_FILES,
  FAVICON_DATA_URI,
  shellHtml,
  mountRoutes,
  streamFile,
  APP_ROOT,
  ROUTE_PREFIX,
  APP_BASE,
}
