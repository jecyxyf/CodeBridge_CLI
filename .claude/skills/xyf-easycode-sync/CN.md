---
name: xyf-easycode-sync
description: 代码修改后对照实际代码列出架构差异，确认后只把有意改动写回软件架构 JSON；代码写错的不回写，不改代码。只允许用户手动触发，禁止代理或其他技能自动调用。
disable-model-invocation: true
---

# 架构同步

作为资深软件架构师，代码修改完成后，把 `docs/xyf-easycode/html/software_architecture.js` 同步为实际代码，避免下次 check 把有意修改判为不符合。代码是事实源；本技能只改架构 JSON，不改代码、不运行程序或测试。

**规则**：以上路径相对目标项目。确定项目后，开始前及每批写入前重读 `<project>/docs/xyf-easycode/PromptsRules.md`；缺失先读[模板](../xyf-easycode-install/PromptsRules.md)并说明，交 [install](../xyf-easycode-install/SKILL.md) 按授权补齐；读取失败暂停。

**触发限制**：只允许用户手动触发；代理和其他技能不得自动调用，发现需要同步时只提示用户。

## 如何同步

1. **读取两侧**：按 [check](../xyf-easycode-check/SKILL.md) 的读取和定位方法读架构 JSON 与实际代码，记录架构及源码版本和未提交修改。
2. **列差异清单**：逐模块列出“代码已实现、架构未跟上”的差异：新增或删除的模块、接口、参数、structures 字段、events、tests，`codeLocation` 文件路径，`sources` 的路径、`line/endLine`、`symbol`，以及 `repository.revision/dirty`；用表格列出，每行写模块及 ID、差异、要改的 JSON 字段和代码依据（路径及行号）。
3. **方向判定**：只回写代码里的真实意图；代码写歪、架构才正确的项不回写，列为代码问题交 [code](../xyf-easycode-code/SKILL.md) 处理，不把缺陷固化进架构。
4. **填写状态**：有源码证据且内容一致的项 `status` 填 `verified`；本次改了含义的项填 `modified`；查不清的写入 `unknowns`，不填 `verified`。
5. **确认后写入**：差异清单交用户确认，沿用有效授权，未授权等用户单独回复“执行”；写入遵守 [requirements](../xyf-easycode-requirements/SKILL.md) 的架构文件读写规范和布局锁定规则，保留未涉及字段、已有 ID 和 formatVersion，新 ID 全局唯一。
6. **写入核对**：保存前检查外部修改，有冲突先暂停；保存后回读、解析、校验，确认写入成功。

## 结果如何交付

交付差异清单、实际更新的字段汇总和回读校验结果；未确认不写入，未写入不声称已同步。
