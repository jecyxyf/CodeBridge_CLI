// 架构数据完整模板：指导书，列出 model.js 支持的全部持久化字段及其含义。
// 同目录的 archifytemplate.js 是最小运行骨架，填充实际项目内容后保存为 archify.js。
// 本文件含说明和演示数据，不是当前项目，不由生成器读取，也不替换 tools/archify.js。
// 正式文件只允许固定赋值包装和严格 JSON 对象，不含注释、函数或其他语句。本指导书的注释不复制到正式文件。
// 新项目与新对象须生成新 ID；更新名称时保持原 ID。ID 须以字母开头，之后只含字母、数字、_、-。
// 所有对象 ID 在一个项目内唯一；数组无内容时使用 []，不要保留不属于项目的演示对象。
// 必填表示模型校验或运行所需；可选字段没有实际内容时可省略或使用所示空值。
window.ARCHIFY_DATA = {
  "formatVersion": 1, // 必填：数据格式版本，当前固定为 1，与代码版本不同。
  "id": "project-guide", // 必填：项目唯一标识；此值仅为指导书示例。
  "name": "任务管理项目", // 中文项目名，最终网页主要显示中文名称。
  "englishName": "task-board", // 英文项目名；模型可选，项目约定保留中英文名称。
  "description": "管理任务的创建、保存与展示。", // 项目功能说明，按实际项目填写。
  "repository": { // 必填：项目代码的位置和版本信息。
    "path": "", // 必填字符串：代码目录；未配置时为空，不编造本机绝对路径。
    "revision": "", // 必填字符串：代码版本或提交号；填写 0.0.1 时标题显示 v0.0.1。
    "dirty": false // 必填布尔值：源码工作区是否有未提交变化，源码分析时按实际状态填写。
  },
  "groups": [ // 必填数组：分层；项目没有分层时使用 []。
    {
      "id": "group-guide", // 必填：层级唯一标识，由模块 groupId 引用。
      "name": "功能层", // 层级中文名，显示在层级标题中。
      "englishName": "FeatureLayer", // 层级英文名，保存在配置和数据中。
      "color": "#ffffff", // 必填字符串：标题与三个点按钮的前景色，建议 #rrggbb 格式。
      "backgroundColor": "#81b3e9", // 可选：层级背景色，须为 #rrggbb；显示透明度固定为 50%。
      "x": 80, // 必填有限数值：空层级的横坐标，单位为画布像素。
      "y": 80 // 必填有限数值：空层级的纵坐标；有成员时包围框按成员位置计算。
    }
  ],
  "modules": [ // 必填数组：模块；运行骨架初始使用 []，按实际设计添加。
    {
      "id": "module-guide-board", // 必填：模块唯一标识，供关系和所属对象引用。
      "name": "任务界面", // 模块中文名，显示在节点大标题中。
      "englishName": "TaskBoard", // 模块英文名。
      "purpose": "展示任务，并提供保存入口。", // 模块功能说明，不使用待确认方案代替执行内容。
      "language": "TypeScript", // 可选：编程语言；空字符串时标题栏不显示语言文字。
      "codeLocation": "./src/task-board.ts", // 可选：相对 repository.path 的代码位置，多处位置用 \n 分隔。
      "groupId": "group-guide", // 必填字符串：所属层级 ID；无层级时为 ""，不可引用不存在的层级。
      "x": 120, // 必填有限数值：节点横坐标，单位为画布像素。
      "y": 140, // 必填有限数值：节点纵坐标。
      "appearance": { // 可选：模块外观；使用时三项颜色须齐全，均为 #rrggbb。
        "textColor": "#17254d", // 字体颜色，模块图标通常遵循字体颜色，局部类型标记由样式控制。
        "backgroundColor": "#fcfdff", // 模块正文背景颜色。
        "headerColor": "#f4f7ff" // 模块标题栏背景颜色。
      },
      "status": "planned", // 必填：planned 尚未核对；verified 已有源码依据；modified 已核对内容发生语义修改。
      "sources": [ // 必填数组：源码出处；无已读取的实际源码时使用 []。以下仅演示来源对象字段。
        {
          "path": "src/task-board.ts", // 必填非空字符串：仓库相对路径，不是模块的显示代码位置。
          "line": 1, // 可选正整数：起始行，从 1 开始。
          "endLine": 20, // 可选正整数：结束行；填写时须有 line，且不早于 line。
          "symbol": "TaskBoard" // 可选字符串：类、函数或其他代码符号。
        }
      ],
      "unknowns": [], // 必填数组：模型保留的未核实内容列表，元素为字符串；执行方案保持明确，不添加待确认事项。
      "requirements": [ // 可选字符串数组：具体功能需求，一项对应编辑界面中的一行。
        "展示当前任务的中文标题。",
        "保存任务前检查标题不能为空。"
      ],
      "parameters": [ // 可选数组：模块参数；参数对象的完整字段如下。
        {
          "id": "param-guide-title", // 必填：参数唯一标识。
          "name": "任务标题", // 参数中文名。
          "englishName": "taskTitle", // 参数英文名，通常采用 lowerCamelCase。
          "type": "string", // 变量类型，按实际语言填写；列表可只显示类型的前三个字母。
          "description": "保存任务的显示标题。", // 参数用途说明。
          "required": false, // 可选布尔值：是否必须提供；方法输入参数中此字段必填。
          "defaultValue": "" // 可选字符串：默认值的文字形式；数字 0 也写作 "0"，无默认值时为 ""。
        }
      ],
      "structures": [ // 可选数组：数据结构定义。
        {
          "id": "structure-guide-task", // 必填：数据结构唯一标识。
          "name": "任务数据", // 数据结构中文名。
          "englishName": "TaskData", // 数据结构英文名，通常采用 PascalCase。
          "fields": [ // 必填数组：结构字段；每行定义一个字段。
            {
              "id": "field-guide-task-id", // 必填：字段唯一标识。
              "name": "任务编号", // 字段中文名。
              "englishName": "taskId", // 字段英文名。
              "type": "string", // 字段变量类型。
              "description": "用于唯一定位一条任务。" // 字段作用；当前结构字段不支持 defaultValue 和 required。
            }
          ]
        }
      ],
      "interfaces": [ // 必填数组：方法；字段名沿用 interfaces，不改写成 methods。
        {
          "id": "interface-guide-save", // 必填：方法唯一标识。
          "name": "保存任务", // 方法中文名。
          "englishName": "saveTask", // 方法英文名，通常采用 lowerCamelCase。
          "purpose": "检查并保存当前任务。", // 方法用途说明。
          "flow": "检查任务标题\n保存任务数据\n返回保存结果", // 可选字符串：实现流程；多行用 \n，不改为数组。
          "errors": "标题为空时返回校验错误\n保存失败时记录原因并返回失败结果", // 可选字符串：错误处理；每条一行，用 \n 分隔。
          "status": "planned", // 必填：源码核对状态，枚举与模块 status 相同。
          "sources": [], // 必填数组：方法的真实源码出处；元素字段同模块 sources。
          "unknowns": [], // 必填字符串数组：保留的未核实内容，无内容时为 []。
          "inputsConfirmed": false, // 必填布尔值：输入是否已经核实；false 不代表没有输入。
          "outputsConfirmed": false, // 必填布尔值：输出是否已经核实；true 且空数组才可表示确认无输出。
          "inputs": [ // 必填数组：输入参数；无输入时为 []，并如实设置 inputsConfirmed。
            {
              "id": "param-guide-save-title", // 必填：输入参数唯一标识。
              "name": "任务标题", // 输入参数中文名。
              "englishName": "taskTitle", // 输入参数英文名。
              "type": "string", // 输入参数类型。
              "description": "需要保存的任务标题。", // 输入参数用途。
              "required": true, // 必填布尔值：调用方是否必须传入该参数。
              "defaultValue": "" // 可选字符串：输入默认值的文字形式；无默认值时为空。
            }
          ],
          "outputs": [ // 必填数组：输出参数或返回值；多个返回项逐项列出。
            {
              "id": "param-guide-save-result", // 必填：输出项唯一标识。
              "name": "保存结果", // 输出项中文名。
              "englishName": "saveResult", // 输出项英文名。
              "type": "boolean", // 返回值或输出参数的类型。
              "description": "表示任务是否保存成功。", // 输出用途说明。
              "required": false, // 可选布尔值：沿用参数对象标记，不用于表达是否存在返回值。
              "defaultValue": "false" // 可选字符串：默认返回值的文字形式。
            }
          ]
        }
      ],
      "events": [ // 可选数组：消息事件。
        {
          "id": "event-guide-saved", // 必填：事件唯一标识。
          "name": "任务已保存", // 事件中文名。
          "englishName": "taskSaved", // 事件英文名，通常采用 lowerCamelCase。
          "description": "通知其他模块更新任务内容。", // 事件用途；使用 description 字段，不使用 purpose。
          "direction": "emit", // 必填：事件类型；emit 表示发送消息，receive 表示接受消息。
          "flow": "整理消息参数\n发送任务已保存消息", // 可选字符串：实现流程，默认空；界面逐行增删，多行用 \n，不改为数组。
          "trigger": "", // 必填字符串：内部保留字段，事件编辑界面已移除此项，新内容保持空字符串。
          "parameters": [ // 必填数组：随消息发送或接收的参数。
            {
              "id": "param-guide-saved-id", // 必填：消息参数唯一标识。
              "name": "任务编号", // 消息参数中文名。
              "englishName": "taskId", // 消息参数英文名。
              "type": "string", // 消息参数类型。
              "description": "指出哪一条任务已经保存。", // 消息参数用途。
              "required": false, // 可选布尔值：参数对象保留的必需标记。
              "defaultValue": "" // 可选字符串：默认值的文字形式。
            }
          ]
        }
      ],
      "tests": [ // 可选数组：模块测试要求，每个测试项可在编辑界面单独维护。
        {
          "id": "test-guide-save", // 必填：测试项唯一标识。
          "name": "保存有效任务", // 测试项中文名。
          "englishName": "saveValidTask", // 测试项英文名。
          "steps": "填写任务标题\n执行保存任务方法", // 执行步骤，字符串，可用 \n 分行。
          "expected": "保存成功并发出任务已保存消息。" // 预期结果，不表示测试已经执行通过。
        }
      ]
    },
    { // 第二个模块只用于演示跨模块连线，字段含义与上面的模块相同。
      "id": "module-guide-storage", // 必填：第二个模块唯一标识，不能与其他对象重复。
      "name": "任务存储", // 中文名。
      "englishName": "TaskStorage", // 英文名。
      "purpose": "持久化任务数据。", // 模块功能。
      "groupId": "", // 必填：无所属层级。
      "x": 760, // 必填：横坐标。
      "y": 140, // 必填：纵坐标。
      "status": "planned", // 必填：尚未核对源码。
      "sources": [], // 必填：没有实际核对来源时为空。
      "unknowns": [], // 必填：没有保留的未核实内容时为空。
      "interfaces": [] // 必填：此示例不列出方法。其他可选字段参照第一个完整模块填写。
    }
  ],
  "relations": [ // 必填数组：模块间的有向箭头；没有关系时为 []。
    {
      "id": "relation-guide-save", // 必填：关系唯一标识。
      "from": "module-guide-board", // 必填：起点模块 ID，须存在。
      "to": "module-guide-storage", // 必填：终点模块 ID，须存在且不能与起点相同。
      "label": "保存任务", // 可选字符串：箭头旁的中文文字。
      "fromPort": "right", // 可选：起点连接点，top / right / bottom / left。
      "toPort": "left", // 可选：终点连接点，枚举同 fromPort。
      "type": "call", // 可选保留元数据：call / dependency；当前新增箭头不设置分类，实际新关系可省略此字段。
      "status": "planned", // 必填：该关系的源码核对状态；有来源才能标记 verified。
      "sources": [], // 必填数组：能证明调用或依赖的实际源码位置，元素字段同模块 sources。
      "unknowns": [] // 必填字符串数组：无保留的未核实内容时为空。
    }
  ],
  "view": { // 必填：保存画布视图；不影响模块的业务含义。
    "x": 0, // 必填有限数值：横向平移量，单位为屏幕像素。
    "y": 0, // 必填有限数值：纵向平移量。
    "scale": 1, // 必填有限数值：缩放比例，必须大于 0；1 为 100%，界面最小缩放为 0.01（1%）。
    "expanded": [], // 必填数组：保留的模块展开状态，仅可引用真实模块 ID，不得重复。
    "expandedInterfaces": [] // 必填数组：保留的方法展开状态，仅可引用真实方法 ID，不得重复。
  }
};
