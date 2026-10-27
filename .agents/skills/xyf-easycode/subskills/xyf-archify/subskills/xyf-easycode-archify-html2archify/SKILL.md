---
name: xyf-easycode-archify-html2archify
description: "取回 EasyCode 网页已保存的架构数据：服务版读取相邻 JSON，独立 HTML 提取 ec-project。用于取回编辑结果，不分析任意网站或根据截图猜测架构。"
---

# HTML 转架构数据

## 输入与输出

- 输入：用户指定的、已经保存到磁盘的 EasyCode HTML，以及 JSON 输出路径。
- 输出：与该 HTML 内保存的项目数据一致的架构 JSON。
- 本技能目录的上两级是技能包根目录。

使用 [序列化模块](../../tools/html/assets/serialization.js) 解析保存的数据，并按 [数据模型](../../tools/html/assets/model.js) 校验字段、ID 和引用。

默认路径相对于目标项目根目录：网页入口 docs/archify/index.html，实际数据 docs/archify/archify.json。服务入口不包含项目快照，直接读取同目录的 JSON 并校验；若数据文件就是输出目标，无需重复写入。浏览器未保存的编辑不在文件中，先完成网页保存。以下提取步骤仅用于用户指定的独立导出 HTML，不能用旧导出快照自动覆盖当前 JSON。

## 工作步骤

1. 读取指定 HTML 的文件内容。浏览器中的未保存编辑不在磁盘文件里；已知有这些编辑时，先让用户在网页保存。
2. 导入 tools/html/assets/model.js 和 tools/html/assets/serialization.js，再使用 EasyCode.Serialization.readProject(html) 提取数据。
3. 该接口只解析 ec-project 数据块，不需要启动浏览器或执行页面脚本。缺少、重复或损坏的数据块属于提取错误，停止并说明，不根据 DOM、截图或示例数据猜一个项目替代。
4. 运行 EasyCode.Model.validate(project)。出现结构错误时先报告和处理，不直接覆盖目标 JSON。
5. 把对象以 UTF-8 JSON 写到目标文件，保留所有已保存的字段、ID、模块内容、外观、布局、分层、连线和视图。提取过程不调用默认值补全或名称翻译。
6. 重新解析输出 JSON，与 readProject 返回的对象深度比较。已有目标文件在写入前发生变化时，先处理冲突。

核心接口的用法如下，html 是读到的文件文本：

    import './tools/html/assets/model.js';
    import './tools/html/assets/serialization.js';
    const project = EasyCode.Serialization.readProject(html);
    const result = EasyCode.Model.validate(project);

校验无错误后，使用 [files.mjs](../../tools/html/scripts/files.mjs) 的 fileVersion 记录目标版本，再用 writeProjectFile(path,project,{expectedVersion}) 保存。目标不存在时版本为 null。检查工具 check.mjs 支持 JSON、服务入口和独立 HTML；独立 HTML 可加第二个 JSON 路径做深度比较。

## 交付与边界

报告实际读取的 HTML、写出的 JSON 和检查结果。需要接着翻译或重新生成网页时，把这份已检查 JSON 作为下一步输入。提取本身不改写原 HTML，也不产生模板、运行脚本或自动启动 Agent。
