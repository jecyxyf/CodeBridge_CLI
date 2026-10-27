---
name: xyf-archify
description: "从需求或源码生成、维护 EasyCode 软件架构 JSON，部署可编辑网站，取回网页保存的数据，或翻译指定方法和参数的英文名。用于软件框架设计与维护；根据框架编码交给 xyf-code。"
---

# XYF Archify

按“理解 → 执行 → 检查”完成架构工作。原有源码分析、网页部署、数据提取和名称翻译都在本技能内执行，不再分设子技能。

## 1. 理解

确定目标项目、需求或源码范围、当前架构文件，以及本次结果。读取目标项目协作规则，沿用已有授权。未明确的设计可用同级 [brainstorming](../brainstorming/SKILL.md) 梳理；已有清楚方案时直接处理。

以目标项目当前 JSON 为数据基准。服务网页的设计在独立 JSON 中；只有从独立 HTML 快照继续工作时才提取内嵌数据。已知网页有未保存内容时先处理，不能用旧快照或工具空框架覆盖设计。

| 输入与目标 | 选用的执行方式 |
|---|---|
| 需求 → 软件框架 | 根据需求设计架构 |
| 源码 → 软件框架 | 从源码提取或核对架构 |
| 空项目或 JSON → 可编辑网站 | 部署与启动网站 |
| 已保存网页 → JSON | 取回已保存数据 |
| 指定中文名称 → 英文标识 | 翻译指定名称 |

可以串联必要步骤，例如“源码 → JSON → 网站”；不要求每次全部执行。实际编码读取同级 [xyf-code](../xyf-code/SKILL.md)。

### 路径

共享工具位于 **xyf-easycode 根目录**的 tools/，与 subskills/ 同级。xyf-easycode 根目录是本文件所在目录的上两级。文档链接相对于本文件；下面 tools/ 路径和工具命令均相对于 xyf-easycode 根目录，命令参数中的相对路径则相对于当前终端目录。

| 位置 | 用途 |
|---|---|
| [tools/README.md](../../tools/README.md) | 整套工具的部署与使用说明 |
| [tools/archify.json](../../tools/archify.json) | 随工具提供的最小空框架，无示例模块 |
| [tools/index.html](../../tools/index.html) | 服务版网页入口 |
| 目标项目 docs/archify/archify.json | 项目当前架构数据 |
| 目标项目 docs/archify/index.html | 部署后的网站入口 |
| 目标项目 docs/archify/html/ | 网页程序、本地服务、脚本和模板 |

默认输出路径相对于**目标项目根目录**。用户另有指定时采用指定位置。部署目标参数传项目根目录，避免拼成 docs/archify/docs/archify。

[model.js](../../tools/html/assets/model.js) 是字段、创建函数、更新函数和校验规则的依据，当前 formatVersion 为 1。不使用旁边原版 archify 引擎的数据格式。

### 模板

完整模板是参数指导书；运行模板是待填充的最小骨架。指导书的演示对象与来源不能作为真实项目数据。

| 类型 | 完整指导书 | 运行骨架 |
|---|---|---|
| 画布 | [canvas.template.html](../../tools/html/templates/canvas.template.html) | [canvas.html](../../tools/html/templates/canvas.html) |
| 模块 | [module-node.template.html](../../tools/html/templates/module-node.template.html) | [module-node.html](../../tools/html/templates/module-node.html) |
| 分层 | [group-layer.template.html](../../tools/html/templates/group-layer.template.html) | [group-layer.html](../../tools/html/templates/group-layer.html) |
| 项目数据 | [archifytemplate.jsonc](../../tools/html/templates/archifytemplate.jsonc) | [archifytemplate.json](../../tools/html/templates/archifytemplate.json) |

## 2. 执行

只读取所选方式需要的工具源码或模板。任务在当前 Agent 内完成，工具不安装或管理 Agent。

### 根据需求设计架构

