---
name: xyf-easycode
description: 按用户目标选择并衔接 EasyCode 的需求设计、网页安装、内容审查、代码开发、架构同步和缺陷审查技能。用户提到 EasyCode 或软件架构流程，或不确定该用哪个 EasyCode 技能时使用。
---

# XYF EasyCode 主技能

本技能负责确定任务归属、检查前提和衔接技能，具体执行由对应技能决定。结合用户要求和已有上下文确定目标项目及范围，只问缺少的关键信息；完成当前范围后交付，已有明确后续任务和授权时继续。

**规则**：确定项目后，开始前及每批写入前重读 `<project>/docs/xyf-easycode/PromptsRules.md`；缺失先读[模板](../xyf-easycode-install/PromptsRules.md)并说明，交 [install](../xyf-easycode-install/SKILL.md) 按授权补齐；读取失败暂停。

安装时，将本目录和下表中的六个技能目录一起放入当前 Agent 支持的技能目录，保持同一父目录，并保留各目录内的全部文件。不要覆盖已有的用户修改。

## 技能路由

按用户要的结果选择技能，只读取选中技能的 `SKILL.md` 及当前所需资源。调用前确认目标技能及必要依赖存在；缺失时报告具体缺项，暂停受影响任务，不得假称已加载或可用。下列链接均相对本文件所在目录。

| 任务 | 技能 |
| --- | --- |
| 沟通需求，生成或更新软件架构文件 | [xyf-easycode-requirements](../xyf-easycode-requirements/SKILL.md) |
| 部署架构网页或补齐 PromptsRules.md | [xyf-easycode-install](../xyf-easycode-install/SKILL.md) |
| 对照架构和代码找差异，出审查报告 | [xyf-easycode-check](../xyf-easycode-check/SKILL.md) |
| 按架构和审查报告排任务、编码、测试和交付 | [xyf-easycode-code](../xyf-easycode-code/SKILL.md) |
| 代码修改后把架构 JSON 同步为实际代码（仅用户手动触发） | [xyf-easycode-sync](../xyf-easycode-sync/SKILL.md) |
| 只读审查指定代码改动引入的新缺陷 | [review-agent](../review-agent/SKILL.md) |

## 工作流程

0. **安装网页**：项目还没有 `docs/xyf-easycode/html/` 或 `PromptsRules.md` 时，先调用 install 按授权补齐。
1. **需求沟通与架构设计**：调用 requirements，沟通需求，确认后生成或更新架构文件。
2. **差异审查**：调用 check，对照架构和代码，出审查报告，列出缺失和差异。
3. **代码开发**：调用 code。主代理按报告拆分任务，用户确认后，子代理分模块写代码和测试；每个模块先用 check 对照架构，再用 review-agent 找缺陷，有问题退回子代理修复，修好再审；全部模块通过后，整体审查和联调。直到审查报告显示所有工作都符合需求，才算完成。
4. **架构同步**：code 不调用 sync。代码在本流程之外被改过、架构跟不上实际代码时，提示用户手动触发 sync。
