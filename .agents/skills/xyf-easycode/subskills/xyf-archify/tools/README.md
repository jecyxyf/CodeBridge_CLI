# Archify 本地架构编辑工具

通过网页查看、添加和编辑软件的模块、分层、参数、方法、消息事件及连线。项目内容统一保存在 `archify.json`；已有 Agent 可通过技能修改这份文件，网页会读取变化。工具不安装或管理 Agent。

## 目录

本文未特别说明的路径，都相对于**工具根目录**：开发时是技能包的 `tools/`，部署后是目标项目的 `docs/archify/`。

```text
./
├── README.md           使用说明
├── archify.json        当前数据；随工具提供的是最小空框架
├── index.html          网页入口；不内嵌项目数据
└── html/
    ├── server.mjs      本地 HTTP 服务
    ├── assets/         网页程序、数据模型和样式
    ├── scripts/        部署、生成、文件读写和检查工具
    └── templates/      完整指导书和待填充的最小运行模板
```

`index.html` 是由当前程序打包得到的入口。修改项目 JSON 不需要重新生成入口；只有修改网页源码或模板后才需要重新打包。

## 环境

- Node.js 22 或更新版本，使用新版 Chrome 或 Edge 浏览器。
- 不需要 `npm install`，没有第三方运行依赖。
- 编辑、保存和 JSON 同步在本机运行；英文名称的在线翻译按钮需要联网。

## 部署到项目

在**本工具根目录**执行，`<目标项目根目录>` 是项目的根目录，不是 `docs/archify`：

```sh
node html/scripts/deploy.mjs "<目标项目根目录>" --start
```

脚本把整套程序放到 `<目标项目根目录>/docs/archify/`，启动服务并打印访问地址。默认从 `http://127.0.0.1:4175/` 开始寻找可用端口；以实际输出为准。保持这个进程运行，按 `Ctrl+C` 停止。Agent 执行时可使用自己的后台进程能力，并向用户交付实际地址。

已有架构 JSON 时可以指定输入：

```sh
node html/scripts/deploy.mjs "<目标项目根目录>" --source-json "<输入JSON路径>" --start
```

| 情况 | 处理方式 |
|---|---|
| 新项目，没有指定 JSON | 复制空框架，生成独立的项目 ID |
| 新项目，指定了 JSON | 校验后写入，保留输入的字段和 ID |
| 目标已有 `archify.json` | 原样保留；指定了不同输入时停止，不能用空框架覆盖 |
| 再次部署 | 更新程序和模板，保留目标 JSON；重新打开网页以使用新版程序 |
| 只想复制，暂不启动 | 去掉 `--start` |

也可以手动复制本目录的全部内容到目标项目的 `docs/archify/`，已有 JSON 时跳过该文件。启动命令只读取自己相邻的 JSON，不依赖终端的当前目录。

## 启动与停止

在**目标项目根目录**执行：

```sh
node docs/archify/html/server.mjs
```

在**工具根目录**开发时执行：

```sh
node html/server.mjs
```

指定端口：在命令末尾加 `--port 4180`。指定端口被占用时会报错；默认端口被占用时自动尝试下一个。服务只监听本机 `127.0.0.1`，停止后网页不能读写，重新启动即可恢复。直接双击 `index.html` 不会启动服务，请使用终端打印的 HTTP 地址。

## JSON 与网页双向同步

| 操作 | 结果 |
|---|---|
| 技能修改 `archify.json` | 网页约每 2 秒检查一次；没有未保存编辑时自动显示新数据 |
| 网页修改模块、分层或布局 | 点击保存或按 `Ctrl+S` 后写回同目录的 `archify.json` |
| 网页有未保存编辑，JSON 又被修改 | 保留网页内容并提示；可以先导出备份，再点击“载入最新内容” |
| 两个网页同时保存 | 先保存的成功；后保存的若使用旧版本，会提示冲突 |
| 文件内容暂时无效或服务断开 | 保留当前页面，显示原因并自动重试 |
| 导入 JSON 或独立 HTML | 先载入网页，点击保存后才写入当前 JSON |
| 导出 HTML | 下载当前设计的独立快照；不会改变服务的保存位置，也不算已保存 JSON |

保存会先校验，再写临时文件并核对，最后替换目标文件。保存前检查文件版本；检测到外部修改时拒绝覆盖。技能写文件时也应使用 `html/scripts/files.mjs` 的 `readProjectFile` / `writeProjectFile`，传入读取时的 `expectedVersion`，并读回核对。不要在多个程序中无检查地直接覆盖文件。

服务入口不是数据快照。提取项目数据时读取同目录的 `archify.json`；只有导出的独立 HTML 才通过 `Serialization.readProject` 提取内嵌数据。

## 开发与检查

以下命令在**工具根目录**执行：

```sh
# 网页源码或模板修改后，重新打包根目录入口
node html/scripts/build.mjs --runtime

# 检查数据及入口
node html/scripts/check.mjs archify.json
node html/scripts/check.mjs index.html

# 检查正在运行的服务，核对接口返回值与磁盘 JSON
node html/scripts/check.mjs --url http://127.0.0.1:4175

# 按需生成自带数据的独立 HTML 快照
node html/scripts/build.mjs archify.json archify-export.html
node html/scripts/check.mjs archify-export.html archify.json
```

接口检查不能代替浏览器检查。交付前还需打开实际地址，检查空框架、模块和分层显示、网页保存、JSON 外部更新、冲突提示。停止服务后测试恢复，确保未保存编辑仍保留。

## 模板

`html/templates/` 保留四对模板：画布、模块、分层、项目数据。`*.template.html` 和 `archifytemplate.jsonc` 是包含说明的完整指导书；其余对应文件是最小运行骨架。指导书中的示例不属于实际项目，不能复制进最终架构充当真实数据。
