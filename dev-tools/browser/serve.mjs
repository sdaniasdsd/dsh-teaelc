/**
 * 用一个真实 node:http 服务器挂载 dsh-circuit 的路由，供浏览器自动化测试使用。
 * 目的：脱离 DSH 宿主（GUI 有 401 鉴权）也能跑真实渲染，测到的就是插件自己的行为。
 */
import { createServer } from 'node:http'
import { apply } from '../../dsh-circuit/lib/index.js'

function createFakeWebServer() {
  const routes = { exact: new Map(), prefix: new Map() }
  return {
    routes,
    register(route) {
      const table = route.kind === 'exact' ? routes.exact : routes.prefix
      if (table.has(route.path)) throw new Error(`duplicate ${route.kind} route "${route.path}"`)
      table.set(route.path, route)
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

export async function startServer(port = 0) {
  const webServer = createFakeWebServer()
  apply({ webServer }, {})
  const server = createServer(async (req, res) => {
    let pathname
    try {
      pathname = new URL(req.url, 'http://x').pathname
    } catch {
      res.writeHead(400); res.end('bad'); return
    }
    const route = webServer.match(pathname)
    if (!route) { res.writeHead(404); res.end('no route'); return }
    try {
      await route.handler(req, res)
    } catch (err) {
      res.writeHead(500); res.end(String(err))
    }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` }
}

