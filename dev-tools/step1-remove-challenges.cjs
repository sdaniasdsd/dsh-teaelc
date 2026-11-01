/**
 * 生成一个新的 panel.js：在现有实现基础上
 *   1) 去掉挑战任务（CHALLENGES + 相关渲染/校验）
 *   2) 每个区块可拖动调整高度（分隔条）
 *   3) 示波器升级为专业布局：通道开关、时基、电压/电流档位、AC/DC 耦合、
 *      频率/峰峰值/RMS 读数
 *   4) 注入内核 CSS：视觉上隐藏顶栏菜单（DOM 保留，放置元件仍走菜单）
 *
 * 这里做的是精确的文本级手术，而不是整文件重写——现有大量已验证逻辑
 * （放置、取消放置、采样、示波器绘制）必须保持原样。
 */
const fs = require('node:fs')

const P = 'D:/circuit电路模拟/dsh-circuit/assets/app/panel.js'
let s = fs.readFileSync(P, 'utf8')

function must(cond, msg) {
  if (!cond) {
    console.error('FATAL: ' + msg)
    process.exit(1)
  }
}

// ---------------------------------------------------------------- 1. 移除挑战
const challengeStart = s.indexOf('const CHALLENGES = [')
must(challengeStart >= 0, 'CHALLENGES not found')
// 找到挑战数组结束（配对的 ];）后到 renderChallengeSection 之前的注释块
const afterChallenges = s.indexOf('/** 挑战任务（按真实读数判定）。 */')
// 直接用标记定位：CHALLENGES 声明块以 "\n]\n" 结束
const arrEnd = s.indexOf('\n]\n', challengeStart)
must(arrEnd > 0, 'CHALLENGES array end not found')
s = s.slice(0, challengeStart) + s.slice(arrEnd + 3)

// 移除 renderChallengeSection 函数
const rcStart = s.indexOf('function renderChallengeSection() {')
if (rcStart >= 0) {
  // 找函数结束：从 rcStart 起匹配大括号
  let depth = 0
  let i = s.indexOf('{', rcStart)
  let end = -1
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  must(end > 0, 'renderChallengeSection end not found')
  s = s.slice(0, rcStart) + s.slice(end)
}

// 移除 renderChallenges / runChallengeCheck
for (const fn of ['function renderChallenges() {', 'function runChallengeCheck() {']) {
  const st = s.indexOf(fn)
  if (st < 0) continue
  let depth = 0
  let i = s.indexOf('{', st)
  let end = -1
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end > 0) s = s.slice(0, st) + s.slice(end)
}

// 移除壳里的挑战区块引用
s = s.replace(/,\n\s*renderChallengeSection\(\),\n/, ',\n')
s = s.replace(/renderChallengeSection\(\),\s*/g, '')

// 状态字段清理
s = s.replace(/\n\s*activeChallenge: null,/, '')
s = s.replace(/\n\s*checkResults: null,/, '')

fs.writeFileSync(P, s)
console.log('challenges removed. new lines:', s.split('\n').length)
must(!s.includes('CHALLENGES'), 'CHALLENGES still present')
must(!s.includes('renderChallengeSection'), 'renderChallengeSection still referenced')
