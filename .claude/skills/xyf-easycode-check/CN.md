---
name: xyf-easycode-check
description: 对照软件架构审查代码及测试内容，输出缺失、不符合项和依据，按授权保存审查报告；不改业务代码或架构，不运行程序或测试。开发前找差异、开发后验收时使用。
---

# 内容审查

## 工作内容

读取 `docs/xyf-easycode/html/software_architecture.js` 的架构 JSON，对照源码列缺失、差异及依据。文档相对项目；源码按 `repository.path` 及 `codeLocation`（每行一个路径）定位，根目录不明先核实；技能链接相对本目录。

只读审查，不改业务代码、架构或状态，不运行程序、测试或构建；仅按授权保存报告。改动引入的实际缺陷由 [review-agent](../review-agent/SKILL.md) 审查。

**规则**：确定项目后，开始前及每批写入前重读 `<project>/docs/xyf-easycode/PromptsRules.md`；缺失先读[模板](../xyf-easycode-install/PromptsRules.md)并说明，交 [install](../xyf-easycode-install/SKILL.md) 按授权补齐；读取失败暂停。

## 如何审查

1. **读取依据**：JS 用 [ProjectFile.parse](../xyf-easycode-install/html/assert/project-file.js) 读取，不执行配置代码；按[数据说明](../xyf-easycode-install/html/references/architecture-data.jsonc)和 [Model.validate](../xyf-easycode-install/html/assert/model.js) 校验。读失败报未完成，不补设计。`unknowns` 所列及 `inputsConfirmed/outputsConfirmed` 为 false 的部分标未核实，不判代码错误。
2. **确定范围**：记录架构及源码版本、未提交修改和范围。[code](../xyf-easycode-code/SKILL.md) 调用时查本批及受影响部分；单独调用按指定范围，未指定查全部。
3. **逐项对照**：按模块及成员 ID 检查：

| 内容 | 审查要求 |
|---|---|
| 模块和类 | `purpose/requirements` 的职责、限制、类名、语言、文件位置 |
| 属性和数据 | 参数的名称、类型、说明、`required/defaultValue`；`structures[].fields`；空默认值不补 |
| 方法和接口 | `interfaces` 用途、输入输出；按 `flow` 顺序和条件、`errors` 错误处理逐步核对 |
| 调用和事件 | 按 `dependencies`、`flow` 核对调用、数据及 `events` 方向、参数；`relations` 仅辅助定位 |
| 测试内容 | `tests.steps/expected` 落实为正常、边界、出错用例，断言明确；位于 `docs/xyf-easycode/tests/` |
| 代码注释 | 按 [code 约定](../xyf-easycode-code/SKILL.md#2-write-code-and-tests)：每5行至少1行注释，内容符合实现，模板句、复述代码不计入，语言与架构网页一致 |

4. **查找证据**：沿入口、注册、调用和数据传递找到实现，记录路径和行号。找不到列为缺失；不凭名称、注释、图上状态或测试通过判符合。
5. **查全再结论**：补查遗漏和受影响部分；查不清列未核实，需改架构交 [requirements](../xyf-easycode-requirements/SKILL.md)。要求、代码或范围变化后复查。

## 审查报告如何写

先列项目、架构完整路径、架构及源码版本、已查和未查范围，再逐项填写：

| 模块 | 接口 | 架构要求 | 实现依据 | 结论 | 问题 |
|---|---|---|---|---|---|
| 名称及 ID | 名称及 ID；无则写模块整体 | 具体规定 | 路径及行号 | 符合／不符合／未核实 | 缺失或差异；无则写无 |

总体结论为“通过”“有差异”或“未完成”。查全且无差异、无未核实项才通过；静态审查不当作运行结果。

- **保存位置**：`docs/xyf-easycode/reports/<审查ID>_check.md`。ID 用本地时间 `yyyy_mm_dd_hh_mm_ss_ms`，24 小时制、毫秒 3 位；重名重取，不覆盖。
- **写入授权**：保存前说明文件和范围；沿用有效授权，否则等用户单独回复“执行”。只写本次报告。
- **保存交付**：回读核对后交付完整路径、结论及未完成项；未保存不声称已保存。
