# @commonworks/dsh-circuit — 安装到 DSH

本插件是标准 DSH bundle 插件：靠 profile 的 `dsh.profile.bundles` 列表 + `cordis.patch.yml` 挂载，
与 dsh-whale-widget 等插件同一机制。**注意包名带 scope，全限定名是 `@commonworks/dsh-circuit`**，
登记 bundle 时必须写全名。

> **请用 0.1.3 及以上。**
> - 0.1.0 的 `dsh.client.inject` 里写了两个宿主机上并不存在的包，导致浏览器端模块永远等不到
>   依赖、`apply` 永不执行：**装完侧栏没有入口、页面也打不开**（但 Host 路由 `/dsh-circuit/`
>   其实是通的，所以这不是 web/desktop 的平台差异）。已改为不声明 inject（`slots` 服务由
>   客户端内核自带），并加了 `test/manifest.test.mjs` 作为回归哨兵。
> - 0.1.3 另修了一批会在客户机上直接挡路的问题（关窗变砖、跨屏坐标越界、示波器画布不跟随、
>   通道跨电路串号、单次触发不冻结等），清单见 [README.md](README.md) 的「0.1.3 修了什么」。
> 已装旧版的，先 `dsh plugin --profile web remove @commonworks/dsh-circuit` 再装新版。

## 方式 A：从 npm 装（推荐）

```powershell
dsh plugin --profile web add @commonworks/dsh-circuit
```

- 装完**重启 `dsh web`**，再按 F5 刷新浏览器。
- 自检：`/dsh-circuit/api/health` 应返回 `{"ok":true,"engine":"circuitjs1",...}`。

## 方式 B：从 GitHub Release 装（离线/指定版本）

```powershell
dsh plugin --profile web add https://github.com/sdaniasdsd/dsh-teaelc/releases/download/v0.1.3/commonworks-dsh-circuit-0.1.3.tgz
```

- 包名：`commonworks-dsh-circuit-0.1.3.tgz`
- **校验和请以 Release 页面的说明为准**（见下）。
- 自行校验：`certutil -hashfile commonworks-dsh-circuit-0.1.3.tgz SHA256`

> ⚠️ 本文件（`INSTALL.md`）**本身就在发布包里**（`package.json` 的 `files` 含它）。
> 因此这里不能写死自己那个 tgz 的 SHA-256 —— 一旦写入，包内容就变了，哈希必然对不上，
> 形成"文档里的校验和永远校验不了自己"的死循环（实测：加一行注释，哈希即从
> `fa2723e5…` 变成 `b125a3b0…`）。校验和统一放在 GitHub Release 的说明里，
> 那里在包外，不受打包影响。

- 该直链是 DSH 插件市场（`dsh-plugin`）认可的固定形态 `github.com/<owner>/<repo>/releases/download/<tag>/<asset>.tgz`，
  直接把整行粘进市场的自定义安装框也能识别。

⚠️ **不要用 `dsh plugin --profile web add github:sdaniasdsd/dsh-teaelc`**：本仓库是多目录仓库，
`dsh-circuit/` 才是插件包，`github:` 直装会把**仓库根**当包，那里没有 package.json，必然失败。

## 方式 C：本地目录（开发机自用）

```powershell
# link: = 软链安装（pnpm 语义），源目录改动立即生效，但之后不能移动该目录
dsh plugin --profile web add link:D:\circuit电路模拟\dsh-circuit

# 或 file: = 拷贝安装（源目录再改不会同步，需重新 add）
dsh plugin --profile web add file:D:\circuit电路模拟\dsh-circuit
```

## 方式 D：手动登记（没有 dsh CLI，或在官方桌面端里）

本插件没有需要启动期参与的 index 注入，只需登记依赖 + 追加 bundle 名（**用全限定名**）：

```powershell
cd C:\Users\<你>\.dsh\profiles\<profile>
$tgz = "D:\下载\commonworks-dsh-circuit-0.1.3.tgz"   # 或用 npm i @commonworks/dsh-circuit

npm install --ignore-scripts --no-audit --no-fund $tgz
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));const n='@commonworks/dsh-circuit';const b=j.dsh.profile.bundles;if(!b.includes(n)){b.push(n);fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');}"
```

重启 DSH Web 即可。

## 装完怎么确认真的能用

```powershell
# 1) 路由挂上了（Host 侧）
curl.exe -s http://127.0.0.1:<端口>/dsh-circuit/api/health

# 2) 页面能开（浏览器里）
#    http://127.0.0.1:<端口>/dsh-circuit/
#    应当看到 5 个浮窗、「面板 ▾」菜单、自动弹出的「怎么用」

# 3) 源码自带的验收（在仓库的 dsh-circuit/ 目录下）
npm test               # 21 条：路由 / 清单契约 / Host 栅栏
npm run test:browser   # 60 条：真 Chrome 跑真页面，五个套件
```

第 3 步需要本机有 Chrome，脚本在 `dev-tools/browser/`。**侧栏有没有入口**这一项只能由
`test:browser` 里的「客户端半边」套件验证 —— 它按 `app.asar` 里的真实装载协议与 slots 契约
复刻一个宿主，然后真正执行 `client/client.js`。0.1.0 那次事故就是死在这一半。

## 卸载

```powershell
dsh plugin --profile web remove @commonworks/dsh-circuit
```

手动装过的按反向操作：删除 `dependencies["@commonworks/dsh-circuit"]`，并从 `dsh.profile.bundles`
里移除该全限定名，再 `npm install --ignore-scripts`。

## 自检

```powershell
curl.exe -s http://127.0.0.1:<端口>/dsh-circuit/api/health
```

返回 `{"ok":true,"plugin":"@commonworks/dsh-circuit","engine":"circuitjs1",...}` 即路由挂载成功。
端口以当前 DSH Web GUI URL 为准。装完打不开时，先确认 `dsh.profile.bundles` 末尾确实有
`@commonworks/dsh-circuit`（不是裸名 `dsh-circuit`），再看是否少了重启。
