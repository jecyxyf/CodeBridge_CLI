# EasyCode Archify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可离线打开、编辑模块和接口、分组连线并覆盖保存的单文件 HTML，以及生成它的独立技能包。

**Architecture:** 使用独立画布模板与节点模板，DOM 显示节点、SVG 显示关系。浏览器脚本通过 `globalThis.EasyCode` 共享明确接口，项目数据为唯一内容来源。Node 标准库脚本仅供 Agent 组装与验证，生成的网页不依赖 Node、Python、服务器或外部资源。

**Tech Stack:** HTML、CSS、原生 JavaScript、SVG、File System Access API；开发端 Node 24 标准库和桌面 Chromium 浏览器。

## Global Constraints

- 最终交付一个自带样式、脚本和项目数据的 HTML，使用时无需安装 Python、Node.js，无需启动服务或联网。
- 网页的大模板与模块节点的小模板独立维护。
- 默认覆盖当前文件，另存为才产生副本，不自动生成版本副本。
- 模块文档模板和一键更新按钮留到后续阶段。
- 分组先做一层；一个模块最多属于一个组，也可以不分组。
- 模块之间先用带方向的连线表示调用或依赖，不做接口插口之间的连线。
- 节点内部按区块展开详情，使用同一份节点模板；不强制跳到另一个页面。
- 一个项目对应一个可编辑 HTML；编辑的数据内嵌在 HTML 中，不要求用户维护额外 JSON 文件。
- 本阶段不修改已引入的 `easycode/subskills/archify/` 引擎，不删除其已有文件。
- 所有实现位于 `easycode/subskills/easycode-archify/`；设计和本计划记录进度；`.superpowers/` 仅存放忽略的执行记录。

---

## 执行依据与状态

用户已确认设计，并在 2026-10-23 指示“先提交并推送，然后开始执行”。基线 `cba7f8e` 已推送到 `origin/0.0.1/easy-code`。当前目录已经是该分支的独立 worktree，沿用当前目录。按上述直接执行授权，在本会话完成任务和审查，不再重复询问是否继续。

设计：`docs/superpowers/specs/2026-10-23-easycode-archify-design.md`。

## 视觉方案

这是桌面模块编辑器，画布占据页面主体。保留紧凑工具栏，模块卡片是主要视觉对象，不增加落地页、宣传区或无关统计卡。

| 色彩 | 值 | 用途 |
|---|---|---|
| 画布蓝灰 | `#151c28` | 工作区 |
| 卡片蓝灰 | `#202a39` | 节点与工具栏 |
| 边界 | `#3c4b60` | 网格与控件边框 |
| 正文 | `#e8eef5` | 主文字 |
| 操作蓝 | `#81b3e9` | 选择、焦点、主要操作 |
| 层级青 | `#6da89a` | 分组标识 |

采用本机 `Segoe UI / Microsoft YaHei / sans-serif`。代码签名使用本机等宽字体，其余文字不等宽。节点标题 16–18px，正文 13–14px；左对齐。不同分层可以使用克制的附加区分色。焦点清楚，动作无无意义动画。

```text
┌ 名称／用途 ───────── 添加模块  创建分组 ─ 保存  另存为 ┐
│ ┌ 界面层 ──────┐   ┌ 业务层 ──────┐   ┌ 数据层 ───┐ │
│ │ 模块         │──→│ 模块         │──→│ 模块      │ │
│ │ 职责         │   │ 职责         │   │ 职责      │ │
│ │ 接口列表     │   │ 接口列表     │   │ 接口列表  │ │
│ │ 展开后原位编辑│   │              │   │           │ │
│ └──────────────┘   └──────────────┘   └───────────┘ │
└ 缩小／比例／放大／适应视野 ─── 操作提示与保存状态 ─────┘
```

对照需求的取舍：强调模块与层级，去掉传统仪表盘侧栏和介绍区；节点说明原位展开，避免把 API 手册藏在另一个页面。

## 文件结构与统一接口

所有下列相对路径均基于 `easycode/subskills/easycode-archify/`。

