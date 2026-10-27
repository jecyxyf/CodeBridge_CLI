---
name: xyf-archify
description: "通过头脑风暴对话或真实源码生成、维护 EasyCode 软件框架 JSON，并部署可编辑网页。用于框架设计、源码梳理及指定 JSON 内容的修改；业务代码实现与测试由 xyf-code 负责。"
---

# XYF Archify

按“理解 → 执行 → 检查”完成软件框架工作。主线为：确定生成方式 → 梳理框架内容 → 自上而下布局 → 校验 JSON → 部署网页。

## 1. 理解

### 职责与数据基准

架构设计统一保存在一份项目 JSON 中，网页围绕这份 JSON 展示和编辑。可以读取源码作为依据，不编写、修改或测试业务代码；业务实现由同级 [xyf-code](../xyf-code/SKILL.md) 负责。任务在当前 Agent 内完成，不启动额外 Agent。

确定目标项目、本次功能范围、当前架构文件和修改范围。读取项目协作规则，沿用已有授权；优先从上下文判断，只询问确实缺少的关键信息。

已有项目使用当前 JSON，保留稳定 ID、用户编辑、布局及范围外内容。已知网页有未保存编辑时先处理。不能用旧快照或工具自带空框架覆盖用户内容，也不能把新目录下的空文件当作已有项目的数据基准。

### 两种生成方式

| 项目情况 | 必须采用的方式 |
|---|---|
| 空白项目，通过需求生成框架 | 先使用同级 [brainstorming](../brainstorming/SKILL.md) 技能，通过对话梳理并确认设计，再生成 JSON |
| 已有代码，通过实现生成框架 | 先理解真实关系，再决定分层、模块和位置；内容严格以实际代码为依据 |

空白项目必须经过头脑风暴，不能跳过对话直接凭猜测填写。按本任务只生成框架 JSON 的范围使用 brainstorming：梳理项目目标、功能、分层、模块及内部内容，结论写入 JSON；不另行编写业务代码、规格文件或实现计划，不自动提交 Git。已完成并确认的头脑风暴结论可直接沿用，不重复询问。

已有代码时，从入口、注册和配置开始，沿实际调用、数据流和读写操作追踪到执行与输出位置。区分调用者、实际执行者、数据接收或保存位置，以及可选能力和正常路径。不能根据文件名、同名符号或文档描述猜测实现，也不能把建议、理想行为或间接调用写成现有事实。

### 路径与模板

共享工具位于 **xyf-easycode 根目录**的 tools/，与 subskills/ 同级；该根目录是本文件所在目录的上两级。下面 tools/ 命令从该根目录执行，参数中的相对路径相对于终端当前目录。

| 位置 | 用途 |
|---|---|
| 目标项目 docs/archfiy/archify.json | 项目当前架构数据 |
| 目标项目 docs/archfiy/index.html | 可编辑网页入口 |
| 目标项目 docs/archfiy/html/ | 网页程序、本地服务和模板 |
| [tools/README.md](../../tools/README.md) | 工具部署、同步和检查说明 |
| [tools/archify.json](../../tools/archify.json) | 工具自带空框架，不能代替项目内容 |

