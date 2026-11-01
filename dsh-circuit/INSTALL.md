# dsh-circuit — 安装到 DSH

本插件通过 profile 的 bundle 列表 + `cordis.patch.yml` 挂载，与 dsh-whale-widget 等插件同一机制。

## 安装（本机 desktop profile）

1. 把整个 `dsh-circuit` 目录放进 profile 可见的位置，并用 `link:` 依赖登记：

```powershell
# D:\circuit电路模拟\dsh-circuit 已在本机
cd C:\Users\AA\.dsh\profiles\desktop
# 1) 登记本地包（不改动 package.json 其它行，只加一条 link 依赖）
npm pkg set "dependencies.dsh-circuit=link:D:/circuit电路模拟/dsh-circuit"

# 2) 让它出现在 bundle 栈里（与 dsh-whale-widget 同样的位置：末尾追加即可）
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));const b=j.dsh.profile.bundles;if(!b.includes('dsh-circuit')){b.push('dsh-circuit');fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');}"

# 3) 建链接
npm install --ignore-scripts
```

2. 重启 DSH Web（本插件没有需要启动期参与的 index 注入，只需一次重启即可挂上路由）。

3. 打开 `http://127.0.0.1:<当前端口>/dsh-circuit/` 即进入模拟器。

## 卸载

```powershell
cd C:\Users\AA\.dsh\profiles\desktop
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.dsh.profile.bundles=j.dsh.profile.bundles.filter(x=>x!=='dsh-circuit');delete j.dependencies['dsh-circuit'];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
npm install --ignore-scripts
```

## 自检

```powershell
# 路由与内核是否就绪（服务在跑时）
curl.exe -s http://127.0.0.1:63797/dsh-circuit/api/health
```

返回 `{"ok":true,"engine":"circuitjs1","engineLicense":"GPL-2.0",...}` 即路由挂载成功。

端口以当前会话给出的 DSH Web GUI URL 为准；本会话为 `http://127.0.0.1:63797`。
