# CircuitJS1 简体中文语言包 `locale_zh.txt` 说明

## 1. 产物与来源

| 项目 | 值 |
| --- | --- |
| 译文文件 | `dsh-circuit/assets/app/locale/locale_zh.txt` |
| 键清单（只读） | `docs/ls-keys.txt`（196 条，CRLF 换行，无 BOM） |
| 参考格式 | `vendor/circuitjs1-src/.../public/locale_de.txt`（`"原文"="译文"`，LF 换行，无 BOM） |
| 生成/校验脚本（临时，非交付物） | `dsh-circuit/dev/locale-zh-build.cjs`（`node dev/locale-zh-build.cjs --write`） |

译文文件按 `ls-keys.txt` 的**逐行顺序**输出，键直接取键清单行原文拼接，因此键与清单逐字节一致（含前导空格、尾随空格、`/div`、`# of Divisions`、`(space or Shift-drag)` 等）。文件为 UTF-8、LF 换行、无 BOM、末尾单换行，与 `locale_de.txt` 的编码习惯一致，也与打包 bundle 里 `Locale.processLocale()` 的解析规则（`"` 开头、第二个 `"` 后接 `="`、行尾 `"`）一致。

## 2. 翻译原则

1. **面向中国大陆初高中物理**：resistor=电阻、capacitor=电容、inductor=电感、voltage=电压、current=电流、battery=电池、ground=接地、scope=示波器、series=串联、parallel=并联；元件名与其菜单项用词保持一致（`resistor`／`capacitor`／`inductor`／`diode`／`battery`／`relay`／`transistor`／`subcircuit` 等出现在元件信息栏与示波器图例中的同名条目一律用同一译名）。
2. **保留键的结构性空白**：` (mod `、` average`、` bad connection`、`Add `、`Editing: `、`time step = `、`delay = ` 等首尾空格是拼接的一部分（如 `1` + `" bad connection"` → `1 处连接错误`），译文保留同样的首尾空格与标点位置，数字/单位由程序填入。
3. **符号与模式名不臆造**：`f.3db = `、`fc = `、`res.f = ` 是 -3 dB 频率、截止频率、谐振频率的**符号标签**，保留 ASCII 符号与空格，只让数值和单位由程序拼接；`Cmd-`、`Ctrl-` 是 macOS/其他平台快捷键外壳，保留原样。
4. **快捷键片段**用「快捷键外壳 + 中文动作」：`(Alt-drag)`→`(Alt-拖动)`、`(space or Shift-drag)`→`(空格 或 Shift-拖动)`、`(A-Cmd-drag)`/`(A-M-drag)`/`(A-S-drag)` 保留修饰键字母，只译 drag。
5. **不翻译文件名、dump 类型字母、代码**：`export`（DataRecorder 元件画布上直接写死的标签）与 `out`（OutputElm 画布标签）只作界面词处理，不涉及 dump 码；未新增、未改动任何键。
6. **专有名词与缩写保留英文**：`LED`、`JFET`、`MOSFET`、`Dropbox`、`Cmd`、`Ctrl`、`Crout LU`/`CSC LU`（线性方程求解器名）、`A-Cmd`/`A-M`/`A-S`（macOS 修饰键记号）在中文教材与工程界面中通常不译；`N沟道`/`P沟道` 用国标教材写法（数字与字母间不加空格）。
7. **HTML/转义前缀原样**：清单本批 196 条中实际没有 `&nbsp;</div>` 前缀的条目（`ls-keys.txt` 中是裸标题 `Active Components` 等），因此本文件不含 `&nbsp;</div>`；若未来清单出现带前缀的键，须整段原样保留、只译其后标题（`locale_de.txt` 即如此处理）。

## 3. 故意保留英文 / 仅机械替换的条目

**完全未翻译（键=译文，共 6 条）**：`Cmd-`、`Ctrl-`、`f.3db = `、`fc = `、`LED`、`res.f = `。

**保留英文记号、其余中文的条目（前 15 条）**：

1. `(A-Cmd-drag)` → `(A-Cmd-拖动)`
2. `(A-M-drag)` → `(A-M-拖动)`
3. `(A-S-drag)` → `(A-S-拖动)`
4. `(Alt-drag)` → `(Alt-拖动)`
5. `(space or Shift-drag)` → `(空格 或 Shift-拖动)`
6. `Dense (Crout's LU)` → `稠密（Crout LU）`
7. `Sparse (CSC LU)` → `稀疏（CSC LU）`
8. `JFET Type` → `JFET 类型`
9. `MOSFET Type` → `MOSFET 类型`
10. `N-Channel JFET` → `N沟道 JFET`
11. `P-Channel JFET` → `P沟道 JFET`
12. `Import from Dropbox` → `从 Dropbox 导入`
13. `Import From Dropbox Link` → `从 Dropbox 链接导入`
14. `Open Dropbox Chooser` → `打开 Dropbox 选择器`
15. `To open a shared Dropbox file from a Dropbox link paste the link below...` → `要通过 Dropbox 链接打开共享文件，请在下方粘贴链接…`

## 4. 含义不确定时的保守处理（未臆造功能）

以下条目按「宁可直译、不臆造功能」处理，均已在 bundle 中确认过上下文：

