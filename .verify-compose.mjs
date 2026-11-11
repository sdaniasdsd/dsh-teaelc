/**
 * 按宿主机 dsh-client-modules 的真实规则（摘自 app.asar 的 lib/index.js），
 * 判断一个插件包会不会被收进浏览器客户端模块图。
 *
 * 规则来源（原函数 resolveMeta / clientExportOf / parseDshClient）：
 *   - pkg.dsh.client 存在，且 decl.platform === 'web'
 *   - decl.inject 只能是字符串数组，元素是**包名**
 *   - pkg.exports["./client"] 必须是字符串（或 { default: string }）
 *   - clientPath = join(dirname(pkgJsonPath), clientRel) 必须真实存在
 *   - inject 里的每个包必须能在 loader 解析到（否则该行等待依赖，apply 不执行）
 */
import fs from 'node:fs'
import path from 'node:path'

const pkgDir = process.argv[2]
if (!pkgDir) throw new Error('usage: node .verify-compose.mjs <package-dir>')

const pkgPath = path.join(pkgDir, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const problems = []

const decl = pkg?.dsh?.client
if (!decl) problems.push('dsh.client 未声明 -> 不收进 client 图')
else {
  if (typeof decl.platform !== 'string') problems.push('dsh.client.platform 非字符串')
  else if (decl.platform !== 'web') problems.push(`platform=${decl.platform} 非 web`)
  if (decl.inject !== undefined && !(Array.isArray(decl.inject) && decl.inject.every((x) => typeof x === 'string')))
    problems.push('dsh.client.inject 必须是字符串数组')
}

const client = pkg.exports?.['./client']
const rel = typeof client === 'string' ? client : client?.default
if (typeof rel !== 'string') problems.push('exports["./client"] 缺失或非字符串')
else {
  const abs = path.join(path.dirname(pkgPath), rel)
  if (!fs.existsSync(abs)) problems.push(`clientPath 不存在: ${rel}`)
  else {
    const src = fs.readFileSync(abs, 'utf8')
    if (!src.includes('window.__ModuleLoader__.load({')) problems.push('client 文件不含 __ModuleLoader__.load 装载协议')
  }
}

console.log(`package      : ${pkg.name}@${pkg.version}`)
console.log(`dsh.client   : ${JSON.stringify(decl)}`)
console.log(`./client     : ${rel ?? '(missing)'}`)
console.log(`inject       : ${JSON.stringify(decl?.inject ?? [])}   (空 = 不依赖其它客户端插件)`)
console.log(`VERDICT      : ${problems.length === 0 ? 'COMPOSES (会被收进浏览器模块图)' : 'REJECTED'}`)
for (const p of problems) console.log('  ! ' + p)
process.exit(problems.length === 0 ? 0 : 1)
