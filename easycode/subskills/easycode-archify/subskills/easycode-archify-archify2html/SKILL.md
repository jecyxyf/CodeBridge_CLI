---
name: easycode-archify-archify2html
description: "把 EasyCode 架构 JSON 部署为本地可编辑网站，启动服务并核对数据；也可按需导出独立 HTML。用于架构数据转网页，不负责分析源码或自动翻译名称。"
---

# 架构数据转网页：理解 → 执行 → 检查

输出是完整可编辑网站、当前架构 JSON 和实际访问地址。工具说明见 [README](../../tools/README.md)，字段和校验以 [model.js](../../tools/html/assets/model.js) 为准。

## 路径约定

本 SKILL.md 的上两级是**技能包根目录**。下面的工具命令从技能包根目录运行。目标路径相对于**目标项目根目录**：

| 位置 | 用途 |
|---|---|
| 技能包内 `tools/` | 完整工具源目录；其中 JSON 是空框架 |
| 目标项目 `docs/archify/archify.json` | 当前项目的唯一数据文件 |
| 目标项目 `docs/archify/index.html` | 网页入口，不内嵌项目快照 |
| 目标项目 `docs/archify/html/` | 服务、程序、脚本和模板 |
| 目标项目 `docs/archify/README.md` | 随部署复制的使用说明 |

不要把目标目录拼成 `docs/archify/docs/archify`，也不要把入口放回 `html/index.html`。用户明确指定其他目录时按指定范围处理，并调整相对路径。

## 1. 理解

1. 阅读项目协作规则，确定目标项目根目录、当前 JSON、已有部署和用户要求保留的网页定制。已能确定的信息不重复询问。
2. 默认使用目标项目的 `docs/archify/archify.json`。新项目才使用空框架或明确指定的输入。服务网页以独立 JSON 为准；从导出的 HTML 继续时，先用 html2archify 提取已保存数据。不能用工具空框架覆盖已有设计。
3. 用 Model.validate 校验输入，确认模块、分层和连线数量。错误解决前不替换目标；警告按实际内容核查。此次只部署时，业务字段、英文名、ID、布局均不改动。
4. 确认电脑已有 Node.js 22+。本工具不需要安装 npm 依赖；未安装 Node 时说明缺少的环境，不擅自安装。

## 2. 执行

新部署或更新工具时，使用 [deploy.mjs](../../tools/html/scripts/deploy.mjs)：

```sh
node tools/html/scripts/deploy.mjs "<目标项目根目录>" --start
```

明确指定输入 JSON 时，在命令中加入 `--source-json "<JSON路径>"`。命令参数中的相对路径均相对于当前终端目录。已有目标 JSON 会保留；输入与目标不同则停止，先确定正确的数据基准。

脚本复制整套工具、打包根目录入口，并启动本机服务。默认从 4175 起选择可用端口；同一目标已有服务时复用。保持服务进程运行，在 Windows 后台启动时隐藏窗口；不要关闭其他项目的服务。

仅需启动已有部署时，从**目标项目根目录**运行：

```sh
node docs/archify/html/server.mjs
```

已有网页且只修改了 JSON 时，不重新复制工具或重建 HTML。网页约每 2 秒读取变化；有未保存编辑时保留并提示用户处理。网页保存直接写回同一 JSON。

修改了工具源码或模板时，从**技能包根目录**运行 `node tools/html/scripts/build.mjs --runtime`，再部署新程序。完整指导书 `*.template.html` / `archifytemplate.jsonc` 只供查阅；运行模板中的空槽位由工具填充，不把示例内容当作真实架构。

只有用户需要独立快照时，调用 `build.mjs <JSON路径> <HTML输出路径>`。生成器先写临时文件、读回比较，再替换输出；独立快照不能覆盖网站的 `index.html`。

## 3. 检查

1. 从**目标项目根目录**运行：

```sh
node docs/archify/html/scripts/check.mjs docs/archify/index.html
node docs/archify/html/scripts/check.mjs --url <实际访问地址>
```

2. 核对接口与磁盘 JSON 深度一致，字段、ID、数量、布局、分层和连线不丢失。健康检查通过不等于页面验证通过。
3. 打开实际 HTTP 地址，核对模块和分层是否在视野内。需要验证写入时使用独立测试项目，检查网页保存后 JSON 更新、外部 JSON 修改后网页刷新，以及冲突时保留未保存内容。不向用户的正式架构添加测试数据。
4. 独立快照使用 `check.mjs <HTML路径> <输入JSON路径>` 核对；服务入口无 ec-project，不能用 readProject 从入口提取当前设计。
5. 失败时保留原数据并修复后再验证。分别报告数据检查、服务检查和浏览器检查；未执行的检查不能写成通过。

交付实际部署目录、JSON 路径、HTTP 地址、启动/停止方法和检查结果。网页需要服务保持运行；不要只交付文件路径就声称完成可访问部署。
