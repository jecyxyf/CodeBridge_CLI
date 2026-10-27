# Archify 架构编辑工具

默认使用 Node.js 22+ 生成并启动网页，通过 HTTP 地址查看和编辑。无 npm 依赖。架构统一保存在部署目录的 archify.json，格式为带两空格缩进的纯 JSON。

## 部署和访问

以下命令从本 tools/ 目录运行：

```sh
node html/scripts/deploy.mjs "<目标项目根目录>" --source-file "<已核实的archify.json路径>"
```

默认部署到目标项目 docs/archfiy/，启动五位数随机端口的服务，并输出实际地址。端口范围为 10000～65535，占用时重新随机选择。命令保持运行，按 Ctrl+C 停止；使用当前 Agent 支持的持久终端维持服务。

```text
docs/archfiy/
├── index.html       Node 生成的网页，脚本、样式和模板已内嵌
├── archify.json     当前项目唯一的架构配置
├── ReadMe.md        启动后生成的实际地址、端口和重启命令
└── html/            Node 服务程序及维护工具
```

服务启动成功后生成或更新 ReadMe.md，保留生成区域之外的用户备注。在部署目录执行 `node html/server.mjs` 可重启服务；新地址以更新后的 ReadMe.md 为准。默认只监听本机，通过该 HTTP 地址打开网页。

| 参数 | 用途 |
|---|---|
| --output-dir docs/archfiy | 指定项目内的部署目录 |
| --source-file <JSON路径> | 指定已核实的架构配置；目标已有不同数据时停止，保留原数据 |
| --port <五位数端口> | 明确指定端口；默认随机选择空闲端口 |
| --no-start | 只生成文件，不启动服务，也不生成访问成功的说明 |
| --mode local | 可选手动文件模式，需要手动选择 JSON；默认使用服务模式 |

已有项目使用自己的 JSON，不用工具自带空框架替换；目标已有配置时保留原文件。未提供源文件且目标无数据时创建空框架并分配新项目 ID。检测到目标只有旧 archify.js 时停止，先核实 JSON 来源。

## 编辑和保存

| 操作 | 结果 |
|---|---|
| 打开网页地址 | 自动加载部署目录的 archify.json |
| 保存配置 / Ctrl+S | 直接写回同一 JSON，写前检查版本、写后读回核对 |
| 刷新、重新打开或重启 | 继续读取同一 JSON 文件 |
| 另存为配置 / Ctrl+Shift+S | 下载 JSON 副本，不改变服务绑定的数据文件 |
| 加载配置 | 选择 JSON，确认后替换网页内容；点击保存才写入服务配置 |
| HTML 快照 | 下载独立分享网页，不代表配置已保存 |
| 失败或冲突 | 保留网页编辑并显示原因，不冒充保存成功 |

约每 2 秒检查外部修改。没有未保存编辑时载入最新数据；有未保存编辑或编辑窗口打开时保留内容并提示。后台页面检查可能延迟。文件版本检查不等于跨程序文件锁，避免多个程序同时写入。在线翻译按钮需要联网。

## 配置与维护

archify.json 只包含 JSON 对象，不含脚本赋值、注释、函数或 __proto__ 字段。字段、稳定 ID、布局和模型版本沿用现有模型。html/assets/project-file.js 统一解析与生成配置；model.js 负责模型校验。Agent 写入前检查原内容或哈希，写入后解析并深度比较。

```sh
# 修改编辑器源码或模板后，更新服务版工具网页
node html/scripts/build.mjs --runtime
# 检查配置、网页及运行中的服务
node html/scripts/check.mjs archify.json
node html/scripts/check.mjs index.html
node html/scripts/check.mjs --url "<实际HTTP地址>"
# 生成独立分享快照，不能覆盖 index.html
node html/scripts/build.mjs archify.json archify-export.html
```

html/scripts/files.mjs 提供 readProjectFile / writeProjectFile，通过 expectedVersion 检查冲突并读回核对。

html/templates/ 保留画布、模块、分层、项目数据四对模板。*.template.html 和 archifytemplate.template.jsonc 是带说明的指导书；对应的 .html 和 archifytemplate.json 是运行骨架。指导书注释和示例不复制到正式配置，也不代表项目事实。

通过真实 HTTP 页面检查自动加载、布局、编辑、保存、刷新、外部修改冲突及错误提示；接口成功不能替代页面验证。使用临时项目测试，不往技能包加入测试目录。