```text
SKILL.md
templates/canvas.html
templates/module-node.html
assets/model.js
assets/serialization.js
assets/storage.js
assets/feedback.js
assets/nodes.js
assets/canvas.js
assets/dialogs.js
assets/app.js
assets/editor.css
scripts/build.mjs
scripts/check.mjs
examples/task-board.json
examples/task-board.html
references/project-data.md
references/repository-analysis.md
tests/model.test.mjs
tests/serialization.test.mjs
tests/storage.test.mjs
tests/feedback.test.mjs
tests/browser.test.mjs
tests/helpers/cdp.mjs
```

运行脚本使用 IIFE 注册到 `globalThis.EasyCode`；不使用动态代码求值、网络导入或浏览器中的外部模块。Node 测试导入脚本后访问同一命名空间，不复制生产逻辑。

数据格式固定如下。标识由创建函数生成，`status` 使用 `planned / verified / modified`，`mode` 使用 `design / change / analysis`，关系 type 使用 `call / dependency`，未分组 groupId 为空字符串。源码出处对象为 `{path, line?, endLine?, symbol?}`。所有模块与接口的 `sources`、`unknowns` 都是数组；verified 必须至少有一个合法出处，缺失属于 error。参数为 `{id,name,type,required,description}`，输出同形但忽略 required。

```js
const project = {
  formatVersion: 1,
  id: 'project-task-board', name: '任务看板', description: '模块方案示例', mode: 'design',
  repository: { path: '', revision: '', dirty: false },
  groups: [{id:'group-ui',name:'界面层',color:'#81b3e9',x:80,y:100}],
  modules: [{id:'module-board',name:'看板界面',purpose:'展示并编辑任务',groupId:'group-ui',
    x:110,y:150,status:'planned',sources:[],unknowns:[],interfaces:[
      {id:'interface-create',name:'createTask(input)',purpose:'创建任务',status:'planned',sources:[],unknowns:[],
       inputsConfirmed:true,outputsConfirmed:false,
       inputs:[{id:'param-title',name:'title',type:'string',required:true,description:'任务标题'}],outputs:[]}
    ]}],
  relations: [],
  view: {x:0,y:0,scale:1,expanded:[],expandedInterfaces:[]}
};
```

公共 API：

- `EasyCode.Model.createProject(name)`、`createModule(options)`、`createInterface()`、`createParameter()` 生成完整默认数据。
- `Model.validate(project)` 返回 `{errors:[{path,message}],warnings:[{path,message}]}`；缺描述是 warning，结构损坏是 error。检查所有引用、ID、数值、枚举、数组和来源字段，不能因坏输入崩溃。
- `Model.markEdited(item)` 只把 verified 改为 modified。
- `Model.updateModule(project,id,patch)`、`updateInterface(project,moduleId,interfaceId,patch)`、`removeModule(project,id)`、`removeGroup(project,id)`、`addRelation(project,options)` 负责语义变更和关联维护。
- `EasyCode.Serialization.buildDocument(bundle,project)` 与 `readProject(html)` 完成往返。
- `bundle={canvas,node,css,runtime}`；画布模板槽位为 `<!--EC:TITLE-->`、`<!--EC:STYLE-->`、`<!--EC:NODE-->`、`<!--EC:DATA-->`、`<!--EC:BUNDLE-->`、`<!--EC:RUNTIME-->`。一次替换，避免对用户文字再次处理。
- HTML 的项目数据放在 `script#ec-project[type=application/json]`；不可变 bundle 放在 `script#ec-bundle[type=application/json]`；模块模板为 `template#ec-module-template`。bundle 保存原始模板/代码字符串，重存不能递归嵌套导致文件不断膨胀。
- `EasyCode.Storage.createController({getProject,buildDocument,readProject,validate,pickExisting,pickNew,onState})` 返回 `{save(),saveAs(),markDirty(),isDirty(),getFileName()}`，返回的保存方法为 Promise。
- `EasyCode.Nodes.create({project,layer,template,onChange,onSelect,onRelation,confirm})` 返回 `{render(),getElement(id),destroy()}`。
- `EasyCode.Canvas.create({project,viewport,world,groupLayer,edgeLayer,nodes,onChange,onGroupEdit,onRelationEdit})` 返回 `{refresh(),fit(),zoomBy(factor),centerPoint(),destroy()}`。
- `EasyCode.Dialogs.create({project,onChange})` 返回 `editGroup(id?)`、`editRelation(id?,fromId?)`、`editProject()`；使用原生 dialog，回车提交、Escape 取消。
- 入口 `app.js` 读取内嵌 JSON，初始化组件、连接 toolbar、处理 dirty 状态与 beforeunload。

