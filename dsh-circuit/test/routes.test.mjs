/**
 * dsh-circuit 插件自测（不依赖 DSH 运行时）。
 *
 * 用一个最小的假 webServer 上下文挂载真实路由，再起 node:http 监听，
 * 然后直接用 HTTP 请求验证：
 *   - 路由注册种类与路径正确
 *   - 外壳页包含 iframe 与面板脚本
 *   - 静态资源可访问、MIME 正确
 *   - 目录穿越被拒
 *   - 非白名单扩展名被拒
 *   - Host 栅栏拒绝跨站/伪造 Host
 *   - 卸载函数会注销全部路由
 *
 * 运行：node --test test/
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'

import { apply, internals } from '../lib/index.js'

const { shellHtml, resolveAssetPath, hostRejection } = internals

/** 最小 webServer 服务桩：只实现 register，语义与宿主一致（重复注册抛错）。 */
function createFakeWebServer() {
  const routes = { exact: new Map(), prefix: new Map() }
  const registrationOrder = []
  return {
    routes,
    registrationOrder,
    register(route) {
      const table = route.kind === 'exact' ? routes.exact : routes.prefix
      if (table.has(route.path)) throw new Error(`duplicate ${route.kind} route "${route.path}"`)
      table.set(route.path, route)
      registrationOrder.push(route)
      return () => table.delete(route.path)
    },
    match(pathname) {
      const exact = routes.exact.get(pathname)
      if (exact) return exact
      let best
      for (const [prefix, route] of routes.prefix) {
        if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
        if (!best || prefix.length > best.path.length) best = { ...route, path: prefix }
      }
      return best
    },
  }
}

describe('dsh-circuit 路由', () => {
  let webServer
  let agent
  let base
  let unmount

  before(async () => {
    webServer = createFakeWebServer()
    const ctx = { webServer, effect: undefined }
    apply(ctx, {})
    const server = createServer(async (req, res) => {
      const pathname = new URL(req.url, 'http://x').pathname
      const route = webServer.match(pathname)
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('no route')
        return
      }
      try {
        await route.handler(req, res)
      } catch (err) {
        res.writeHead(500)
        res.end(String(err))
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    agent = server
    base = `http://127.0.0.1:${server.address().port}`
    unmount = () => apply.__unmount
  })

  after(() => {
    agent.close()
  })

  it('注册了外壳页、健康检查与静态前缀三类路由', () => {
    assert.equal(webServer.routes.exact.size, 2)
    assert.equal(webServer.routes.prefix.size, 1)
    assert.ok(webServer.routes.exact.has('/dsh-circuit/'))
    assert.ok(webServer.routes.exact.has('/dsh-circuit/api/health'))
    assert.ok(webServer.routes.prefix.has('/dsh-circuit/app'))
  })

  it('外壳页返回 200 且包含 iframe 与面板脚本', async () => {
    const res = await fetch(`${base}/dsh-circuit/`)
    assert.equal(res.status, 200)
    const html = await res.text()
    assert.match(html, /<iframe id="simframe"/)
    assert.match(html, /\/dsh-circuit\/app\/panel\.js/)
    assert.match(html, /panel\.css/)
    // 外壳页本身不应把上游内核塞进同一文档
    assert.doesNotMatch(html, /src=".*circuitjs\.js"/)
  })

  it('健康检查返回插件与内核元信息', async () => {
    const res = await fetch(`${base}/dsh-circuit/api/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.engine, 'circuitjs1')
    assert.equal(body.engineLicense, 'GPL-2.0')
  })

  it('内核 JS 与面板脚本可访问且 MIME 正确', async () => {
    for (const [path, type] of [
      ['/dsh-circuit/app/circuitjs.js', 'text/javascript'],
      ['/dsh-circuit/app/panel.js', 'text/javascript'],
      ['/dsh-circuit/app/panel.css', 'text/css'],
      ['/dsh-circuit/app/sim.html', 'text/html'],
    ]) {
      const res = await fetch(`${base}${path}`)
      assert.equal(res.status, 200, `${path} 应可访问`)
      assert.match(res.headers.get('content-type'), new RegExp(type))
    }
  })

  it('示例电路与语言包可访问', async () => {
    const circuit = await fetch(`${base}/dsh-circuit/app/circuits/ohms.txt`)
    assert.equal(circuit.status, 200)
    assert.match(await circuit.text(), /^\$ 1 /)

    const locale = await fetch(`${base}/dsh-circuit/app/locale/locale_zh.txt`)
    assert.equal(locale.status, 200)
  })

  it('目录穿越被拒绝', async () => {
    const res = await fetch(`${base}/dsh-circuit/app/..%2F..%2Fpackage.json`)
    assert.equal(res.status, 404)
  })

  it('非白名单扩展名不服务', async () => {
    const res = await fetch(`${base}/dsh-circuit/app/circuitjs.js.map`)
    assert.equal(res.status, 404)
  })

  it('未知路径 404', async () => {
    const res = await fetch(`${base}/dsh-circuit/app/does-not-exist.html`)
    assert.equal(res.status, 404)
  })
})

describe('防护函数', () => {
  it('回环 Host 放行', () => {
    assert.equal(hostRejection({ headers: { host: '127.0.0.1:63797' } }), null)
    assert.equal(hostRejection({ headers: { host: 'localhost:8080' } }), null)
    assert.equal(hostRejection({ headers: { host: '[::1]:9000' } }), null)
  })

  it('伪造 Host 拒绝', () => {
    assert.equal(hostRejection({ headers: { host: 'evil.example.com' } }), 403)
    assert.equal(hostRejection({ headers: { host: '127.0.0.1.evil.com' } }), 403)
    assert.equal(hostRejection({ headers: {} }), 403)
  })

  it('跨站与异源 Origin 拒绝', () => {
    assert.equal(hostRejection({
      headers: { host: '127.0.0.1:63797', 'sec-fetch-site': 'cross-site' },
    }), 403)
    assert.equal(hostRejection({
      headers: { host: '127.0.0.1:63797', origin: 'http://evil.example.com' },
    }), 403)
    assert.equal(hostRejection({
      headers: { host: '127.0.0.1:63797', origin: 'http://127.0.0.1:63797' },
    }), null)
  })

  it('资源路径解析拒绝越界与非法扩展名', () => {
    assert.equal(resolveAssetPath('/dsh-circuit/app/../../package.json'), null)
    assert.equal(resolveAssetPath('/dsh-circuit/app/circuitjs.js.map'), null)
    assert.ok(resolveAssetPath('/dsh-circuit/app/circuitjs.js') !== null)
    assert.ok(resolveAssetPath('/dsh-circuit/app/sim.html') !== null)
  })

  it('shellHtml 引用相对前缀而不是绝对域名', () => {
    const html = shellHtml()
    assert.ok(html.includes('/dsh-circuit/app/circuitjs.html'))
    assert.ok(!html.includes('http://localhost'))
  })
})