1. 从已确定的需求整理模块功能、功能需求、编程语言、相对代码位置、分层和模块关系。按本次范围填写参数、数据结构、方法输入输出、实现流程、错误处理、消息参数及测试要求。
2. 已有 JSON 时在原设计上修改，保留稳定 ID、用户名称、布局、外观和范围外内容。新项目用 Model.createProject 创建独立 ID，并参考运行骨架填充项目内容。
3. 新模块及成员使用 Model.createModule、createInterface、createParameter、createStructure、createStructureField、createEvent、createTest 等创建函数，再填入实际名称和说明。默认示例文字不能代替已完成的设计。
4. 需求设计用 planned 状态；没有源码依据时不填写虚构 sources 或 Git 版本。只有已经明确的输入、输出才能设置对应 Confirmed 标记。影响实现的关键缺口需明确处理，普通选择依据项目约定完成。
5. 按“保存与数据约定”校验、保存。用户要求网站时继续部署；用户要求编码时把已检查的 JSON 交给 xyf-code。

### 从源码提取或核对架构

1. 搜索定义、调用和引用，再读取实现。文件名或同名符号不足以证明功能与关系，不自动把每个文件或函数都建成模块。
2. 根据实际代码填写模块、成员和连线。方法保存在 interfaces；源码已有标识记录在 englishName，不随意翻译或改名。中文名称和说明解释其用途。
3. 方法需核对定义、默认值、分支和返回位置，输入输出确实核对后才设置 inputsConfirmed / outputsConfirmed。空列表且未确认表示未知。
4. sources 记录实际读过的仓库相对路径、从 1 开始的行号及必要的 endLine、symbol；codeLocation 单独保存相对代码位置。有向关系须有实际调用或导入依据。
5. Git 项目记录实际 revision，repository.dirty 根据整个仓库判断。修改过、未跟踪或被忽略的源码在交付中说明必要的差异或内容哈希，提交号不能证明这些文件的实际内容。非 Git 项目不编造提交号。
6. 只有核对过的内容才标为 verified。更新既有语义通过模型更新函数处理状态；重新核对时检查来源与版本，不把范围外内容一并标为已验证。
7. 校验并保存。此方式不修改被分析的业务代码；源码事实核对也不代表实现测试已经通过。

### 部署与启动网站

先校验 JSON，核对模块、分层、连线数量及已有网页定制。需要 Node.js 22+，无 npm 依赖；缺少环境时说明，不擅自安装。

新部署或更新网站程序，从 **xyf-easycode 根目录**运行：

```sh
node tools/html/scripts/deploy.mjs "<目标项目根目录>" --start
```

指定输入时加 `--source-json "<JSON路径>"`。[deploy.mjs](../../tools/html/scripts/deploy.mjs) 复制整套工具并生成入口；已有目标 JSON 保留，输入与目标不同时停止，先确定数据基准。只部署时不修改业务字段、英文名、ID 或布局。

默认从 4175 起选择可用端口，同一目标已有服务时复用，以实际输出地址为准。保持服务进程运行；Windows 后台启动隐藏窗口，不关闭其他项目服务。停止该进程可用 Ctrl+C。

仅启动已有部署时，从**目标项目根目录**运行：

```sh
node docs/archify/html/server.mjs
```

只修改 JSON 时不重建入口或重新复制工具。网页约每 2 秒检测变化，有未保存编辑时保留并提示；网页保存写回同一 JSON。

只有工具源码或模板发生修改时，才从 xyf-easycode 根目录运行 `node tools/html/scripts/build.mjs --runtime` 再部署。生成器读取运行模板，不打包完整指导书。用户只要独立快照时用 `node tools/html/scripts/build.mjs <JSON路径> <HTML输出路径>`，不能覆盖服务入口 index.html。

### 取回已保存数据

服务入口 docs/archify/index.html 没有 ec-project 快照，读取相邻 archify.json 并校验；若它就是输出目标，无需重复写入。浏览器未保存内容需先完成保存。

对于明确指定的独立 HTML，导入 [model.js](../../tools/html/assets/model.js) 和 [serialization.js](../../tools/html/assets/serialization.js)，调用 EasyCode.Serialization.readProject(html)。此接口只解析数据块，不执行页面脚本。缺少、重复或损坏的数据块应报提取错误，不从页面外观猜测项目。

