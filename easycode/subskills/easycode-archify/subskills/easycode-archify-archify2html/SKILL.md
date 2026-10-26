---
name: easycode-archify-archify2html
description: "把 EasyCode 架构 JSON 生成为自带数据、样式和脚本的可编辑 HTML，或用明确的数据基准更新已有网页。用于架构数据转网页，不负责分析源码或自动翻译名称。"
---

# 架构数据转 HTML

## 输入与输出

- 输入：符合当前模型的架构 JSON、HTML 输出路径，以及用户要求保留的网页定制。
- 输出：可独立打开、编辑和保存的 EasyCode HTML。
- 本技能目录的上两级是技能包根目录。以下默认命令从包根目录运行；用户指定其他输入输出时替换相应路径。

数据字段与校验以 [数据模型](../../tools/html/assets/model.js) 为准。使用本包的 [生成工具](../../tools/html/scripts/build.mjs)、[检查工具](../../tools/html/scripts/check.mjs)、tools/html/assets/ 与 tools/html/templates/。

## 工作步骤

1. 读取指定 JSON，运行 EasyCode.Model.validate。结构错误修复前不生成目标文件；警告按实际内容处理。
2. 确定输入基准。用户要求从已编辑 HTML 继续工作时，先由 html2archify 取回已保存数据，不能直接换成旧示例 JSON。
3. 需要更新已有 HTML 时，确认其中是否有用户定制的模板或脚本。使用 loadBundle 会刷新为本包当前模板和运行代码；需要保留的定制先明确合并方式。
4. 生成并检查 HTML：

    node tools/html/scripts/build.mjs "tools/archify.json" "tools/html/index.html"
    node tools/html/scripts/check.mjs "tools/html/index.html"

5. 通过 EasyCode.Serialization.readProject 重新读取输出 HTML，并与输入 JSON 深度比较。ID、字段值、布局、分组、连线和视图应保持一致，不补译英文名或擅自整理业务内容。
6. 需要查看效果且当前工具允许时，检查真实编辑和排版。把数据检查、浏览器检查、原生保存窗口检查分别报告，未执行的不算通过。

程序化生成时，tools/html/scripts/build.mjs 导出 loadBundle 和 assemble。assemble(project, await loadBundle()) 返回 HTML；readProject 位于 tools/html/assets/serialization.js，导入后通过 globalThis.EasyCode.Serialization 使用。

生成结果包含 ec-project 项目数据、ec-bundle 源码包和模块节点模板。使用 assemble 或 Serialization.buildDocument 完成内嵌 JSON、脚本和模板槽位的转义与拼装，不手工拼接项目数据块。页面所需的样式、脚本和图标应包含在 HTML 内。

## 交付与边界

交付实际生成的 HTML 路径和检查结果。运行网页的基础功能无需安装 Node 或启动服务，英文名翻译按钮联网时才使用外部服务。Node 用于开发和生成工具。

网页保存仍写入 HTML 的 ec-project 数据块；不要承诺独立 JSON 自动同步。只刷新网页时不修改输入 JSON、源码或其他项目文件，不另建自动版本副本。