| 键 | 译文 | 依据 / 保守点 |
| --- | --- | --- |
| `Current Speed` | 电流速度 | 侧栏中位于 `Simulation Speed` 下方的滑动条标签；`CirSim.java` 中 `currentBar` 只乘到 `CircuitElm.currentMult`（电流点阵动画速度），**不是**电流数值，故不译作"电流大小" |
| ` (mod ` | ` (模 ` | 计数器芯片名 `Counter (mod N)` 的后缀；只译"模"，保留前导空格与右括号由程序补 |
| `/div` | `/格` | 示波器 `s/div`、`V/div` 的每格刻度写法（与单位串拼接，如 `5 µs/格`） |
| `# of Divisions` | 分格数 | 示波器手动刻度对话框的格数输入框 |
| `melted` | 已熔化 | 保险丝热积累百分比后接的说明词（`xx% 已熔化`） |
| `export` | 导出 | 数据记录器（DataRecorder）画布上的元件标签 |
| `out` | 输出 | 输出端（OutputElm）画布上未显示数值时的占位标签 |
| `trigger` | 触发 | 停止触发（Stop Trigger）元件的画布标签 |
| `buffer` | 缓冲器 | 延时缓冲（Buffer）元件信息栏首行 |
| `Labeled Node` | 标注节点 | 元件信息栏 `(标注节点)` 的括注 |
| `View Components` | 查看内部元件 | 子电路模型编辑对话框按钮；`canViewComponents()` 判断模型内是否存有内部元件，故译作"内部元件"而非"元件列表" |
| `Toggle Dev Tools` | 显示/隐藏开发者工具 | 仅 Electron 构建出现的命令面板项 |
| `Mirror X` / `Mirror Y` | 水平镜像 / 垂直镜像 | 按 `flipX`/`flipY` 的镜像轴命名（X 轴方向翻转 = 左右镜像） |
| `Trail Persistence (time steps)` | 轨迹保留（时间步数） | 示波器属性里的轨迹拖尾滑条 |
| `RPM` | 转/分 | 直流电机信息栏 `转速 = N 转/分`，作为单位串使用 |

## 5. 回归验证（本机实际执行）

校验脚本 `dsh-circuit/dev/locale-zh-build.cjs` 做了三件事：按键清单逐行生成文件、用与 bundle 相同的 `processLocale()` 规则重新解析产物、把解析结果与键清单对账。

实测结果（`node dev/locale-zh-build.cjs --write`）：

- 键清单总条数：**196**；映射表条目数：**196**
- 产物行数 / 解析成功条目：**196 / 196**
- 覆盖率：**196/196**
- 产物中不属于 `ls-keys.txt` 的键：**0**
- `ls-keys.txt` 中缺失于产物的键：**0**
- 格式不合规行（不含 `"="`、不以 `"` 收尾）：**0**
- 重复键：键清单内 **0**，产物内 **0**
- 键清单本身无重复行（196 个唯一字符串）
- 编码：UTF-8，无 BOM，LF 换行，`" (mod "` 等前导空格条目逐字节核对通过
- 完全未翻译条目：6 条（见第 3 节）

**浏览器内冒烟**（Edge headless，本地静态服务 + `circuitjs.html?lang=zh`）：

- 顶栏菜单显示为 文件 / 编辑 / 绘制 / 示波器 / 选项 / 工具 / 电路；
- 侧栏显示 仿真速度、电流速度、功率亮度、当前电路：；
- 绘制菜单下拉：无源元件、输入与电源、输出与标注、有源元件、有源功能模块、逻辑门、输入与输出、数字芯片、模拟与混合芯片、子电路、拖动；其中"拖动"子菜单显示 拖动全部 `(Alt-拖动)`、拖动行 `(A-S-拖动)`、拖动列 `(A-M-拖动)`、拖动引脚 `(Ctrl-drag)`；
- 选项菜单中已覆盖条目显示 快捷键…、其他选项…；工具菜单显示 将导线转换为布线导线、子电路管理器；
- 示波器刻度栏与画布图例显示 电感/电容/电阻、时间步长 = 、占空比 等。

### 尚未覆盖、仍显示英文的界面（如实记录）

本批次 `ls-keys.txt` 只抽取到 196 个键，因此下列 UI 文案**不在这批键范围内**，即使界面已切换为中文仍显示英文：绘制菜单顶部的 `Add Wire` / `Add Routed Wire` / `Add Resistor`、绘图子菜单内的具体元件名（如 `Add Capacitor`、`Add Op Amp (ideal, - on top)`）、文件菜单的 `New Blank Circuit` / `Open File...` / `Save As...` / `Print...`、示波器菜单的 `Stack All` / `Unstack All`、选项菜单的 `Show Current` / `Show Voltage` / `European Resistors` 等。这些属于**下一批键**的补译工作，不在本次"不得新增键"的约束内。

## 6. 如何回归验证

```bash
cd dsh-circuit
node dev/locale-zh-build.cjs --write     # 重新生成 + 自检，JSON 里看 coverage / allKeysByteExact / duplicateKeysInOutput
```

若只想校验已有文件、不重写，去掉 `--write` 即可（脚本在映射不全时会以退出码 2 拒绝写盘，防止静默漏条）。界面冒烟：任意静态服务器托管 `assets/app`，打开 `circuitjs.html?lang=zh`（或 `sim.html` 内嵌页），选中一个元件看信息栏、打开 绘制 / 选项 / 示波器 菜单与示波器属性对话框，确认中文与程序拼接的数值没有错位。