保存提取对象时保留所有字段、ID、内容和布局，不补默认值、不翻译、不改原 HTML。记录目标文件版本后安全写入，读回与提取结果深度比较。不能用旧快照自动覆盖当前设计。

### 翻译指定名称

用模块、对象种类与稳定 ID 定位目标；中文名重复且无法消除歧义时让用户选择，不批量修改所有同名对象。

| 对象 | 数据位置 |
|---|---|
| 模块参数 | modules[].parameters[] |
| 数据结构字段 | modules[].structures[].fields[] |
| 方法 | modules[].interfaces[] |
| 方法输入、输出 | modules[].interfaces[].inputs[] / outputs[] |
| 消息参数 | modules[].events[].parameters[] |

由当前 Agent 结合用途、类型和项目术语翻译，不启动额外 Agent 或要求翻译服务。沿用目标项目命名约定；没有约定时，变量和方法用 camelCase。可复用 [translation.js](../../tools/html/assets/translation.js) 的纯函数 EasyCode.Translation.formatName(englishText, 'parameter') 整理 camelCase，该函数不负责语义翻译。

结果必须是目标语言可用的英文标识，不包含中文、空格或括号签名。检查作用域内重名与合法重载；例如“保存任务”可为 saveTask，“任务编号”可为 taskId，不做随机同义词抽取。

只更新指定 englishName 及模型要求的相关来源状态，保留其他字段。通过模型更新函数修改，并检查差异范围。不要顺带修改源码、翻译整个项目或调用网页在线翻译按钮。保存后已有服务自动检测变化。

### 保存与数据约定

- 使用 globalThis.EasyCode.Model；Node 可通过 `import './tools/html/assets/model.js'` 加载模型。对象 ID 全局唯一，重命名不换 ID；引用通过 ID 关联，删除对象时清理失效引用。
- codeLocation 是相对项目代码目录的路径，可逐行记录多个位置。方法在 interfaces 中；方法 flow、errors 与事件 flow 是逐行文本，不因为网页逐行编辑就改成数组。参数 defaultValue 按模型保存字符串。
- planned 是设计，verified 是有源码依据的事实，modified 是已核对内容发生了语义变化。使用 Model.updateModule、updateInterface、updateMember 等函数更新现有语义及状态。
- Model.validate(project) 返回 errors 和 warnings。结构错误处理后才能替换文件；警告按实际内容核查，不填假数据消除提示。
- 使用 [files.mjs](../../tools/html/scripts/files.mjs) 的 readProjectFile 读取 project、version，再用 writeProjectFile(path, project, {expectedVersion: version}) 保存并读回核对。新文件 expectedVersion 为 null；提取到另一目标时用 fileVersion 记录其版本。输入或目标已变化时先处理冲突，不盲目覆盖或重试。
- 保存保留范围外字段、默认值、来源、布局与关系。服务版以 JSON 为准，独立导出 HTML 才含数据快照。

## 3. 检查

所有数据修改都做模型校验、范围差异检查及保存后读回比较。部署后从**目标项目根目录**运行：

```sh
node docs/archify/html/scripts/check.mjs docs/archify/index.html
node docs/archify/html/scripts/check.mjs --url <实际访问地址>
```

核对接口与磁盘 JSON 深度一致。独立快照用 check.mjs <HTML路径> <输入JSON路径> 比较。健康检查不能代替浏览器检查：打开实际 HTTP 地址核对模块、分层和连线是否显示、是否在视野内。

需要验证保存、外部更新、未保存冲突或服务恢复时使用独立临时项目，避免向正式架构加入测试数据。检查失败先处理，不能拿旧产物当作新结果。

简短表格交付实际修改、JSON 路径、源码分析范围与版本（如适用）、访问地址与启动/停止方法、实际执行的检查。分别说明数据校验、源码核对、服务和页面检查，未做的检查不写成通过。
