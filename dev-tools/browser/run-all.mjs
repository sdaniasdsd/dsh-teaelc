/**
 * 一键跑全部验收：node 单测 + 缺陷回归 + 客户端半边 + 客户流程。
 * 客户端的"能用/无 bug"以这四条全绿为准。
 */
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 用脚本自身所在目录做基准，而不是 process.cwd()：
// 从仓库根目录 `node dev-tools/browser/run-all.mjs` 调用时，'.' 会解析到仓库根，
// 各套件会找不到 drive.mjs 而全挂（实测过）。这里固定成脚本目录。
const HERE = dirname(fileURLToPath(import.meta.url))

const suites = [
  ['node 单测（路由/清单/防护）', 'node', ['--test', 'test/routes.test.mjs', 'test/manifest.test.mjs'], 'D:/circuit电路模拟/dsh-circuit'],
  ['缺陷回归（P0/P1/P2）', 'node', ['regress.mjs'], '.'],
  ['客户端半边（侧栏入口/主区页面）', 'node', ['client-harness.mjs'], '.'],
  ['客户流程（首次使用端到端）', 'node', ['customer-flow.mjs'], '.'],
  ['跨电路串号（通道不得读到别的元件）', 'node', ['stale-channel.mjs'], '.'],
  ['小屏适配（1366×768）', 'node', ['small-screen.mjs'], '.'],
]

// 隔离宿主套件是可选的：需要有跑在 7999 的隔离实例（dev-tools/browser/iso-verify.mjs）。
// 没起就跳过，不让主流程因为环境缺失而变红。
const OPTIONAL = new Set(['隔离宿主（侧栏真的出现）'])
if (process.env.CIRCUIT_ISO === '1') {
  suites.push(['隔离宿主（侧栏真的出现）', 'node', ['iso-verify.mjs'], '.'])
}

const failures = []
for (const [name, cmd, args, cwd] of suites) {
  console.log('\n' + '='.repeat(64))
  console.log('▶', name)
  console.log('='.repeat(64))
  const r = spawnSync(cmd, args, { cwd: cwd === '.' ? HERE : cwd, encoding: 'utf8', shell: true })
  const out = ((r.stdout || '') + (r.stderr || '')).trim()
  // 只显示结论行，避免刷屏
  const lines = out.split('\n')
  for (const l of lines) {
    if (/^\s*(PASS|FAIL)|\u2139 (tests|pass|fail)|==== \d+\/\d+|FAILED:|^ - /.test(l)) console.log(l)
  }
  if (r.status !== 0) {
    if (OPTIONAL.has(name)) console.log('>>> (可选套件失败)', name)
    else { failures.push(name); console.log('>>> 退出码', r.status) }
  }
}

console.log('\n' + '='.repeat(64))
if (failures.length === 0) {
  console.log('✅ 全部通过')
} else {
  console.log('❌ 失败套件:', failures.join(', '))
}
process.exit(failures.length ? 1 : 0)
