---
name: xyf-easycode
description: "XYF EasyCode 项目入口：从需求或源码建立软件架构，部署可编辑架构网站，按架构编写和测试代码，或检查代码是否符合文档。用户要求用 EasyCode 规划、维护、实现或核对项目时使用。"
---

# XYF EasyCode

先理解用户目标，再读取所需子技能，在当前 Agent 中执行并检查产物。

## 理解

确定目标项目、已有需求、源码或架构配置，以及本次交付范围。用户指定的项目优先；未指定时使用当前工作项目。读取目标项目的协作规则，沿用已确认的方案和授权。

空白项目生成框架时，由 xyf-archify 先使用 brainstorming 对话梳理并确认设计；已有头脑风暴结论可直接沿用。已有代码时按真实实现梳理框架。只有架构任务时不顺带编写业务代码，只有编码任务时不重新设计整个架构。

## 执行

本包包含下面四个子技能，均直接放在 subskills/：

| 子技能 | 用途 |
|---|---|
| [xyf-archify](subskills/xyf-archify/SKILL.md) | 从需求或源码生成架构配置，维护设计、部署网页、取回已保存数据、翻译指定名称 |
| [xyf-code](subskills/xyf-code/SKILL.md) | 根据架构配置编写或修改代码，并运行对应检查 |
| [xyf-archifycheck](subskills/xyf-archifycheck/SKILL.md) | 只读检查代码是否符合架构配置或指定文档，报告差异、证据和修改建议 |
| [brainstorming](subskills/brainstorming/SKILL.md) | 梳理尚未确定的需求与设计 |

只读取当前任务需要的说明。调用子技能是读取相应 SKILL.md 并执行，不要求启动额外 Agent。

| 用户目标 | 执行顺序 |
|---|---|
| 从需求或源码生成软件框架，或初始化架构网站 | xyf-archify |
| 按已有框架编码、修改实现或测试 | xyf-code |
| 从需求完成框架和代码 | xyf-archify（先通过 brainstorming 确定设计）→ xyf-code |
| 修改架构数据、翻译名称、取回网页设计 | xyf-archify |
| 检查代码是否符合架构或指定文档，按文档审查实现 | xyf-archifycheck |
| 按框架实现代码，并独立核对实现与文档是否一致 | xyf-code → xyf-archifycheck |

把目标项目路径、当前数据文件、修改范围和已有授权带入所选技能。串联时使用上一步核对后的产物，不把源码分析成功当作实现已经完成。

## 路径与边界

本文件所在目录 .agents/skills/xyf-easycode/ 是技能项目根目录；以上链接相对于本文件。共享工具放在技能根目录的 [tools/](tools/README.md)，与 subskills/ 同级。

以下默认位置均相对于**目标项目根目录**：

| 位置 | 用途 |
|---|---|
| docs/archfiy/archify.json | 目标项目当前的架构数据 |
| docs/archfiy/index.html | Node 生成的编辑器，脚本、样式和模板已内嵌 |
| docs/archfiy/html/ | Node 服务程序及维护工具 |
| docs/archfiy/ReadMe.md | 启动成功后记录实际网页地址、五位数端口和重启命令 |

用户指定路径和已有项目的实际配置优先；旧目录 docs/archify/ 不自动迁移。工具自带的 archify.json 是空框架，已有项目使用自己的数据。xyf-code 把业务代码写到目标项目的代码位置，不写进技能工具目录。

网页保存配置，技能由用户所在的 Agent 执行，网页不会自动启动 Agent。

默认使用 Node.js 22+ 生成并启动网页服务，自动读取部署目录的 archify.json；点击保存直接写回同一文件，不弹出文件选择器。配置是带缩进的纯 JSON，沿用已有字段、稳定 ID 和布局。默认随机选择 10000～65535 的空闲端口，启动成功后在 ReadMe.md 写入实际访问地址；重启后更新地址。通过 HTTP 地址打开网页，不能把双击文件作为默认验收方式。环境缺少 Node 时说明阻碍，不默默退回本地文件模式。

## 检查与交付

按所选技能核对数据、文件、服务或代码。架构网页交付时，检查真实页面及保存后刷新，核对 ReadMe.md 地址、接口和磁盘 JSON 一致；接口成功不能代替页面检查。用简短表格报告实际改动、输出位置、访问地址（如适用）和已执行的检查；未做的检查如实说明。提交、推送、合并按用户要求执行。

## 调用示例

- `$xyf-easycode 为当前项目初始化一个空的软件架构网站。`
- `$xyf-easycode 根据这些需求生成软件框架并部署网页。`
- `$xyf-easycode 分析 src 目录，更新架构配置。`
- `$xyf-easycode 按架构中的任务模块实现代码并测试。`
- `$xyf-easycode 把任务模块中“保存任务”方法的英文名翻译好，保留其他内容。`
- `$xyf-easycode 检查当前项目代码是否符合 docs/archfiy/archify.json，只报告问题。`
- `$xyf-easycode 对照指定接口文档，检查任务模块的输入输出、默认值和错误处理。`