默认目录按约定使用 **docs/archfiy/**，JSON 文件名仍为 **archify.json**。用户明确指定的位置或已有项目的实际数据位置优先。旧项目若使用 docs/archify/，继续使用其当前 JSON 和部署位置，不自动迁移；两个目录都有数据且无法确定基准时，先解决冲突。

[model.js](../../tools/html/assets/model.js) 是字段、创建函数、更新函数和校验规则的依据，当前 formatVersion 为 1。完整模板用于理解字段和显示能力，运行骨架用于生成网页。示例不代表项目事实，不使用原版 archify 引擎的数据格式或命令。

| 类型 | 完整指导书 | 运行骨架 |
|---|---|---|
| 项目数据 | [archifytemplate.jsonc](../../tools/html/templates/archifytemplate.jsonc) | [archifytemplate.json](../../tools/html/templates/archifytemplate.json) |
| 画布 | [canvas.template.html](../../tools/html/templates/canvas.template.html) | [canvas.html](../../tools/html/templates/canvas.html) |
| 模块 | [module-node.template.html](../../tools/html/templates/module-node.template.html) | [module-node.html](../../tools/html/templates/module-node.html) |
| 分层 | [group-layer.template.html](../../tools/html/templates/group-layer.template.html) | [group-layer.html](../../tools/html/templates/group-layer.html) |

## 2. 执行

### 先核实，再写入

正式 JSON 中每一项都必须核实清楚、实事求是，不允许包含未核实、待确认、猜测或占位内容。

- 空白项目的依据是头脑风暴中已经确定的需求与设计；已有代码的依据是实际定义、调用、默认值、分支、返回结果和副作用。
- 发现疑点，先继续查源码或与用户讨论；解决前不生成或替换正式 JSON，也不部署不完整框架。不能省略疑点涉及的内容，再宣称框架完整。
- 确认不存在或不适用的内容，才使用模型规定的空数组、空字符串或省略可选字段。不能把没查过写成没有，也不能为填满字段编造内容。
- 模型要求保留的 unknowns 统一为 []。这表示内容已核实；不能通过清空 unknowns 掩盖既有疑点。
- 每个方法的输入输出都必须核对完整，正式 JSON 的 inputsConfirmed、outputsConfirmed 均为 true。确认无输入或无输出时，对应数组才可为空。
- planned 表示已确定、尚待实现的设计，不能含糊；verified 表示与实际源码相符，不代表业务测试通过。modified 是语义修改后的过程状态，交付前须重新核对为 verified，或确认其为待实现设计后使用 planned；不能仅改状态代替核实。

### 划分模块和分层

先把本次范围内的职责、真实关系和边界梳理清楚，再划分模块与分层，最后安排位置。模块按职责划分，不机械地把每个文件或函数建成模块；不预设层数、模块数、方法数或连线数。

源码模式下，不能把不存在的服务、消息机制、数据保存操作或依赖加入框架。分组不能隐藏实际执行者、读写归属或影响行为的条件。每个模块和有向关系都要有实际读取过的源码依据。

### 逐项填写模块

先核对项目名称、说明、代码目录和版本，再逐个模块检查下表。纳入本次范围的模块必须完整梳理，不能只抽取几个代表方法，也不能遗漏模板中不直接显示在画布上的内容。

| 内容 | 必须梳理的事项 |
|---|---|
| 基本信息 | 中文名、英文名、功能、语言、代码位置、所属层级 |
| 功能需求 | 具体功能及成立条件；源码模式说明代码实际完成的行为 |
| 模块参数 | 名称、类型、用途、默认值和必需标记 |
| 数据结构 | 结构名称，以及每个字段的名称、类型和用途 |
| 方法 interfaces | 名称、用途、全部输入输出、必需标记、默认值、处理流程和错误处理 |
| 消息事件 events | 名称、发送或接收方向、用途、消息参数和处理流程 |
| 测试项 tests | 测试步骤和预期结果；不表示测试已执行通过 |
| 来源与状态 | 实际源码位置、符号、核对状态；需求设计不虚构来源 |

源码模式保留实际 englishName，中文名和说明解释用途，不任意翻译或改名。测试项只记录已有测试的实际含义；需求模式记录确定的测试要求。不生成和运行业务测试代码。

sources 记录实际读过的仓库相对路径、从 1 开始的 line，以及必要的 endLine、symbol。codeLocation 单独保存相对代码目录的路径，多处位置用换行分隔。Git 项目记录实际 revision，dirty 按整个仓库判断；修改过、未跟踪或被忽略的来源文件须说明差异或内容哈希，不能仅用提交号证明当前内容。非 Git 项目不编造提交号。

### 建立关系并自上而下布局

1. 先核对模块之间真实的调用、依赖或消息传递，确定方向与含义，再建立 relations。源码关系须有调用、导入、事件接线或实际读写依据；不能把间接调用画成直接读写。
2. 分层统一从上到下排列，同层模块按主要交互顺序摆放；联系紧密的模块靠近，为箭头与文字留出空间。层级含义来自项目，不硬套固定层数。
3. 按模块实际内容估计节点高度，再安排 x、y 和四边连接点。层级包围框由工具计算，不添加模型没有的宽高或路由字段。
4. 真实存在的反向调用、回调和消息关系保留原方向；不能为外观改关系、删必要内容或编造依赖。
5. 新建框架按此布局；维护已有 JSON 时保留范围外位置。只有用户要求调整布局时才重排已有整体画布。

### 校验并保存 JSON

| 检查 | 完成标准 |
|---|---|
| 内容正确性 | 每项符合已经确定的设计或实际源码，状态与依据一致 |
| 内容完整性 | 本次范围内的模块、成员、重要条件和必要关系无遗漏；无疑点或占位内容 |
| 源码双向核对 | 从源码查 JSON 是否遗漏；从 JSON 查每项说明是否有依据 |
| 数据结构 | Model.validate 无 errors；warnings 逐项处理，不填假数据消除提示 |
| 修改范围 | 稳定 ID、用户编辑、范围外字段和关系得到保留 |

使用 globalThis.EasyCode.Model；Node 可通过 import 加载 tools/html/assets/model.js。新项目用 createProject，模块和成员用对应 createModule、createInterface、createParameter、createStructure、createStructureField、createEvent、createTest 创建，再填入真实内容。不能保留创建函数的默认示例文字。

更新已有语义使用 Model.updateModule、updateInterface、updateMember、updateRelation 等函数。对象 ID 全局唯一，改名不换 ID；删除时清理失效引用。方法 flow、errors 和事件 flow 是逐行字符串，参数 defaultValue 保存字符串，不能改变字段类型。

使用 [files.mjs](../../tools/html/scripts/files.mjs) 的 readProjectFile 读取 project、version，再用 writeProjectFile(path, project, {expectedVersion: version}) 保存并读回深度比较。新文件 expectedVersion 为 null；保存到另一目标时先用 fileVersion 记录目标版本。输入或目标变化时先处理冲突，不盲目覆盖或重试。

### 围绕 JSON 部署网页

框架 JSON 完成并通过上述检查后，继续部署网页供用户阅读和修改；用户明确只要 JSON 时按其范围交付。只修改已有 JSON 时不重新部署程序，也不重新生成入口。

需要 Node.js 22+，无 npm 依赖；缺少环境时说明，不擅自安装。从 **xyf-easycode 根目录**执行：

```sh
node tools/html/scripts/deploy.mjs "<目标项目根目录>" --output-dir docs/archfiy --start
```

部署目标参数传项目根目录，--output-dir 为项目内的相对部署目录。旧项目或用户指定其他位置时传入其实际目录；需要输入文件时加 --source-json "<JSON路径>"。部署前检查已有网页定制。[deploy.mjs](../../tools/html/scripts/deploy.mjs) 保留已有目标 JSON，遇到不同输入会停止；不以部署之名修改业务字段、ID 或布局。

默认从 4175 起选择可用端口，同一目标已有服务时复用，以实际输出地址为准。保持服务运行；Windows 后台启动隐藏窗口，不关闭其他项目服务。仅启动已有部署时，从**目标项目根目录**执行：

```sh
node docs/archfiy/html/server.mjs
```

服务网页读取并保存相邻 archify.json，约每 2 秒检查外部修改；有未保存编辑时保留并提示。用户在网页保存后的 JSON 是后续工作的最新基准。

只有网页源码或运行模板修改时，才运行 node tools/html/scripts/build.mjs --runtime 再部署。独立快照用 node tools/html/scripts/build.mjs <JSON路径> <HTML输出路径> 生成，不能覆盖服务入口 index.html。

### 已有 JSON 的指定修改与数据取回

按稳定 ID、所属模块和对象种类定位修改范围；不能因为中文同名而批量修改无关对象。新语义同样必须核实清楚，保留范围外字段、来源与布局。读取已有内容发现疑点时先解决，不清空标记冒充已核实，也不擅自扩大修改范围。

名称翻译仅更新指定 englishName 及相应状态。结合已确定的用途、类型和项目命名习惯处理，检查标识合法性和重名；已有源码标识按代码保留。用户明确要改变已有代码名称时，将确认的新名称作为 planned 设计，不把它标成现有源码事实，也不在本技能中改业务代码。可以使用 [translation.js](../../tools/html/assets/translation.js) 的 formatName 整理格式，该函数不负责语义翻译。

服务入口没有 ec-project 快照，取回数据读取相邻 JSON；若已是当前文件则不重复写入。明确指定独立 HTML 时，使用 [serialization.js](../../tools/html/assets/serialization.js) 的 EasyCode.Serialization.readProject 解析数据块，不执行页面脚本、不从外观猜测内容。提取结果先检查完整性与事实依据，发现疑点先处理；通过后保留字段和 ID，检查目标版本再保存并读回比较，不拿旧快照自动覆盖当前设计。

## 3. 检查与交付

数据修改均做内容核实、模型校验、范围差异检查和保存后读回比较。部署后从**目标项目根目录**运行：

```sh
node docs/archfiy/html/scripts/check.mjs docs/archfiy/index.html
node docs/archfiy/html/scripts/check.mjs --url <实际访问地址>
```

实际部署目录不同则替换命令中的目录。接口返回项目与磁盘 JSON 必须深度一致。独立快照用 check.mjs <HTML路径> <输入JSON路径> 比较。

打开实际 HTTP 地址检查页面：模块、层级和连线显示完整；分层自上而下；节点无重叠；箭头方向和文字清楚；默认视角可读。全部缩进视野不等于看得清楚，数据校验和健康检查不能替代页面检查。布局有问题时调整本次范围内的位置和连接点，不通过删减内容掩盖问题。

需要验证保存、外部更新、未保存冲突或服务恢复时使用独立临时项目，不向正式框架加入测试数据。检查失败先处理，不能用旧产物当新结果。

用简短表格交付 JSON 路径、网页地址、生成依据、完整覆盖的范围、实际修改和执行的检查；部署时说明启动与停止方法。源码模式附真实版本及必要的工作区差异。数据校验、源码核对、服务和页面检查分别报告，未做的检查不写成通过。关键内容无法核实则说明具体阻碍，保留原文件，不交付不完整 JSON。