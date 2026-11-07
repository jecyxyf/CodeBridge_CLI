# 软件架构编辑器

推荐双击或运行 `start.py`（`python start.py` / `python3 start.py`）启动本地服务并自动打开网页：页面会自动加载同目录的 `software_architecture.js`，点击“保存”或按 `Ctrl+S` 直接写回原文件，全程无需弹窗选文件。

也可直接双击 `index.html` 打开网页（无需启动服务）；此时因浏览器安全限制，首次保存需手动选择一次 `software_architecture.js`。

## 目录

| 文件或目录 | 作用 |
| --- | --- |
| `start.py` | 跨平台本地启动程序（免弹窗自动加载与保存） |
| `index.html` | 唯一网页入口 |
| `software_architecture.js` | 项目的架构数据 |
| `language.js` | 当前使用的语言，默认中文 |
| `assert/` | 编辑器组件、样式、语言读取和文件保存代码 |
| `assert/language_zh.js` | 中文配置，也用于补齐缺失的文字 |
| `assert/language_eng.js` | 英文配置 |
| `module/canvas.js` | 画布、工具栏和提示区域模板 |
| `module/module.js` | 模块卡片模板 |
| `module/layer.js` | 分层模板 |
| `references/architecture-data.jsonc` | 架构数据的字段说明和完整示例，供 Agent 参考 |

组件和模板采用普通 JS 文件加载，支持直接双击打开本地网页。移动工具时请复制整个目录。

## 翻译和切换语言

1. 用 `assert/language_eng.js` 的内容覆盖 `language.js`，刷新网页即可显示英文。
2. 用 `assert/language_zh.js` 覆盖 `language.js`，刷新即可恢复中文。
3. 增加其他语言时，复制一份语言文件，修改 `locale`、`name` 和 `messages` 中的文字，再放到 `language.js`。

只翻译等号右侧配置中的文字，保留消息键和 `{name}`、`{count}` 等占位符。按钮、弹窗、字段、提示、校验错误和新建内容的默认名称都来自语言文件。已有项目、模块等数据的名称和说明由 `software_architecture.js` 保存，切换界面语言不会自动翻译这些内容。

模板使用 `{{消息键}}` 引用语言文字；组件使用 `EasyCode.I18n.t('消息键', {参数:值})`。无需修改组件或重新生成网页。未翻译的键会使用中文配置中的对应文字。

## 编辑与保存

| 操作 | 结果 |
| --- | --- |
| 保存 / Ctrl+S | 通过 `start.py` 打开时直接写回 `software_architecture.js`（无弹窗）；直接双击 `index.html` 打开时，首次需选择原文件并授权 |
| 下载 JS 副本 / Ctrl+Shift+S | 下载新的 `software_architecture.js`，手动替换原文件后刷新 |
| 加载配置 | 导入其他 `.js` 架构数据，校验通过后替换页面内容 |
| HTML 快照 | 导出含当前数据、界面语言、组件和样式的独立页面 |

保存时检查外部修改，并在写入后回读核对。冲突时保留编辑，请先下载副本。通过 `start.py` 打开或已授权原文件时，页面每 2 秒自动检测外部修改并同步。

数据格式为 `globalThis.softwareArchitecture = { ... };`，其中 `{ ... }` 为合法 JSON。保留已有 ID、字段和 `formatVersion`，不要添加函数或其他语句。

普通编辑和保存支持离线使用。英文名称翻译按钮仅在翻译中文名称时访问在线服务，也可手动输入英文标识。
