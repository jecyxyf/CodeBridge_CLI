# Archify 本地架构编辑工具

用浏览器查看和编辑软件框架。项目数据保存在 `archify.json`，网页程序保存在 `index.html`。

## 直接打开与保存

用户只需新版桌面 Chrome 或 Edge，**不需要安装 Node、不需要启动服务**。

1. 双击 `index.html`，点击“打开 JSON”，选择项目的 `archify.json`。
2. 编辑模块、分层、参数、方法、事件或连线。
3. 点击“保存”或按 `Ctrl+S`，允许浏览器写入；网页会更新刚才选择的原文件，并读回核对。

| 操作或情况 | 结果 |
|---|---|
| 刚打开网页 | 显示文件选择入口；不会自动读取旁边的 JSON |
| 编辑但未保存 | 页面标记未保存；关闭或刷新时提示 |
| 保存 JSON | 写回当前选择的文件；取消授权或保存失败时保留页面编辑 |
| 另存为 JSON / Ctrl+Shift+S | 保存到新位置，此后保存使用新文件 |
| HTML 快照 | 下载当前框架的独立 HTML，供分享；不写 JSON，也不清除未保存标记 |
| 技能修改 JSON | 已选中文件且页面打开时，约每 2 秒检查；回到窗口时也检查。后台页面可能延迟 |
| 外部文件改变且页面没有编辑 | 重新读取并显示最新内容 |
| 页面有编辑或编辑框未关闭 | 保留当前内容，提示处理；可以另存为备份，再重新打开原文件 |
| 外部 JSON 暂时损坏、权限失效或文件被移走 | 保留当前内容，提示重试或重新打开 |
| 重新打开网页 | 再选择一次 JSON，读取实际文件；不从浏览器缓存恢复旧数据 |

浏览器必须由用户选择文件，并获得写入授权。当前版本不支持其他浏览器直接回写文件；请使用桌面 Chrome 或 Edge。网页查看、编辑和文件保存不需要联网，在线翻译按钮需要联网。

保存前比较文件内容，检测到外部修改就停止；写入完成后再读回核对。检查与写入之间仍存在很短的时间窗口，不能把它当作多个程序同时写文件的锁。请避免多个程序同时保存同一文件。

## 目录与部署

新项目默认交付到目标项目根目录下的 `docs/archfiy/`：

```text
docs/archfiy/
├── index.html       包含脚本、样式和模板；没有项目快照
├── archify.json     当前项目的唯一数据
└── README.md        使用说明
```

网页使用时不依赖技能目录。修改 JSON 无需重新生成 HTML。工具源码和打包脚本位于技能包的 `tools/html/`，仅开发、校验和自动部署使用 Node.js 22+，无第三方 npm 依赖。

以下命令在**技能工具根目录 tools/** 执行：

```sh
node html/scripts/deploy.mjs "<目标项目根目录>" --output-dir docs/archfiy
# 已有输入 JSON 时：
node html/scripts/deploy.mjs "<目标项目根目录>" --output-dir docs/archfiy --source-json "<输入JSON路径>"
```

| 情况 | 处理方式 |
|---|---|
| 新项目，指定 JSON | 校验后写入，保留字段和 ID |
| 新项目，没有指定 JSON | 创建独立 ID 的空框架 |
| 目标已有 JSON | 原样保留；输入与目标不同时停止 |
| 再次部署 | 更新网页和说明，保留目标 JSON |
| 旧项目使用 docs/archify/ 或其他目录 | 通过 --output-dir 指定实际位置，不自动迁移 |
| 原有服务部署改为本地方式 | 更新网页入口，保留 JSON；不删除已有 html/ 文件 |

`--output-dir` 必须是项目内的相对目录，不能使用项目根目录、项目外目录或与工具源目录重叠的目录。也可手动复制已打包的 `index.html` 和本说明到目标位置，配上已校验的项目 JSON；不要用工具空框架覆盖已有数据。

## 可选服务模式

需要原有 HTTP 服务方式时，显式选择服务模式：

```sh
node html/scripts/deploy.mjs "<目标项目根目录>" --output-dir docs/archfiy --mode service --start
```

此方式另外复制 `html/` 源码与服务程序，需要 Node.js 22+。默认从端口 4175 起寻找可用端口，以输出地址为准。旧命令单独传 `--start` 时仍按服务模式处理；`--mode local --start` 会报错。

在**目标项目根目录**重新启动已部署服务：

```sh
node docs/archfiy/html/server.mjs
```

打开输出的 HTTP 地址；按 `Ctrl+C` 停止。服务只监听本机。网页直接读取并保存该部署的 `archify.json`，约每 2 秒检查外部修改；保存时检查版本，冲突则拒绝覆盖。新生成的服务版入口也可以双击：此时自动进入本地模式，需要手动选择 JSON。旧版入口仍提示启动服务时，重新部署更新网页即可。

## 开发与检查

以下命令在**技能工具根目录 tools/** 执行：

```sh
# 网页源码或运行模板修改后，更新默认入口
node html/scripts/build.mjs --runtime
# 检查项目 JSON 与相邻网页
node html/scripts/check.mjs archify.json
node html/scripts/check.mjs index.html
# 生成可分享的 HTML 快照；不能覆盖 index.html
node html/scripts/build.mjs archify.json archify-export.html
node html/scripts/check.mjs archify-export.html archify.json
```

`build.mjs --service <输出HTML路径>` 可生成服务入口；服务部署后用 `check.mjs --url <实际HTTP地址>` 核对接口与磁盘 JSON。文件检查不能代替浏览器检查：本地模式要用 `file://` 打开，验证实际选择、编辑、写入、重开、外部更新和未保存冲突。

技能写 JSON 时继续使用 `html/scripts/files.mjs` 的 `readProjectFile` / `writeProjectFile`，传入读取时的 `expectedVersion`，并读回核对。网页入口没有 `ec-project` 快照；提取项目数据应读取用户实际选择的 JSON。只有导出的独立 HTML 才用 `Serialization.readProject` 提取内嵌数据。

## 模板

`html/templates/` 保留画布、模块、分层、项目数据四对模板。`*.template.html` 和 `archifytemplate.jsonc` 是完整指导书；对应文件是最小运行骨架。示例不属于实际项目，不能充当真实数据。