## Task 1: 项目模型、组装和可验证数据

**Files:** Create `assets/model.js`, `assets/serialization.js`, `scripts/build.mjs`, `scripts/check.mjs`, `examples/task-board.json`, `tests/model.test.mjs`, `tests/serialization.test.mjs`。

**Interfaces:** 实现上述 Model 和 Serialization API；组装命令为 `node scripts/build.mjs <project.json> <output.html>`。默认依次合并 model、serialization、storage、feedback、nodes、canvas、dialogs、app 脚本；也导出 `assemble(project, bundle)` 供测试提供小型 bundle。Task 3 才提供真实 UI 模板，之前用测试内的最小真实模板测试序列化。

- [x] **Step 1: 写会失败的行为测试。** 至少包含以下完整场景，并补齐非法结构、关系、重命名、核对状态、无参数与待确认的区别。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/serialization.js';
const {Model,Serialization}=globalThis.EasyCode;
test('删除模块清除关系但保留其他模块',()=>{
 const p=Model.createProject('test');
 const a=Model.createModule({name:'A'}), b=Model.createModule({name:'B'});
 p.modules.push(a,b); Model.addRelation(p,{from:a.id,to:b.id,type:'call',label:'调用'});
 Model.removeModule(p,a.id);
 assert.equal(p.modules.length,1); assert.equal(p.modules[0].id,b.id); assert.equal(p.relations.length,0);
});
test('改接口内容使接口和模块待核对，位置变化不改变核对状态',()=>{
 const p=Model.createProject('test'), m=Model.createModule({name:'A'}), i=Model.createInterface();
 m.status='verified'; i.status='verified'; m.interfaces.push(i); p.modules.push(m);
 Model.updateModule(p,m.id,{x:80}); assert.equal(m.status,'verified');
 Model.updateInterface(p,m.id,i.id,{purpose:'新行为'});
 assert.equal(m.status,'modified'); assert.equal(i.status,'modified');
});
test('恶意 HTML 是文本且多次保存不增长',()=>{
 const p=Model.createProject('</script><script>alert(1)</script>');
 const bundle={canvas:'<!doctype html><title><!--EC:TITLE--></title><!--EC:STYLE--><!--EC:NODE--><!--EC:DATA--><!--EC:BUNDLE--><!--EC:RUNTIME-->',node:'<template id="ec-module-template"></template>',css:'',runtime:''};
 const a=Serialization.buildDocument(bundle,p);
 assert.deepEqual(Serialization.readProject(a),p);
 assert.equal(Serialization.buildDocument(bundle,Serialization.readProject(a)),a);
 assert.ok(!a.includes('<script>alert(1)</script>'));
});
```

- [x] **Step 2: 运行 RED。** `node --test tests/model.test.mjs tests/serialization.test.mjs`，实现前预期因模块/API 缺失失败，记录输出。
- [x] **Step 3: 实现模型和序列化。** 使用稳定 ID、已声明枚举，删除 group 只清空成员 groupId，删除 module 清掉关联的 relations 和展开状态。验证草稿与错误分级。JSON 序列化转义 `< > & U+2028 U+2029`，标题 HTML 转义；readProject 只接受唯一的指定数据块和合法数据版本。实现时以这个安全基本函数为准：

```js
function safeJSON(value){
 return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
  c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
```

组装器使用 Node 标准库读写模板与输出；目标文件存在时按请求的同一路径覆盖。检查脚本解析 HTML 数据、验证结构并输出 errors/warnings，错误时非零退出。示例用“任务看板”六个模块、界面/业务/数据三组，声明为设计示例，禁止假装真实代码分析。
- [x] **Step 4: 运行 GREEN。** 上述两套测试全部通过；损坏数据返回具体路径而不是未捕获异常。
- [x] **Step 5: 自查并提交。** 仅提交本任务文件，报告 RED/GREEN、API 及 commit。

## Task 2: 覆盖保存与另存为

**Files:** Create `assets/storage.js`, `tests/storage.test.mjs`。

**Interfaces:** 使用 Task 1 的 Serialization/Model，经依赖参数注入文件选择器。`pickExisting()` 返回一个文件句柄，`pickNew(suggestedName)` 返回新句柄。句柄提供 `getFile()` 和 `createWritable()`；文件支持 `text()`，写入流支持 `write/close/abort`。`onState` 接收 `{status,message,fileName,dirty}`，status 为 unsaved/saving/saved/error。

- [x] **Step 1: 写失败测试。** 使用真实内存文件内容的句柄替身，断言最终字节内容而非仅断言函数被调用；测试中保留旧文件、新文件、取消、读回失败、外部修改和编辑中保存。

```js
function memoryHandle(name,initial){
 let content=initial;
 return {name,get content(){return content;},externalWrite(value){content=value;},
  async getFile(){return {text:async()=>content};},
  async createWritable(){let draft=content;return {
   async write(value){draft=value;},async close(){content=draft;},async abort(){}
  };}
 };
}
```

核心测试顺序：bind 原文件 → 修改名称 → save → readProject 验证原文件变化 → saveAs → 修改名称 → save → 验证旧文件保持 saveAs 前内容、新文件包含最新名称。AbortError 保留 dirty 和旧 handle。第一次绑定要求文件 project.id 与当前 id 相同，还要比较目标内嵌数据与页面最初基线，避免文件在网页打开后已被 Agent 改写。
- [x] **Step 2: 运行 RED。** `node --test tests/storage.test.mjs`，预期 API 未实现失败。
- [x] **Step 3: 实现保存控制器。** 文件选择器必须直接在点击调用栈触发，不能排队/await 丢失用户手势。保存开始立即取不可变数据快照和编辑计数。写入操作串行；保存中二次点击返回现有 Promise 或明确排队后只取最新快照，不并行写磁盘。已绑定目标的原始内容与上次成功内容不同时拒绝覆盖。写入并 close、读回项目数据一致之后才清理对应快照的 dirty。期间有新编辑时仍为 unsaved。取消/异常不清空模型，不错误切换 handle；saveAs 成功后才切换目标。若 close 成功但读回失败，明确说明文件可能已写入并保持未确认状态，不假报已保存。

```js
// 保存状态清理必须比较本次快照与当前编辑序号。
const snapshotVersion=editVersion;
const snapshot=structuredClone(getProject());
const html=buildDocument(snapshot);
const writable=await handle.createWritable();
await writable.write(html); await writable.close();
const readBack=await (await handle.getFile()).text();
if(JSON.stringify(readProject(readBack))!==JSON.stringify(snapshot)) throw Error('保存后核对失败');
savedVersion=snapshotVersion;
// isDirty() 等价于 editVersion !== savedVersion；较新编辑不能被旧保存清掉。
```

- [x] **Step 4: 运行 GREEN。** `node --test tests/storage.test.mjs`，验证覆盖、另存、取消、异常、并发与外部修改。
- [x] **Step 5: 自查并提交。** 报告真实行为覆盖和所有测试结果。

## Task 3: 两层模板与完整画布交互

**Files:** Create `templates/canvas.html`, `templates/module-node.html`, `assets/editor.css`, `assets/nodes.js`, `assets/canvas.js`, `assets/dialogs.js`, `assets/app.js`, generated `examples/task-board.html`。

**Interfaces:** 使用统一接口中的 Nodes/Canvas/Dialogs/Storage；模型数据直接共享，onChange({semantic?:boolean,render?:boolean}) 由 app 连接更新 UI 与 dirty。组件无需让 UI 文本暴露数据字段名。相关 DOM id 由大模板声明：ec-viewport、ec-world、ec-groups、ec-edges、ec-nodes、ec-status、ec-project-name、ec-file-name、ec-zoom。按钮使用 data-action 标识。小模板必须存在并通过 template.content.cloneNode(true) 生成每个模块。

- [x] **Step 1: 基于视觉方案建立大模板、节点模板与 CSS。** 大模板包含 viewport/world/SVG/group/node 分层、顶部工具栏、底部缩放与状态、用于编辑的 dialog 容器。模板槽位必须与 Serialization 一致；小模板是实际使用的独立模板文件。所有用户数据通过 textContent/value 赋值，不拼进 innerHTML。对外接口编辑位于节点内部。

```html
<template id="ec-module-template">
 <article class="module-node" tabindex="0">
  <header class="module-header"><h2 class="module-name"></h2><button type="button" data-node-action="toggle" aria-label="展开模块">⌄</button></header>
  <p class="module-purpose"></p><div class="module-summary"></div>
  <div class="module-details" hidden></div><footer class="module-footer"></footer>
 </article>
</template>
```

模板可补充真实产品需要的状态标识和按钮；必须保留上面用于职责分工的结构，不以该最小片段限制可用性。
- [x] **Step 2: 实现节点编辑。** 概况含名称/职责/group select；接口列表可添加删除并逐项展开；输入和输出分别编辑确认状态与参数行。未知状态不能显示为无参数。包含代码出处编辑与未确认事项文本。语义编辑调用 Model 的更新接口并传播待核对状态；视图展开和位置只标记文件有变化。编辑时不重建当前正在输入的控件，避免焦点和光标丢失。删除模块明确列出关联关系数量并确认。
- [x] **Step 3: 实现画布与对话框。** 节点绝对定位，world transform 使用 translate/scale。指针拖动坐标除以 scale。pan 仅来自空白或明确手势，交互控件不冒泡触发拖动。缩放固定指针处世界坐标：

```js
const worldX=(pointerX-view.x)/view.scale;
const worldY=(pointerY-view.y)/view.scale;
view.scale=Math.min(1.8,Math.max(0.25,nextScale));
view.x=pointerX-worldX*view.scale;
view.y=pointerY-worldY*view.scale;
```

分组边框按成员实际尺寸计算，空组有可见占位尺寸；组头拖动移动全部成员；组编辑可命名和解散。SVG 使用实际 node bounds 画有向路径与标签，透明加粗 hit path 使关系可选；不要为每次 pointermove 重建所有输入 DOM。适应视野计算所有节点和组范围留出空间。关系编辑支持调用/依赖、目标、说明，支持创建、编辑、删除。
- [x] **Step 4: 连接入口与保存。** 解析内嵌 JSON、实例化组件，实际文件选择器包装为 showOpenFilePicker/showSaveFilePicker；按钮点击直接触发选择器。项目名称和用途可编辑。Ctrl/Cmd+S 保存；Ctrl/Cmd+Shift+S 另存为。beforeunload 仅在 dirty 时提醒。开始就检测本地文件写入 API；不支持时清楚显示原因。所有错误以可见的短文本反馈，不能只输出 console。
- [ ] **Step 5: 生成示例并验证。** 运行 `node scripts/build.mjs examples/task-board.json examples/task-board.html`、`node scripts/check.mjs examples/task-board.html`、`node --test tests/model.test.mjs tests/serialization.test.mjs tests/storage.test.mjs`。本轮前三项命令已通过；真实浏览器打开和交互检查因安全限制未执行，保留此项未完成。
- [x] **Step 6: 自查并提交。** 报告模板实际使用、数据绑定、保存接线和已测内容。

## Task 4: 技能入口、浏览器验收与交付

执行环境限制：Browser Use 在本轮明确拒绝了本地 file:// 打开，并禁止改用 CDP、其他工具或间接方式绕过。此后不自动执行本地页面浏览器操作；浏览器测试代码可以供用户在自己的环境运行，但本轮只做其语法检查，报告中将这部分及截图/原生授权操作标为未实测。代码与其余自动测试继续完成，不能把跳过的浏览器测试记为通过。

**Files:** Modify `SKILL.md`; Create `references/project-data.md`, `references/repository-analysis.md`, `tests/helpers/cdp.mjs`, `tests/browser.test.mjs`; update generated example only when needed for fixes。

**Interfaces:** 浏览器测试直接启动本机 Chromium 进行隔离测试，使用 Node 标准库 WebSocket/CDP；所有启动进程隐藏，不操纵用户既有浏览器。优先通过 remote-debugging-pipe 或随机调试端口，不依赖服务器。也可使用当前环境已有的可靠浏览器工具完成可复查的交互。

- [x] **Step 1: 完善技能说明与数据参考。** SKILL.md 的 description 准确描述可编辑模块画布和三种场景。正文说明读数据规则、读代码依据、生成命令、检查命令、更新现有 HTML 时保留用户内容；将详细字段放 project-data.md，实际代码核对规则放 repository-analysis.md。网页不是代码分析器，Agent 负责源代码核对。不得把示例标记为真实代码。文档生成仍在范围之外。
- [ ] **Step 2: 浏览器行为测试。** 测试从 file:// 打开，阻止所有 HTTP(S) 请求并收集 console/page 异常。通过真实 DOM 交互验证添加和编辑模块、接口、参数、来源状态、分组、连线、缩放和拖动。对下载包往返进行真实 HTML 重开验证。序列化后包含用户文本但没有可执行注入。

```js
// 浏览器验收的断言对象是最终界面和保存数据，而不是单纯点击是否成功。
assert.equal(result.httpRequests,0);
assert.deepEqual(result.pageErrors,[]);
assert.equal(result.restoredModuleName,'修改后的任务模块');
assert.equal(result.restoredInputName,'title');
assert.equal(result.dragMovedNode,true);
assert.equal(result.groupMovePreservedOffsets,true);
```

- [ ] **Step 3: 保存验证。** 单元测试覆盖控制器完整行为；真实浏览器确认 file:// 下 API 存在、保存接线可调用。实际可见文件选择、授权、覆盖与另存为尽可能完成实测；模拟句柄只能标为模拟，不能冒充系统文件选择器测试。无法自动操作系统弹窗时明确记录未测项，但完成其他全部可验证行为。
- [ ] **Step 4: 查看截图。** 截取默认画布和展开接口的页面，检查文字、连线、分组、工具栏与滚动；必要时修正后重新验证相关行为。交付截图保存到被忽略的执行目录，不增加产品依赖。
- [x] **Step 5: 真实源码小例子。** 以本技能的 model/serialization/build 代码做一个小范围分析，验证技能规则能记录准确来源；生成到忽略目录，保留主示例为设计模式。检查所引函数与调用位置，未读到的关系不得补造。
- [x] **Step 6: 最终检查与提交。** 运行全部 `node --test tests/*.test.mjs`、check 脚本、技能 frontmatter 验证和 `git diff --check`。记录通过的检查和未能实测的边界。提交实现，按用户本轮提交推送的授权更新当前远端分支，不改其他分支、不创建 PR、不合并。

## 自查与执行记录

计划覆盖设计的所有第一阶段要求。推迟的文档生成不出现在界面中。保存单元测试与真实浏览器文件授权分开记录，不能互相替代。任务完成后更新下面的复选状态及 `.superpowers/sdd/progress.md`，防止重复执行。

- [x] Task 1：模型、组装与数据测试（004ecb8，独立审查通过）
- [x] Task 2：覆盖保存与另存为（32f7e66，独立审查通过）
- [x] Task 3：两层模板与完整编辑器（8b83d8a，静态审查通过；浏览器实测受限）
- [x] Task 4：技能与自动检查、验证脚本（b54c7bd，静态审查通过）
- [ ] 用户本地浏览器试用：实际布局、交互、原生文件选择与覆盖保存（工具安全策略限制，未实测）

### 最终执行结果（2026-10-23）

| 项目 | 结果 |
|---|---|
| 实现 | 独立大画布、小节点模板；模块、接口、参数、分组和关系编辑；覆盖保存与另存为 |
| 最终修复 | `98bc7db` 修正状态标签、草稿缺项提示、关系删除确认和首次适配状态，完善技能与源码快照说明 |
| 独立复核 | 六项问题均关闭；未发现新增问题。代码可交付初版，浏览器完整验收仍待完成 |
| 自动检查 | 最终代码 42 项通过、0 失败、1 项浏览器跳过；16 个 JavaScript 文件语法检查通过 |
| HTML | 示例结构检查无错误或警告；数据回读一致、重复组装字节一致、无外部脚本或样式依赖 |
| 技能与源码分析 | 技能元数据验证通过；本包源码分析及独立三模块样例均记录实际出处，未把推断冒充事实 |
| 交付 | `easycode/subskills/easycode-archify/examples/task-board.html`；首次保存选择原 HTML，之后覆盖该文件 |
| 后续范围 | 模块 Markdown 文档模板及一键更新按钮按约定留到下一阶段 |

本轮浏览器安全审批拒绝本地 `file://` 导航；未绕行执行。真实页面布局、交互、截图、文件选择、授权、覆盖、另存为和重新打开均不能记作本轮实测通过。保存控制器检查使用内存文件句柄，不代表原生弹窗验收。
