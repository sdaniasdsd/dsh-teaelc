# dsh-circuit — 安装到 DSH

本插件是标准 DSH bundle 插件：靠 profile 的 `dsh.profile.bundles` 列表 + `cordis.patch.yml` 挂载，
与 dsh-whale-widget 等插件同一机制。下面三种装法任选一种。

> **0.1.0 的客户端是坏的，请用 0.1.1 及以上。** 0.1.0 的 `dsh.client.inject` 里写了两个宿主机
> 上并不存在的包（`@deepseek-ai/dsh-client-ui-slots` / `@deepseek-ai/dsh-client-locale`），
> 导致浏览器端模块永远等不到依赖、`apply` 永不执行：**装完侧栏没有入口、页面也打不开**（
> 但 Host 路由 `/dsh-circuit/` 其实是通的）。0.1.1 已改为不声明 inject（`slots` 服务由客户端内核
> 自带），并加了 `test/manifest.test.mjs` 作为回归哨兵。已装 0.1.0 的，先 remove 再装 0.1.1。

## 方式 A：从 GitHub Release 装（推荐，给别人用）

```powershell
dsh plugin --profile web add https://github.com/sdaniasdsd/dsh-teaelc/releases/download/v0.1.1/dsh-circuit-0.1.1.tgz
```

- 该直链是 DSH 插件市场（`dsh-plugin`）认可的固定形态 `github.com/<owner>/<repo>/releases/download/<tag>/<asset>.tgz`，
  直接把整行粘进市场的自定义安装框也能识别。
- 装完**重启 `dsh web`**，再按 F5 刷新浏览器。

⚠️ **不要用 `dsh plugin --profile web add github:sdaniasdsd/dsh-teaelc`**：本仓库是多目录仓库，
`dsh-circuit/` 才是插件包，`github:` 直装会把**仓库根**当包，那里没有 package.json，必然失败。

## 方式 B：本地目录（开发机自用）

```powershell
# link: = 软链安装，源目录改动立即生效（但之后不能移动该目录）
dsh plugin --profile web add link:D:\circuit电路模拟\dsh-circuit

# 或 file: = 拷贝安装（源目录再改不会同步，需重新 add）
dsh plugin --profile web add file:D:\circuit电路模拟\dsh-circuit
```

## 方式 C：手动登记（没有 dsh CLI，或在官方桌面端里）

本插件没有需要启动期参与的 index 注入，只需登记依赖 + 追加 bundle 名：

```powershell
cd C:\Users\<你>\.dsh\profiles\<profile>
$tgz = "D:\下载\dsh-circuit-0.1.1.tgz"

npm install --ignore-scripts --no-audit --no-fund $tgz
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));const b=j.dsh.profile.bundles;if(!b.includes('dsh-circuit')){b.push('dsh-circuit');fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');}"
```

重启 DSH Web 即可。

## 卸载

```powershell
dsh plugin --profile web remove dsh-circuit
```

手动装过的按反向操作：删除 `dependencies["dsh-circuit"]`，并从 `dsh.profile.bundles` 里移除该名字，再 `npm install --ignore-scripts`。

## 自检

```powershell
curl.exe -s http://127.0.0.1:<端口>/dsh-circuit/api/health
```

返回 `{"ok":true,"engine":"circuitjs1","engineLicense":"GPL-2.0",...}` 即路由挂载成功。
端口以当前 DSH Web GUI URL 为准。装完打不开时，先确认 `dsh.profile.bundles` 末尾确实有 `dsh-circuit`，再看是否少了重启。
