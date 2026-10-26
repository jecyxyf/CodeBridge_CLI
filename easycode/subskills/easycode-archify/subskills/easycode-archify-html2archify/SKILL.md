---
name: easycode-archify-html2archify
description: "从已保存的 EasyCode HTML 中提取 ec-project 架构数据，检查后输出 JSON。用于取回网页编辑结果，不用于分析任意网站或根据截图猜测架构。"
---

# HTML 转架构数据

## 输入与输出

- 输入：用户指定的、已经保存到磁盘的 EasyCode HTML，以及 JSON 输出路径。
- 输出：与该 HTML 内保存的项目数据一致的架构 JSON。
- 本技能目录的上两级是技能包根目录。

使用 [序列化模块](../../tools/html/assets/serialization.js) 解析保存的数据，并按 [数据模型](../../tools/html/assets/model.js) 校验字段、ID 和引用。

没有另指定路径时，从 tools/html/index.html 提取数据，写入 tools/archify.json；替换已有运行数据前先确认输入基准和保存范围。

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

校验无错误后使用 JSON.stringify(project, null, 2) 写入 JSON。当前检查工具 tools/html/scripts/check.mjs 接受的是 HTML；不要把 JSON 路径当成它的输入。

## 交付与边界

报告实际读取的 HTML、写出的 JSON 和检查结果。需要接着翻译或重新生成网页时，把这份已检查 JSON 作为下一步输入。提取本身不改写原 HTML，也不产生模板、运行脚本或自动启动 Agent。
