/**
 * dsh-circuit 客户端清单自测（不依赖 DSH 运行时，纯文件与静态分析）。
 *
 * 这个文件存在的唯一理由：0.1.0 曾经因为 `dsh.client.inject` 里写了一个宿主机上
 * **不存在**的包（@deepseek-ai/dsh-client-ui-slots），导致客户端模块永远等不到依赖、
 * apply 永不执行 —— 用户装完看不到任何入口。那是一次「清单写错、但路由测试全绿」
 * 才漏掉的事故，所以这里把清单契约写成断言。
 *
 * 运行：node --test test/
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const clientPath = join(PACKAGE_ROOT, 'client', 'client.js')
const clientSource = readFileSync(clientPath, 'utf8')

/**
 * 宿主机上确定不存在的「假想官方包」黑名单。
 * 这些名字看起来很像官方，但本机（DeepSeek Harness desktop 0.2.1-rc.3）的 app.asar 里没有。
 * 任何 inject 命中这里即视为回归。
 */
const PHANTOM_PACKAGES = ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']

describe('dsh-circuit 客户端清单', () => {
  it('声明了 web 平台的客户端半边', () => {
    const decl = manifest?.dsh?.client
    assert.ok(decl, 'package.json 必须声明 dsh.client')
    assert.equal(decl.platform, 'web', 'dsh.client.platform 必须为 web')
  })

  it('exports["./client"] 指向真实存在的文件', () => {
    const rel = manifest.exports?.['./client']
    assert.ok(rel, 'package.json 必须声明 exports["./client"]')
    assert.equal(typeof rel, 'string', 'exports["./client"] 必须是字符串形式')
    assert.ok(existsSync(join(PACKAGE_ROOT, rel)), `exports["./client"] 指向的文件不存在: ${rel}`)
    assert.ok(existsSync(clientPath), 'client/client.js 必须存在')
  })

  it('inject 里不含宿主机上不存在的包（0.1.0 事故的回归哨兵）', () => {
    const inject = manifest?.dsh?.client?.inject ?? []
    for (const name of PHANTOM_PACKAGES) {
      assert.ok(
        !inject.includes(name),
        `dsh.client.inject 不允许包含 ${name}：宿主机没有这个包，客户端模块会永远等不到它，` +
          '结果是 apply 永不执行、侧栏没有入口、页面打不开。slots 服务由客户端内核本身提供，不需要 inject。',
      )
    }
  })

  it('客户端 bundle 自己能声明 inject，且只声明真实服务名', () => {
    // 客户端模块 exports.inject 用的是「服务名」而不是包名（如 'slots'），
    // 所以这里只校验它存在且是非空字符串数组，并把 'slots' 列为已知服务。
    assert.match(
      clientSource,
      /inject:\s*\[\s*'slots'\s*\]/,
      '客户端模块必须 inject: [\'slots\']，且不要添加宿主机不存在包对应的服务名',
    )
    assert.match(clientSource, /window\.__ModuleLoader__\.load\(\{/, '必须使用宿主客户端模块装载协议')
  })

  it('apply 对 slots 做运行时存在性检查，缺服务时安全降级而不是抛错', () => {
    assert.match(
      clientSource,
      /typeof\s+slots\.register\s*!==\s*'function'/,
      'apply 必须检查 slots.register 是否可用，缺失时 return（抛错会导致整页白屏）',
    )
    assert.match(clientSource, /if\s*\(\s*!React\s*\)\s*return/, 'React 缺失时必须安全返回')
  })
})
