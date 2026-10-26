---
name: easycode-archify
description: "根据用户需求规划并依次执行 EasyCode 架构任务：源代码转架构 JSON、架构 JSON 转 HTML、从已保存 HTML 提取架构 JSON，以及指定中文名称的英文命名。用于选择或串联这些操作。"
---

# EasyCode Archify

作为面向用户的总入口，确定任务的输入、输出和执行顺序，然后执行所需子技能。用户可以用自然语言提出要求，也可以直接指定某个子技能。

本包中的 archify 指符合 tools/html/assets/model.js 的架构 JSON。当前使用 formatVersion: 1，不因技能命名新增数据格式或文件扩展名。已有 Agent 执行技能；网页不负责安装、扫描、启动或管理 Agent。

## 数据与网页位置

| 文件 | 用途 |
|---|---|
| [tools/archify.json](tools/archify.json) | 当前项目实际使用的架构数据 |
| [archifytemplate.json](tools/html/templates/archifytemplate.json) | 新建项目的默认数据模板 |
| [tools/html/index.html](tools/html/index.html) | 根据当前架构数据生成的运行网页 |

用户没有另指定文件时使用以上位置，指定了其他位置则尊重用户选择。新建项目读取默认模板，并使用 Model.createProject 生成新的项目 ID；不要把模板 ID 当成每个项目共用的 ID。已有项目以当前数据为准。

## 子技能

| 子技能 | 何时使用 | 输入 → 输出 |
|---|---|---|
| [easycode-archify-code2archify](subskills/easycode-archify-code2archify/SKILL.md) | 从实际代码建立或更新架构 | 源代码 → 架构 JSON |
| [easycode-archify-archify2html](subskills/easycode-archify-archify2html/SKILL.md) | 生成或更新可编辑网页 | 架构 JSON → HTML |
| [easycode-archify-html2archify](subskills/easycode-archify-html2archify/SKILL.md) | 取回已保存网页里的设计数据 | EasyCode HTML → 架构 JSON |
| [easycode-archify-translate](subskills/easycode-archify-translate/SKILL.md) | 翻译指定变量、参数、字段或方法的中文名称 | 架构 JSON + 目标范围 → 更新英文名的架构 JSON |

只读取当次需要的子技能说明。调用指在当前 Agent 中读取相应 SKILL.md 并执行；环境支持正式技能调用时可以使用该能力，不要求额外创建 Agent。

## 规划任务

1. 确认用户要达到的结果、已有输入文件、源码范围和输出位置。能从当前工作目录或对话确定的内容自行确定，只询问影响结果的缺失信息。
2. 确定哪份输入是当前依据。用户从网页继续工作时先提取其已保存数据；不能用旧示例 JSON 覆盖网页中的新内容。已知浏览器仍有未保存编辑时，先请用户保存相关 HTML。
3. 列出简短的顺序表：每步的子技能、输入、输出和检查方式。遵守项目关于写入前确认的要求；已有明确授权的范围不重复申请。
4. 逐项执行，把上一步经过检查的产物作为下一步输入。传递用户目标、文件路径、目标对象和检查结果，不让用户重复提供相同上下文。
5. 某步失败时停止依赖它的后续步骤，保留原文件并报告原因，不拿旧产物冒充新结果。
6. 报告实际执行的步骤、输出路径和检查结果。请求提交、推送或额外产物时再执行对应工作。

## 常见顺序

| 用户需求 | 执行顺序 |
|---|---|
| 从源码生成架构数据 | code2archify |
| 从源码生成可编辑网页 | code2archify → archify2html |
| 用已有 JSON 生成网页 | archify2html |
| 从编辑后的网页取回数据 | html2archify |
| 翻译 JSON 中指定的方法或变量 | translate |
| 翻译网页里的名称并更新网页 | html2archify → translate → archify2html |

不要求每次都执行四个子技能。根据输入和目标选取必要步骤，翻译只在用户要求的范围内执行。

## 共用约定

- 数据字段、创建函数和校验以 [model.js](tools/html/assets/model.js) 为准。tools/archify.json 是当前项目数据，archifytemplate.json 是默认数据模板。
- 修改现有数据时保留稳定 ID、无关字段、布局和关系。新增对象使用模型创建函数，提供完整默认值。
- 使用模型更新函数处理语义变化和来源状态；保存前检查类型、ID 和引用，检查失败不替换原文件。重新读取写出的结果进行核对。
- 保存前检查输入和目标文件是否已被其他操作改变；发生冲突时先处理，不直接覆盖新内容。
- 网页工程位于 tools/html/，包含 assets/、templates/、scripts/。生成和检查入口为 tools/html/scripts/build.mjs、tools/html/scripts/check.mjs；使用本包工具，不切换到旁边独立的 archify 引擎。
- 当前网页编辑结果保存到 HTML 的 ec-project 数据块；取回 JSON 使用 html2archify。不能声称网页已经持续读写、自动刷新独立 JSON。
- 界面行为以 tools/html/assets/ 和 tools/html/templates/ 中的实现为准；各子技能就地维护所需规则。

## 数据与校验要点

- 顶层保存项目名称、描述、repository、groups、modules、relations 和 view；formatVersion 表示数据格式版本，repository.revision 表示被描述代码的版本，两者分别保存。
- 对象 ID 在项目内全局唯一，以英文字母开头，仅含英文字母、数字、下划线和连字符。重命名不换 ID；分层、连线和展开状态通过 ID 引用，删除后清理失效引用。
- 模块成员和字段类型以模型为准，不能因为网页逐行编辑就把原本的文字字段改成数组。保留用户的默认值、来源、布局和未涉及内容。
- codeLocation 是相对项目代码目录的路径，可逐行记录多个位置；源码出处单独保存在 sources，包含相对路径、从 1 开始的行号和必要的符号信息。
- planned 表示尚未核对的设计，verified 表示有源码依据的事实，modified 表示已核对内容发生了语义修改。结构校验通过不等于源码事实已被证实。
- Model.validate(project) 返回 errors 和 warnings。错误处理完成后才替换目标文件，警告按实际内容核查；保存后读回比较，不能用虚假内容填平缺项。
