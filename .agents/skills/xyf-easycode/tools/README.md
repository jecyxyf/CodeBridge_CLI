# Archify 本地架构编辑工具

双击 index.html，自动读取同目录的 archify.js，显示软件框架。查看、编辑、保存和默认部署不需要安装 Node、编译或启动服务。保存请使用新版桌面 Chrome 或 Edge。

## 使用

| 操作 | 结果 |
|---|---|
| 双击网页 | 自动加载同目录的 archify.js，无需选择文件 |
| 配置缺失或损坏 | 显示错误，可点击“加载配置”手动选择有效的 .js 文件 |
| 首次保存 / Ctrl+S | 选择当前页面对应的 archify.js 并允许写入；文件不匹配或被外部修改时停止保存 |
| 后续保存 | 授权有效时写回已选择的文件，保存后读回核对 |
| 取消或拒绝授权、保存失败 | 保留网页中的编辑，不显示保存成功 |
| 另存为配置 / Ctrl+Shift+S | 保存到新位置，当前页面后续保存使用新文件 |
| 刷新或重新打开 | 仍默认读取 index.html 同目录的 archify.js；保存可能需要重新选择或授权 |
| HTML 快照 | 下载当前框架的独立网页，供分享；不代表配置已经保存 |

另存到其他目录或使用其他文件名后，下次打开 index.html 不会自动追踪那个文件；需要手动加载，或将对应配置放到网页旁并命名为 archify.js。选文件窗口首次位置由浏览器决定，之后通过固定选择器 ID 优先记住上次目录；清理浏览器记录后可能需要重新定位。

尚未选择或绑定文件时，外部修改通过刷新或重开网页读取。手动加载或首次保存绑定文件后，约每 2 秒检查一次外部变化，回到窗口时也检查。页面有未保存编辑或编辑窗口未关闭时保留内容并提示，不直接替换。后台页面的检查可能延迟。

请避免多个程序同时保存同一文件：保存前检查文件、保存后读回核对仍不等于跨程序的文件锁。查看、编辑和保存无需联网；在线翻译按钮需要联网。

## 文件与部署

```text
docs/archfiy/
├── index.html       网页程序，脚本、样式和模板已内嵌
├── archify.js       当前项目唯一的架构配置
└── README.md        使用说明
```

默认部署直接复制已打包的 index.html 和本说明，配上已核实的项目 archify.js。无需复制 html/ 开发目录，也无需运行构建命令。用户指定的位置优先；已有配置和网页定制先核对，不用工具自带空框架覆盖项目。只改架构数据时不用重新生成网页。

配置的固定形式为 `window.ARCHIFY_DATA = { ... };`。右侧必须是严格 JSON 对象，不能带注释、函数、额外语句或 __proto__ 字段。数据字段、ID 和布局沿用现有模型。只支持这种 .js 配置，不处理旧 JSON 文件。

html/assets/project-file.js 的 EasyCode.ProjectFile.parse 和 stringify 用于解析、校验和生成配置；解析器只读取固定包装内的数据，不执行文件。model.js 负责字段和模型校验。Agent 写入前检查原内容或哈希，写入后解析并比较。

## 可选维护工具

以下工具供已有 Node.js 22+ 的维护环境使用，无 npm 依赖；用户使用和默认复制部署不需要它们。命令在 tools/ 目录运行：

```sh
# 只有编辑器源码或模板改动后才重新打包
node html/scripts/build.mjs --runtime
# 检查配置及网页
node html/scripts/check.mjs archify.js
node html/scripts/check.mjs index.html
# 可选的自动部署，保留目标已有配置
node html/scripts/deploy.mjs "<目标项目根目录>" --output-dir docs/archfiy --source-file "<archify.js路径>"
# 生成独立分享快照，不能覆盖 index.html
node html/scripts/build.mjs archify.js archify-export.html
```

只有明确需要 HTTP 服务时才使用 `deploy.mjs ... --mode service --start`；它额外部署 html/，需要保持 Node 服务运行。服务与本地方式使用同一 archify.js，不保留另一份 JSON。服务只监听本机，按 Ctrl+C 停止；通过 `check.mjs --url <实际HTTP地址>` 检查接口与磁盘数据一致。

html/scripts/files.mjs 提供可选的 readProjectFile / writeProjectFile：读取时记录 version，保存时传入 expectedVersion，检测冲突并读回核对。不依赖 Node 的 Agent 可使用现有文件工具和网页模型做相同核对。

## 模板与检查

html/templates/ 保留画布、模块、分层、项目数据四对模板。*.template.html 和 archifytemplate.template.js 是带说明的指导书；对应的 .html、archifytemplate.js 是运行骨架。指导书中的注释和示例不复制到正式配置，也不代表项目事实。

本地网页仅引用同目录的普通 archify.js 脚本，其余资源内嵌；不使用模块脚本或 fetch 读取本地配置。页面检查需覆盖自动加载、配置缺失或损坏、手动加载、首次保存、取消授权、保存后重开及外部修改冲突。使用临时文件验证，不往技能包加入测试目录。
