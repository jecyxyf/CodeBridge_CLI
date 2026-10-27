---
name: xyf-easycode
description: "XYF EasyCode 项目技能：从源码建立架构 JSON，部署可编辑架构网站，取回网页保存的数据，以及翻译指定变量或方法的英文名称。用户要求用 EasyCode 初始化、梳理或维护软件架构时使用。"
---

# XYF EasyCode

软件架构工作的统一入口。理解用户目标，调用本包已有子技能，再核对实际产物。技能由当前 Agent 执行。

## 理解

确定目标项目、已有源码或架构文件，以及本次需要完成的结果。用户指定的项目优先；未指定时使用当前工作项目。读取目标项目的协作规则，沿用对话中已经确认的方案和授权。

需要讨论尚未确定的新需求或设计时，按需读取 [brainstorming](subskills/brainstorming/SKILL.md)。已经明确的架构转换、部署、提取或翻译任务，直接进入对应执行流程。

## 执行

架构任务先读取 [xyf-archify](subskills/xyf-archify/SKILL.md)，由它选择所需子技能和执行顺序。只加载本次需要的说明。

| 用户目标 | 使用的子技能 |
|---|---|
| 从源码生成或更新架构 JSON | [code2archify](subskills/xyf-archify/subskills/xyf-easycode-archify-code2archify/SKILL.md) |
| 初始化空框架、用 JSON 部署网站，或按需导出独立 HTML | [archify2html](subskills/xyf-archify/subskills/xyf-easycode-archify-archify2html/SKILL.md) |
| 取回网页已经保存的架构数据 | [html2archify](subskills/xyf-archify/subskills/xyf-easycode-archify-html2archify/SKILL.md) |
| 翻译指定方法、参数或字段的英文名称 | [translate](subskills/xyf-archify/subskills/xyf-easycode-archify-translate/SKILL.md) |

把用户目标、目标项目路径、当前数据文件、修改范围和已有授权一起传给子技能；串联任务时使用上一步核对后的产物。服务网站以独立 JSON 为准；从导出的 HTML 继续工作时才提取快照。具体转换和保存规则由对应子技能负责。

## 路径

本文件所在目录 `.agents/skills/xyf-easycode/` 是整个技能项目的根目录，也就是项目技能入口。子技能、工具、模板和测试均放在此目录内，直接在这里开发和调试。上面的链接相对于本文件；子技能中的相对路径按各自说明解析。

工具源目录为 [subskills/xyf-archify/tools/](subskills/xyf-archify/tools/README.md)。部署和运行命令见该目录的说明。

以下默认位置均相对于**目标项目根目录**，用户明确指定其他位置时沿用用户选择：

| 位置 | 用途 |
|---|---|
| `docs/archify/archify.json` | 目标项目当前的架构数据 |
| `docs/archify/index.html` | 可编辑网站入口 |
| `docs/archify/html/` | 网页程序、本地服务和模板 |

工具自带的 `archify.json` 是新项目的空框架；已有项目使用自己的数据。可编辑网站使用 `xyf-archify` 的模型和工具，旁边 `subskills/archify/` 的独立图形引擎使用另一套数据格式，不能混用。

## 检查

按所选子技能完成数据校验、保存后读回核对，以及适用的服务和网页检查。某步失败时先报告具体问题，不把旧产物当作新结果。用简短表格交付输出路径、实际访问地址和已执行的检查；源码事实核对、数据校验和页面检查分别说明。

## 调用示例

- `$xyf-easycode 为当前项目初始化一个空的软件架构网站。`
- `$xyf-easycode 分析 src 目录，生成架构 JSON 并部署可编辑网站。`
- `$xyf-easycode 从指定的独立 HTML 中提取架构 JSON。`
- `$xyf-easycode 把任务模块中“保存任务”方法的英文名翻译好，保留其他内容。`
