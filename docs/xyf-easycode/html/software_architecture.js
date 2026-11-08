globalThis.softwareArchitecture = {
  "formatVersion": 1,
  "id": "project-template",
  "name": "CodeBridge CLI",
  "englishName": "codebridge-cli",
  "description": "CodeBridge 采用 Rust 封装原生 Go Mutagen，用于 Local 与 VPS 之间的项目文件双向同步和网页端口转发。用户只需拷贝对应系统与架构的 CodeBridgeLocal、CodeBridgeVPS 可执行程序；构建时打包所需组件，运行时自动准备，不要求用户安装 Go、Mutagen 或手动配置系统环境变量。Mutagen 源码保持不变。Local 通过已有 SSH 能力主动连接 VPS，Agent 按 Mutagen 原生机制自动部署和启动；CodeBridgeVPS 负责资源台账与查询，不取代 Agent 协议。启动参数按输入、已保存配置、约定默认值的顺序补齐，成功后保存。命令返回统一 JSON，日志由各自程序目录的 logs/yyyy_mm_dd.log 保存并保留 90 天。单文件交付不等于单进程；每台 Local 与 VPS 只保持一条物理连接仍是待验证约束，不宣称原生 Mutagen 已满足。",
  "repository": {
    "path": "/home/xyf/orca/CodeBridge_CLI/0.0.1",
    "revision": "7ba1748d816ac92477373c65b4ecf8437820c90a",
    "dirty": true
  },
  "groups": [
    {
      "id": "group-e4af7b0a-c2f1-48a1-a84e-5a98653a56c0",
      "name": "公共",
      "englishName": "Common",
      "color": "#ffffff",
      "backgroundColor": "#8d80b8",
      "x": 2780,
      "y": 2430
    },
    {
      "id": "group-679f7997-02f7-419d-b8a9-50719242faa9",
      "name": "Local",
      "englishName": "Local",
      "color": "#ffffff",
      "backgroundColor": "#559c80",
      "x": 2750,
      "y": 1180
    },
    {
      "id": "group-0c1d02ac-36eb-4750-b3fc-0f51ae7cc54d",
      "name": "VPS",
      "englishName": "VPS",
      "color": "#ffffff",
      "backgroundColor": "#ad884f",
      "x": 2750,
      "y": 80
    },
    {
      "id": "group-0cb11cc3-b58d-4551-90c7-2ac347d32ba7",
      "name": "Mutagen Local",
      "englishName": "MutagenLocal",
      "color": "#ffffff",
      "backgroundColor": "#559c80",
      "x": 3330,
      "y": 1300
    },
    {
      "id": "group-mutagen-vps",
      "name": "Mutagen VPS",
      "englishName": "MutagenVPS",
      "color": "#ffffff",
      "backgroundColor": "#ad8861",
      "x": 3310,
      "y": 80
    }
  ],
  "modules": [
    {
      "id": "module-05d74c5b-bdc8-4da4-a97d-c7ec5d67643d",
      "name": "配置参数模块",
      "englishName": "ConfigManager",
      "purpose": "两端共用的配置读写、JSON 转换与命令结果模块。保留 save_json、load_json、serialize、deserialize、set_result、get_result 六个静态关联函数。配置固定保存在应用程序目录/config/；业务参数由调用模块持有，命令结果仅在当前进程内暂存。",
      "language": "Rust",
      "codeLocation": "src/Common/config.rs",
      "groupId": "group-e4af7b0a-c2f1-48a1-a84e-5a98653a56c0",
      "x": 2800,
      "y": 2490,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "modified",
      "sources": [],
      "unknowns": [],
      "requirements": [
        "单例模块：每个主程序进程内仅有一个配置参数模块实例。",
        "同一进程中的其他模块统一使用该实例。",
        "VPS 与 Local 的主程序分别持有自己的实例。",
        "项目使用 Rust 实现；对外保留 save_json、load_json、serialize、deserialize、set_result、get_result 六个静态关联函数，不新增业务参数管理接口。",
        "配置文件保存为当前运行主程序所在目录/config/*.json；从主程序可执行文件路径确定目录，不使用启动命令所在目录，也不在定位失败时回退到其他目录。",
        "各业务模块自行定义并持有自己的参数结构体；本模块不集中保存、缓存或解释各业务模块的参数。",
        "save_json 和 load_json 仅负责 JSON 文本与配置文件之间的读写；serialize 和 deserialize 仅负责参数结构体与 JSON 文本之间的转换。",
        "调用方为 serialize 传入支持 serde::Serialize 的参数结构体，为 deserialize 指定支持 serde::de::DeserializeOwned 的目标类型 T；反序列化成功时返回 T。",
        "文件名由调用模块明确传入；只允许 config 目录下的 .json 配置文件，拒绝绝对路径和越出配置目录的路径。首次保存时创建缺少的 config 目录。",
        "加载文件缺失、文件读写失败、JSON 转换失败都返回错误；是否使用默认参数由调用模块决定，本模块不替业务模块生成默认值。",
        "提供 set_result 与 get_result 静态关联函数：集中托管命令返回值，并在 set_result 中通过布尔开关控制控制台屏幕打印，自动触发 Logger 日志落盘。",
        "业务参数读取、合并、校验及成功后保存由 CodeBridgeLocal 或 CodeBridgeVPS 决定；本模块不把文件损坏或权限错误当成空配置。",
        "统一响应包含 ok、data、error；print_screen 只控制标准输出，不关闭日志。每条命令只输出一次最终响应；暂存结果不能作为跨进程状态或真实连接状态。",
        "set_result 成功只表示本次结果处理完成，不表示结果中的业务操作成功；业务成功以 CommandResult.ok 及实际观测的 data 状态为准。"
      ],
      "dependencies": [
        "Rust std::env::current_exe：取得主程序路径，确定其所在目录下的 config/。",
        "Rust std::fs：读取和保存 UTF-8 JSON 文本。",
        "serde::Serialize / serde::de::DeserializeOwned：业务模块参数结构体的序列化与反序列化约定。",
        "serde_json::to_string / serde_json::from_str：结构体与 JSON 文本转换。",
        "Logger::log_info / Logger::log_error：自动将操作结果记录至日志文件。"
      ],
      "parameters": [],
      "structures": [
        {
          "id": "structure-6ad2c67b-2d09-4e64-8e07-6533cae19511",
          "name": "配置接口错误",
          "englishName": "ConfigError",
          "fields": [
            {
              "id": "field-26831d99-36dc-4f21-9663-4aea13db558b",
              "name": "错误类别",
              "englishName": "kind",
              "type": "String",
              "description": "主程序路径定位失败、配置文件名无效、文件读写失败、序列化失败或反序列化失败等稳定类别。"
            },
            {
              "id": "field-e9d87171-6530-47fd-a99e-c3354172b445",
              "name": "错误原因",
              "englishName": "message",
              "type": "String",
              "description": "供调用方理解和处理的具体原因。"
            },
            {
              "id": "field-624f91c1-a5b2-4d9b-8c38-1d8ab8f4556d",
              "name": "关联文件",
              "englishName": "file_path",
              "type": "Option<PathBuf>",
              "description": "文件读写错误对应的配置路径；纯转换错误可为空。"
            }
          ]
        },
        {
          "id": "struct-command-result",
          "name": "统一返回值",
          "englishName": "CommandResult",
          "fields": [
            {
              "id": "f-cmd-ok",
              "name": "是否成功",
              "englishName": "ok",
              "type": "bool",
              "description": "命令是否执行成功。"
            },
            {
              "id": "f-cmd-data",
              "name": "业务数据",
              "englishName": "data",
              "type": "Option<Value>",
              "description": "成功时携带的结构化数据。"
            },
            {
              "id": "f-cmd-error",
              "name": "错误详情",
              "englishName": "error",
              "type": "Option<ErrorInfo>",
              "description": "失败时携带的错误信息。"
            }
          ]
        },
        {
          "id": "struct-error-info",
          "name": "错误详情",
          "englishName": "ErrorInfo",
          "fields": [
            {
              "id": "f-err-code",
              "name": "错误码",
              "englishName": "code",
              "type": "String",
              "description": "机器可读的稳定错误识别码。"
            },
            {
              "id": "f-err-msg",
              "name": "错误说明",
              "englishName": "message",
              "type": "String",
              "description": "通俗易懂的错误原因说明。"
            },
            {
              "id": "f-err-retry",
              "name": "是否可重试",
              "englishName": "retryable",
              "type": "bool",
              "description": "调用方是否可沿用原参数重试。"
            }
          ]
        }
      ],
      "interfaces": [
        {
          "id": "method-a4660fc1-d6a0-45b9-98a3-5f9f6c645a2d",
          "name": "保存 JSON",
          "englishName": "save_json",
          "purpose": "静态关联函数：将调用方提供的 JSON 文本保存到主程序所在目录/config/ 下的指定 .json 文件。",
          "flow": "调用方传入文件名和 JSON 文本；本接口只完成文件保存，成功返回 Ok(())，不替调用方序列化结构体。",
          "errors": "主程序路径定位失败、文件名无效、创建目录失败或文件写入失败时返回 Err(ConfigError)，明确说明原因，不切换到其他保存目录。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "param-3718cebe-099b-4b87-820b-5d6f0ae3269a",
              "name": "配置文件名",
              "englishName": "file_name",
              "type": "&str",
              "description": "配置文件名，如 network.json；文件位于当前主程序所在目录的 config/ 下，必须是 .json 文件，不允许越出该目录。",
              "required": true,
              "defaultValue": ""
            },
            {
              "id": "param-d9e8147e-0124-485c-9b43-af594eefa53f",
              "name": "JSON 文本",
              "englishName": "json_text",
              "type": "&str",
              "description": "调用方传入的 JSON 文本；不包含文件路径或业务参数缓存。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "param-bf428172-e5c0-4bd8-a1eb-0e42bad80e40",
              "name": "返回结果",
              "englishName": "result",
              "type": "Result<(), ConfigError>",
              "description": "Ok(()) 表示保存完成；Err(ConfigError) 表示保存失败。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-4d3339b6-93da-443c-bb5d-17ea3ae14a55",
          "name": "加载 JSON",
          "englishName": "load_json",
          "purpose": "静态关联函数：从主程序所在目录/config/ 下读取指定 .json 文件，返回 UTF-8 JSON 文本。",
          "flow": "调用方传入文件名；成功返回文件原始文本，不将其转换为业务结构体；需要结构体时由调用方继续调用 deserialize。",
          "errors": "主程序路径定位失败、文件名无效、文件不存在、读取失败或内容不是 UTF-8 时返回 Err(ConfigError)，不生成默认配置。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "param-2f092e94-a4a6-424f-a911-1f1862d73f0b",
              "name": "配置文件名",
              "englishName": "file_name",
              "type": "&str",
              "description": "配置文件名，如 network.json；文件位于当前主程序所在目录的 config/ 下，必须是 .json 文件，不允许越出该目录。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "param-2fb7733c-c1f0-4f9e-89d4-61c1ddea30f2",
              "name": "返回结果",
              "englishName": "result",
              "type": "Result<String, ConfigError>",
              "description": "Ok(String) 是读取到的 JSON 文本；Err(ConfigError) 表示加载失败。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-0d55a749-0bc7-439c-8931-d645cc3adec3",
          "name": "序列化",
          "englishName": "serialize",
          "purpose": "静态泛型关联函数：将调用方参数结构体转换为 JSON 文本，不读写文件。",
          "flow": "T 支持 serde::Serialize；读取借用参数 &T 并返回对应 JSON 文本，参数实例仍由调用模块持有。",
          "errors": "结构体序列化失败时返回 Err(ConfigError)；本接口不访问配置文件，也不保存业务参数实例。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "param-2cfaeb61-42bc-43f9-abfe-d790bb9b00c5",
              "name": "参数结构体",
              "englishName": "params",
              "type": "&T where T: serde::Serialize + ?Sized",
              "description": "由调用模块定义并持有、支持序列化的参数结构体。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "param-047ecfc9-4644-4e4b-b0b8-623a6609f910",
              "name": "返回结果",
              "englishName": "result",
              "type": "Result<String, ConfigError>",
              "description": "Ok(String) 是序列化得到的 JSON 文本；Err(ConfigError) 表示转换失败。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-a0dadfeb-5bb6-4508-8f99-20d8273d834d",
          "name": "反序列化",
          "englishName": "deserialize",
          "purpose": "静态泛型关联函数：将 JSON 文本转换为调用方指定类型 T 的参数结构体，不读写文件。",
          "flow": "调用方式为 ConfigManager::deserialize::<T>(json_text)；T 支持 serde::de::DeserializeOwned；成功返回结构体 T，由调用模块接收并持有。",
          "errors": "JSON 文本非法、字段结构或值不符合 T 的反序列化约定时返回 Err(ConfigError)，不替调用模块补业务默认值。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "param-bcb07763-74b8-4e40-b5c9-fbff0d7d685c",
              "name": "JSON 文本",
              "englishName": "json_text",
              "type": "&str",
              "description": "调用方传入的 JSON 文本；不包含文件路径或业务参数缓存。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "param-4f953b4b-53d7-4ed3-8dbf-021d2075e420",
              "name": "返回结果",
              "englishName": "result",
              "type": "Result<T, ConfigError>",
              "description": "Ok(T) 是新生成的目标参数结构体；Err(ConfigError) 表示转换失败。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-config-set-result",
          "name": "设定返回值",
          "englishName": "set_result",
          "purpose": "暂存当前进程的 CommandResult，按业务成功或失败调用 Logger，并由 print_screen 决定是否输出完整 JSON。业务方法返回数据，由 dispatch 统一调用本接口，避免重复输出。",
          "flow": "返回值仅暂存在当前进程，不写作连接状态。\n业务成功调用 Logger::log_info，业务失败调用 Logger::log_error；日志调用不向本接口返回写入成败。\nprint_screen=true 时向标准输出写一个完整 JSON 响应；false 时不打印，调用者收到明确的结果处理错误。",
          "errors": "序列化、结果暂存或标准输出失败返回 ConfigError。Logger 四个方法没有错误返回值，不能承诺通过本接口检测日志写入失败；保持 Logger 既有非中断约定。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-set-ok",
              "name": "是否成功",
              "englishName": "ok",
              "type": "bool",
              "description": "业务操作是否成功完成。",
              "required": true,
              "defaultValue": ""
            },
            {
              "id": "p-set-data",
              "name": "业务数据",
              "englishName": "data",
              "type": "Option<Value>",
              "description": "成功时的业务数据内容。",
              "required": true,
              "defaultValue": ""
            },
            {
              "id": "p-set-error",
              "name": "错误详情",
              "englishName": "error",
              "type": "Option<ErrorInfo>",
              "description": "失败时的错误详情对象。",
              "required": true,
              "defaultValue": ""
            },
            {
              "id": "p-set-print",
              "name": "控制台打印开关",
              "englishName": "print_screen",
              "type": "bool",
              "description": "true 表示通过 println! 打印到标准输出屏幕，false 则静默执行。",
              "required": true,
              "defaultValue": "true"
            }
          ],
          "outputs": [
            {
              "id": "p-set-res",
              "name": "返回结果",
              "englishName": "result",
              "type": "Result<(), ConfigError>",
              "description": "Ok(()) 表示设定完成。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-config-get-result",
          "name": "读取返回值",
          "englishName": "get_result",
          "purpose": "静态关联函数：读取此前设定的统一返回值结构体对象。",
          "flow": "从当前上下文中提取已暂存的 CommandResult 结构体并返回。",
          "errors": "未曾设定过返回值时返回 Err(ConfigError)。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [],
          "outputs": [
            {
              "id": "p-get-res",
              "name": "返回值结构",
              "englishName": "result",
              "type": "Result<CommandResult, ConfigError>",
              "description": "读取到的统一返回值对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        }
      ],
      "events": [],
      "tests": [
        {
          "id": "test-64d6e904-27a0-4454-a816-bf6943c6cc8b",
          "name": "固定配置目录",
          "englishName": "ExecutableRelativeConfigDirectory",
          "steps": "将主程序从不同工作目录启动，分别以同一文件名保存和加载 JSON。",
          "expected": "始终访问主程序所在目录/config/ 下的同一文件，不在工作目录生成其他配置。"
        },
        {
          "id": "test-7682e512-eaf8-49e3-ac03-b52616b2b786",
          "name": "文件读写与转换分开",
          "englishName": "SeparateFileIoAndConversion",
          "steps": "保存指定 JSON 文本，再加载该文件；分别对同一参数结构体调用 serialize 和 deserialize。",
          "expected": "保存和加载返回文本；序列化与反序列化正确转换结构体，且单独调用转换方法不会读写文件。"
        },
        {
          "id": "test-074b0354-5d78-4dd0-b211-80edf22b84c0",
          "name": "各模块参数独立",
          "englishName": "IndependentModuleParameters",
          "steps": "两个业务模块分别定义参数结构体和配置文件名，进行序列化、保存、加载、反序列化。",
          "expected": "各模块得到对应类型和内容，配置模块不持有或串用业务参数实例。"
        },
        {
          "id": "test-db64608b-a202-45a7-829d-df98e6fe6756",
          "name": "错误明确返回",
          "englishName": "ExplicitConfigurationErrors",
          "steps": "分别使用越界文件名、缺失文件、不可写目录及不符合目标类型的 JSON 调用对应接口。",
          "expected": "各接口返回明确 ConfigError，由调用模块处理，不回退到其他目录或替业务模块生成默认参数。"
        },
        {
          "id": "test-config-result-switch",
          "name": "返回值设定与屏幕打印开关测试",
          "englishName": "SetAndGetResultWithScreenSwitch",
          "steps": "调用 set_result 分别传入 print_screen 为 true 与 false，随后调用 get_result。",
          "expected": "两次均能成功暂存并记录日志，true 时终端输出标准 JSON，false 时静默且 get_result 正常读取。"
        }
      ]
    },
    {
      "id": "module-ee5fc9ea-a9a9-45c3-ba16-e1e531120767",
      "name": "日志模块",
      "englishName": "Logger",
      "purpose": "单例记录主程序运行日志。首次调用自动初始化，按天写入应用程序目录/logs/yyyy_mm_dd.log，最多保留90天并自动翻滚清理。对外仅提供4个单例日志方法。",
      "language": "Rust",
      "codeLocation": "src/Common/logger.rs",
      "groupId": "group-e4af7b0a-c2f1-48a1-a84e-5a98653a56c0",
      "x": 3380,
      "y": 2490,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "modified",
      "sources": [],
      "unknowns": [],
      "requirements": [
        "单例模块：每个主程序进程内仅有一个日志模块实例，其他模块直接调用单例方法。",
        "惰性初始化：第一次调用任意日志方法时，如果未初始化则内部自动完成初始化，对外不暴露显式初始化方法。",
        "日志保存位置：固定写入当前运行主程序所在目录/logs/yyyy_mm_dd.log，每天保存一个独立日志文件。",
        "自动翻滚与清理：日志最多保存 90 天，超过 90 天的历史日志文件自动清理删除。",
        "方法约束：对外仅提供 log_error、log_debug、log_warn、log_info 4 个单例方法，不提供其他方法。",
        "Local 与 VPS 各自保存本程序和已采集底层日志，不宣称两台机器共享一个物理日志文件；采集和转交由各自业务模块负责，Logger 不管理子进程。"
      ],
      "dependencies": [
        "Rust std::env::current_exe：定位可执行程序路径以确定 logs/ 目录。",
        "Rust std::fs：创建 logs 目录、写入日志文件及清理超过 90 天的旧日志。"
      ],
      "parameters": [],
      "structures": [],
      "interfaces": [
        {
          "id": "method-9b1d5c21-72f1-469b-8e3b-9a4f78310001",
          "name": "记录错误日志",
          "englishName": "log_error",
          "purpose": "单例方法：记录 ERROR 级别的运行日志。未初始化时自动触发内部初始化。",
          "flow": "调用方传入消息文本；内部自动添加时间戳与 ERROR 标识，写入当天日志文件。",
          "errors": "写入失败静默处理，不中断调用方业务流程。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "param-9b1d5c21-72f1-469b-8e3b-9a4f78310011",
              "name": "日志内容",
              "englishName": "message",
              "type": "&str",
              "description": "需要记录的错误日志消息文本。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": []
        },
        {
          "id": "method-9b1d5c21-72f1-469b-8e3b-9a4f78310002",
          "name": "记录警告日志",
          "englishName": "log_warn",
          "purpose": "单例方法：记录 WARN 级别的运行日志。未初始化时自动触发内部初始化。",
          "flow": "调用方传入消息文本；内部自动添加时间戳与 WARN 标识，写入当天日志文件。",
          "errors": "写入失败静默处理，不中断调用方业务流程。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "param-9b1d5c21-72f1-469b-8e3b-9a4f78310012",
              "name": "日志内容",
              "englishName": "message",
              "type": "&str",
              "description": "需要记录的警告日志消息文本。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": []
        },
        {
          "id": "method-9b1d5c21-72f1-469b-8e3b-9a4f78310003",
          "name": "记录信息日志",
          "englishName": "log_info",
          "purpose": "单例方法：记录 INFO 级别的运行日志。未初始化时自动触发内部初始化。",
          "flow": "调用方传入消息文本；内部自动添加时间戳与 INFO 标识，写入当天日志文件。",
          "errors": "写入失败静默处理，不中断调用方业务流程。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "param-9b1d5c21-72f1-469b-8e3b-9a4f78310013",
              "name": "日志内容",
              "englishName": "message",
              "type": "&str",
              "description": "需要记录的信息日志消息文本。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": []
        },
        {
          "id": "method-9b1d5c21-72f1-469b-8e3b-9a4f78310004",
          "name": "记录调试日志",
          "englishName": "log_debug",
          "purpose": "单例方法：记录 DEBUG 级别的运行日志。未初始化时自动触发内部初始化。",
          "flow": "调用方传入消息文本；内部自动添加时间戳与 DEBUG 标识，写入当天日志文件。",
          "errors": "写入失败静默处理，不中断调用方业务流程。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "param-9b1d5c21-72f1-469b-8e3b-9a4f78310014",
              "name": "日志内容",
              "englishName": "message",
              "type": "&str",
              "description": "需要记录的调试日志消息文本。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": []
        }
      ],
      "events": [],
      "tests": [
        {
          "id": "test-9b1d5c21-72f1-469b-8e3b-9a4f78310021",
          "name": "首次调用自动初始化",
          "englishName": "LazyInitializationOnFirstCall",
          "steps": "首次调用任意 log 方法（如 log_info）。",
          "expected": "自动在应用程序所在目录创建 logs/ 目录，并生成当天的 yyyy_mm_dd.log 文件并成功写入日志。"
        },
        {
          "id": "test-9b1d5c21-72f1-469b-8e3b-9a4f78310022",
          "name": "按天滚动与超期清理",
          "englishName": "DailyRotationAndRetention",
          "steps": "模拟跨天写入，并预置超过 90 天的历史日志文件。",
          "expected": "新日志写入新的当天文件，且超过 90 天的历史日志文件被自动清理删除。"
        },
        {
          "id": "test-9b1d5c21-72f1-469b-8e3b-9a4f78310023",
          "name": "多线程并发单例安全",
          "englishName": "ConcurrentSingletonLogging",
          "steps": "多线程并发分别调用 log_error、log_warn、log_info、log_debug。",
          "expected": "日志格式清晰，各线程写入互不冲突，消息不丢失、不破坏文件结构。"
        }
      ]
    },
    {
      "id": "module-mutagen-cli",
      "name": "Mutagen 命令行总入口",
      "englishName": "MutagenCli",
      "purpose": "不修改源码的原生 Go 可执行程序入口，供 CodeBridgeLocal 通过进程参数调用。提供 daemon、sync、forward、project 等命令；它不是 Rust 可直接调用的 Go 类。只有已核实支持模板的状态查询使用 JSON 模板输出。",
      "language": "Go",
      "codeLocation": "depends/mutagen/cmd/mutagen/main.go",
      "groupId": "group-0cb11cc3-b58d-4551-90c7-2ac347d32ba7",
      "x": 3350,
      "y": 1360,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "modified",
      "sources": [
        {
          "path": "depends/mutagen/cmd/mutagen/main.go",
          "line": 73,
          "endLine": 109,
          "symbol": "main / rootCommand"
        },
        {
          "path": "depends/mutagen/cmd/mutagen/daemon/main.go",
          "line": 46,
          "endLine": 61,
          "symbol": "supportedCommands"
        },
        {
          "path": "depends/mutagen/pkg/agent/bundle.go",
          "line": 54,
          "endLine": 103,
          "symbol": "ExecutableForPlatform"
        }
      ],
      "unknowns": [
        "运行平台清单、依赖校验和及原生版本兼容性需在构建与干净环境部署测试中确认，当前不视为通过。"
      ],
      "requirements": [
        "源码固定使用项目 depends/mutagen 的已锁定提交，不改动该依赖源码；构建时生成主程序及匹配版本的 Agent 包，并内嵌至 CodeBridgeLocal。",
        "原生 daemon 提供 run、start、stop；不能假设存在 daemon status 命令。同步与转发会话由原生后台管理，不重复实现文件监听或重连引擎。",
        "原生 sync、forward 管理各自会话；CodeBridge 只操作本程序登记的精确会话编号，不使用全局全部会话操作影响用户其他任务。",
        "已核实 sync list 与 forward list 可用 --template {{json .}} 输出查询数据；create、start 等命令不保证返回 JSON，退出码、标准输出和标准错误分别处理。",
        "Agent 包按原生规则放在释放后的 Mutagen 可执行程序旁或支持的 libexec 位置，两者版本必须一致；不依赖用户单独准备组件。",
        "原生 Mutagen 会派生后台进程和 SSH/Agent 相关进程；不能由改名或内嵌推断为单进程，也不能由包内的多路复用代码推断为全局唯一 SSH 连接。"
      ],
      "dependencies": [],
      "parameters": [],
      "structures": [],
      "interfaces": [
        {
          "id": "method-cli-execute",
          "name": "执行 Mutagen 命令",
          "englishName": "ExecuteCommand",
          "purpose": "原有名称 ExecuteCommand 表示外部进程调用边界，不是 Mutagen 源码中的同名公开 Go 函数；由 Rust 以参数数组启动原生可执行程序。",
          "flow": "以原生命令行参数调用 mutagen，并收集退出码、标准输出、标准错误。\n仅对支持模板的查询解析 JSON；其他命令按原生行为处理。",
          "errors": "非零退出码、超时或查询解析失败由 Rust 转换为统一错误；请求受理或会话创建不等于文件同步完成或网页可访问。",
          "status": "modified",
          "sources": [
            {
              "path": "depends/mutagen/cmd/mutagen/main.go",
              "line": 89,
              "endLine": 109,
              "symbol": "main"
            }
          ],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-cli-args",
              "name": "参数数组",
              "englishName": "args",
              "type": "[]string",
              "description": "原生程序的命令行参数数组，例如 sync、list、--template、{{json .}}；不是 Go 库接口入参。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "p-cli-res",
              "name": "命令输出",
              "englishName": "output",
              "type": "string",
              "description": "被调用进程的标准输出；仅支持模板的查询可约定为 JSON，退出码与诊断由 Rust 调用方另行检查。",
              "required": true,
              "defaultValue": ""
            }
          ]
        }
      ],
      "events": [],
      "tests": [
        {
          "id": "t-cli-exec",
          "name": "CLI 执行测试",
          "englishName": "TestExecuteCommand",
          "steps": "执行 mutagen version 并读取输出。",
          "expected": "成功输出版本字符串且退出码为 0。"
        },
        {
          "id": "test-cb-native-query-contract",
          "name": "原生命令与查询格式",
          "englishName": "NativeCommandAndQueryContract",
          "steps": "在隔离数据目录中检查 version、daemon start/stop、sync list 和 forward list 的真实输出及退出码。",
          "expected": "不调用不存在的 daemon status；查询 JSON 可解析，非查询不假设为 JSON，失败不会报告为成功。"
        }
      ]
    },
    {
      "id": "module-mutagen-agent",
      "name": "Mutagen VPS 代理总入口",
      "englishName": "MutagenAgent",
      "purpose": "原生 Go mutagen-agent 程序入口。由 Local 的 Mutagen 经 SSH 部署到 VPS 的版本目录，并按 synchronizer 或 forwarder 模式启动，通过标准输入输出处理相应协议。用户不需要单独安装、调用或了解它。",
      "language": "Go",
      "codeLocation": "depends/mutagen/cmd/mutagen-agent/main.go",
      "groupId": "group-mutagen-vps",
      "x": 3360,
      "y": 140,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "modified",
      "sources": [
        {
          "path": "depends/mutagen/cmd/mutagen-agent/main.go",
          "line": 63,
          "endLine": 79,
          "symbol": "rootCommand / main"
        },
        {
          "path": "depends/mutagen/pkg/agent/install.go",
          "line": 15,
          "endLine": 36,
          "symbol": "Install"
        },
        {
          "path": "depends/mutagen/pkg/agent/install.go",
          "line": 59,
          "endLine": 109,
          "symbol": "install"
        },
        {
          "path": "depends/mutagen/pkg/agent/dial.go",
          "line": 61,
          "endLine": 69,
          "symbol": "connect"
        }
      ],
      "unknowns": [
        "不同断线方式下 Agent 进程与监听端口的收尾时机需真实验证；不能以文档声明替代实测。"
      ],
      "requirements": [
        "保持 depends/mutagen 源码不变；Agent 与 Local 的 Mutagen 使用相同构建版本并执行原生版本握手。",
        "Agent 由 Local 的 Mutagen 自动复制、安装和调用，安装文件会留在 VPS 磁盘；不得描述为纯内存运行或退出后零文件残留。",
        "synchronizer 与 forwarder 是按需启动的模式，不是一个集中管理所有 Local 的常驻资源登记服务；CodeBridgeVPS 的台账职责不能由该入口自动替代。",
        "同步模式在 VPS 指定目录读写文件；转发模式按源端或目标端配置提供监听或连接。本项目的反向转发在 VPS 的 127.0.0.1 上监听。",
        "标准输入输出用于原生二进制协议，不写入 CodeBridge JSON 或业务日志；Agent 运行日志通过标准错误转发。",
        "进程和端点退出情况以真实协议、退出码和资源观测为准；断开网络不能直接等同于立即退出或端口已经释放。"
      ],
      "dependencies": [],
      "parameters": [],
      "structures": [],
      "interfaces": [
        {
          "id": "method-agent-run",
          "name": "运行VPS代理服务",
          "englishName": "RunAgent",
          "purpose": "原有名称 RunAgent 表示 Agent 可执行程序的启动边界，不是源码中的同名公开 Go 函数。实际由 Mutagen 选择 synchronizer 或 forwarder 模式调用。",
          "flow": "接收原生 Mutagen 选择的 Agent 命令与对应协议流。\n通过 SSH 标准输入输出提供所选端点服务，并在退出时提供实际进程退出码。",
          "errors": "协议握手、版本不匹配或运行故障按原生错误处理；不能将所有通道中断统一判定为正常退出。",
          "status": "modified",
          "sources": [
            {
              "path": "depends/mutagen/cmd/mutagen-agent/main.go",
              "line": 63,
              "endLine": 79,
              "symbol": "main"
            }
          ],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [],
          "outputs": [
            {
              "id": "p-agent-exit-code",
              "name": "退出码",
              "englishName": "exitCode",
              "type": "int",
              "description": "Agent 进程实际退出码，0 只表示正常退出，不表示业务同步或网页检查已经通过。",
              "required": true,
              "defaultValue": "0"
            }
          ]
        }
      ],
      "events": [],
      "tests": [
        {
          "id": "t-agent-lifecycle",
          "name": "Agent 生命周期测试",
          "englishName": "TestAgentLifecycle",
          "steps": "分别创建真实同步与反向转发，记录 Agent 进程、版本安装目录及监听端口；终止会话并观察收尾。",
          "expected": "对应会话确实结束且资源状态可确认；允许保留原生安装文件，不以零文件残留作为通过条件。"
        }
      ]
    },
    {
      "id": "module-codebridge-local",
      "name": "Local 业务主程序",
      "englishName": "CodeBridgeLocal",
      "purpose": "Local 的 Rust 命令外壳，负责自动准备内嵌组件、读取与保存启动参数、调用原生 Mutagen 的同步和转发命令，并把真实结果转换为统一 JSON。用户只操作 CodeBridge，不重复编写 Mutagen 的同步引擎。",
      "language": "Rust",
      "codeLocation": "src/Local/main.rs",
      "groupId": "group-679f7997-02f7-419d-b8a9-50719242faa9",
      "x": 2780,
      "y": 1350,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "modified",
      "sources": [],
      "unknowns": [
        "严格唯一物理 SSH 连接能否在不修改 Mutagen 的前提下跨目标平台承载同步、转发和资源控制，尚未证明；这是继续业务实现前的阻塞项。",
        "CodeBridgeLocal 常驻外壳和原生 daemon 的组织方式、后台日志采集与停机控制未定；不能承诺一个进程或只捕获 daemon start 命令即可采集全部日志。",
        "VPS IP 之外的 SSH 用户名、端口、认证及项目专用 SSH 配置如何进入原生 Mutagen，现有参数未完整定义；不得靠测试主机的个人配置隐式补齐。",
        "内嵌组件释放目录、版本升级及多实例隔离策略需确认；系统与 CPU 架构兼容性需要实测。",
        "多项目持久化记录与每条同步/转发会话编号的数据结构、Local 持久身份来源需补齐，不能用一个拼造的 session_id 代表所有会话。"
      ],
      "requirements": [
        "单文件交付：用户只拷贝对应平台的 CodeBridgeLocal 即可使用；构建阶段从 depends/mutagen 的锁定提交生成并内嵌主程序和匹配 Agent 包，运行时不下载源码或安装编译工具。",
        "自动准备运行组件：释放到应用程序管理的专用目录，检查版本、完整性和执行权限；并发首次启动不破坏文件，升级不覆盖正在使用的版本。具体内部目录约定待确认。",
        "环境边界：使用已有系统 SSH、有效登录配置、网络访问及目录权限；不要求用户设置系统环境变量，也不静默安装工具。SSH 账号、端口和凭据选择方式必须在接入设计中确认。",
        "命令行独立参数进入 dispatch；外部 start、stop、status、forward 分别对应 start_codebridge、stop_bridge、query_status、add_forward，所有结果支持 Skill 读取。",
        "参数优先级：显式输入优先于上次成功保存的配置，配置优先于已约定默认值；默认值不能提前填充而覆盖历史值。支持只输入部分参数；合并后仍缺必要信息则报错。",
        "既无输入参数又无配置文件时拒绝启动；配置文件损坏或无读取权限时明确报错，不当成首次使用或空配置。启动成功后保存实际生效的完整参数，保存失败须说明业务已启动但配置未保存。",
        "目录与归属：规范化 local_path 后定位会话，不能仅凭目录名区分项目；vps_path 优先输入或历史值，无记录时按既定 ~/codebridge/<目录名> 推导，冲突则拒绝而不是覆盖其他 Local。",
        "真实调用 Mutagen 创建或复用登记一致的同步与转发会话；保存真实会话编号，重复启动不生成重复任务。失败只回收本次创建的资源，不删除两端项目文件。",
        "网页端口 web_port 为 Local 已有服务的真实端口，不随机更改或自动启动业务程序；VPS 端口从 10000 至 65535 随机选择候选，并由 VPS 实际检查和 Mutagen 绑定确认；冲突有界重试，不能用 Local 空闲端口推断 VPS 空闲。",
        "连接约束：每台 Local 仅连接一个 VPS，要求同一对 Local/VPS 的任务复用唯一物理连接；该约束仍需可行性验证，不得擅自放宽，也不得宣称原生 Mutagen 已自动满足。",
        "后台边界：用户无需管理内部组件，但运行时可能存在 CodeBridge、Mutagen daemon、SSH 与 Agent 进程；不将单文件交付或进程改名解释为单进程实现。常驻外壳、原生 daemon 与命令进程的具体组织待确认。",
        "日志汇聚：采集实际运行组件的日志，保留级别和来源并交给 Logger，写入本程序目录/logs/yyyy_mm_dd.log，保留 90 天；短时 CLI 的 stderr 不等于 daemon 的持续日志，采集方案需单独验证。",
        "输出与状态：仅把支持模板的原生查询解析为 JSON；dispatch 每条命令统一调用 ConfigManager::set_result 一次。返回实际状态，区分已受理、运行中、冲突、失败、离线和未知，不伪造 ready、connected、会话编号或网页地址。",
        "stop_bridge 和 add_forward 仅操作归属本程序及目标目录的会话，保留其他项目和用户自行建立的 Mutagen 会话；端口、进程是否停止必须确认，状态不明时保留登记。"
      ],
      "dependencies": [
        "ConfigManager::load_json / ConfigManager::deserialize：读取已保存参数。",
        "ConfigManager::serialize / ConfigManager::save_json：成功后保存有效参数。",
        "ConfigManager::set_result / ConfigManager::get_result：当前进程的统一命令结果。",
        "Logger::log_info / Logger::log_error / Logger::log_warn / Logger::log_debug：业务与已采集底层日志。",
        "MutagenCli：原生可执行程序及匹配 Agent 包。",
        "CodeBridgeVPS::reserve_resource / CodeBridgeVPS::release_resource / CodeBridgeVPS::inspect_status：VPS 资源与查询，调用通道待确认。"
      ],
      "parameters": [],
      "structures": [],
      "interfaces": [
        {
          "id": "method-local-dispatch",
          "name": "命令总调度",
          "englishName": "dispatch",
          "purpose": "解析独立参数并调用对应业务方法，在命令出口统一生成一次 CommandResult、日志和可控 JSON 输出。",
          "flow": "识别命令以及哪些参数由用户显式输入，不在解析时用默认值覆盖历史配置。\n调用对应业务方法并保留其实际成功或失败结果。\n统一调用 set_result 一次，错误使用非零进程退出码；帮助或版本请求不当作参数错误。",
          "errors": "参数错误、业务失败、结果输出失败均不得吞掉；帮助与版本请求按正常请求处理，不重复输出响应。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-dispatch-args",
              "name": "参数列表",
              "englishName": "args",
              "type": "&[String]",
              "description": "命令行传入的参数切片。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "p-dispatch-res",
              "name": "调度结果",
              "englishName": "result",
              "type": "Result<(), String>",
              "description": "Ok(()) 表示调度并收口完成。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-local-start-codebridge",
          "name": "启动 CodeBridge 桥接",
          "englishName": "start_codebridge",
          "purpose": "自动准备内嵌依赖，使用输入参数覆盖历史配置并补齐约定默认值，实际启动同步和网页转发；成功后保存生效参数，返回真实会话与状态供 dispatch 统一输出。",
          "flow": "参数选择按显式输入、上次成功配置、约定默认值排序；既无输入又无配置文件或合并后缺必要信息时拒绝启动。\n内嵌组件、SSH 条件及目录权限满足后才能创建或复用归属一致的任务；唯一物理连接方案未验证前不得宣称满足。\n确认真实同步会话与 VPS 监听地址；会话受理不等于初始同步完成或网页业务就绪。\n成功后保存本次生效参数及真实会话归属；保存失败须返回业务实际状态和保存失败原因。\n返回 CommandResult 由 dispatch 统一处理，不在本方法重复打印或填造 web_url。",
          "errors": "无参数且无配置、必要参数不足、配置损坏或不可读、组件校验失败、路径无效、SSH 失败、VPS 目录冲突、监听绑定失败均明确报错。失败不覆盖上次成功配置；不能把部分成功或配置保存失败报告为完整成功。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-start-web-port",
              "name": "网页端口",
              "englishName": "web_port",
              "type": "Option<u16>",
              "description": "Local 网页实际服务端口；未传优先读取已保存配置，无历史值时才使用 3000。",
              "required": false,
              "defaultValue": "3000"
            },
            {
              "id": "p-start-vps-ip",
              "name": "VPS IP",
              "englishName": "vps_ip",
              "type": "Option<&str>",
              "description": "VPS IP；未传读取已保存 IP，无可用值则报错。SSH 用户、认证与端口接入方式属于待确认条件。",
              "required": false,
              "defaultValue": ""
            },
            {
              "id": "p-start-local-path",
              "name": "项目目录",
              "englishName": "local_path",
              "type": "Option<&Path>",
              "description": "Local 项目目录；显式值优先，其次已保存值，无历史值时使用当前目录。路径需规范化后定位任务，不只取目录名。",
              "required": false,
              "defaultValue": "."
            },
            {
              "id": "p-start-vps-path",
              "name": "VPS目录",
              "englishName": "vps_path",
              "type": "Option<&str>",
              "description": "VPS 项目保存目录；显式值优先，其次已保存值，无历史值时推导 ~/codebridge/<目录名>；已有归属冲突时拒绝。",
              "required": false,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "p-start-codebridge-res",
              "name": "启动结果",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "真实启动结果：区分任务已受理与同步/网页就绪；会话编号、VPS 端口和 web_url 均来自实际创建或查询，无法确认时标明未知。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-local-stop-bridge",
          "name": "停止桥接",
          "englishName": "stop_bridge",
          "purpose": "停止当前目录或指定范围内、本程序管理的同步和转发会话；确认停止后释放对应登记，保留两端文件及下次启动所需参数。",
          "flow": "根据规范化目录和已保存会话归属定位目标，all=true 仅扩大到本程序管理的项目。\n请求终止目标同步和转发并确认实际状态；不触碰其他程序任务。\n确认停止后解除对应资源登记，保留项目文件和历史启动参数；结果由 dispatch 输出。",
          "errors": "范围不明、目标离线、会话停止或端口释放无法确认时返回失败或未知，保留资源归属，不提前宣布释放。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-stop-path",
              "name": "项目路径",
              "englishName": "project_path",
              "type": "Option<&Path>",
              "description": "可选的目标项目目录路径，默认值为当前工作目录。",
              "required": false,
              "defaultValue": "."
            },
            {
              "id": "p-stop-all",
              "name": "停止全部",
              "englishName": "all",
              "type": "Option<bool>",
              "description": "是否一键停止当前全部活跃项目，默认 false。",
              "required": false,
              "defaultValue": "false"
            }
          ],
          "outputs": [
            {
              "id": "p-stop-res",
              "name": "停止结果",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "包含停止确认与已释放端口的标准响应对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-local-query-status",
          "name": "查询状态",
          "englishName": "query_status",
          "purpose": "默认零参数检查当前目录对应项目的连接状态、文件同步进度（watching/syncing/conflicted）以及端口映射清单。",
          "flow": "按规范化目录查找本程序登记的真实会话。\n分别查询同步、转发及连接状态，带实际观测时间；不可用或离线时明确标注。\n仅返回真实登记的 VPS 地址与网页可达性，交由 dispatch 输出。",
          "errors": "无登记、引擎不可用、查询失败或状态过期分别报告；不能把缓存配置直接报告成在线，也不能生成默认 10086 网页地址。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-query-path",
              "name": "项目路径",
              "englishName": "project_path",
              "type": "Option<&Path>",
              "description": "可选的项目目录路径，默认值为当前工作目录。",
              "required": false,
              "defaultValue": "."
            }
          ],
          "outputs": [
            {
              "id": "p-query-res",
              "name": "状态快照",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "包含连接、同步与端口详情的状态对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-local-add-forward",
          "name": "动态增补端口",
          "englishName": "add_forward",
          "purpose": "为当前目录项目动态追加映射端口：只需输入Local网页端口，VPS端口自动在 10000+ 随机分配，不中断现有任务。",
          "flow": "定位当前项目的真实会话归属和 VPS 配置，使用输入的真实网页端口。\n取得 VPS 候选端口登记并实际创建转发，绑定冲突有界重试。\n保存新增真实会话编号与访问地址，原任务继续运行；结果由 dispatch 统一输出。",
          "errors": "项目未运行、网页服务不可达、VPS 登记或实际绑定失败、保存失败均如实报告；不返回拼造的成功地址，不中断原有任务。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-fwd-web-port",
              "name": "网页端口",
              "englishName": "web_port",
              "type": "u16",
              "description": "Local 正在运行的新网页或硬件服务端口号（如 8080）。",
              "required": true,
              "defaultValue": ""
            },
            {
              "id": "p-fwd-path",
              "name": "项目路径",
              "englishName": "project_path",
              "type": "Option<&Path>",
              "description": "可选的目标项目路径，默认当前工作目录。",
              "required": false,
              "defaultValue": "."
            }
          ],
          "outputs": [
            {
              "id": "p-fwd-res",
              "name": "增补结果",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "包含新增映射会话与VPS访问地址的标准响应对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        }
      ],
      "events": [],
      "tests": [
        {
          "id": "test-local-dispatch",
          "name": "命令总调度与收口测试",
          "englishName": "CommandDispatchTest",
          "steps": "传入 start_codebridge 子命令参数并执行 dispatch。",
          "expected": "正确路由到对应业务方法并调用 set_result 输出统一 JSON。"
        },
        {
          "id": "test-local-no-params-no-config-fails",
          "name": "无参数无配置防御报错测试",
          "englishName": "StartWithNoParamsAndNoConfigFails",
          "steps": "在空配置目录下零参数调用 start_codebridge。",
          "expected": "直接报错拒绝盲启动，并在 JSON error 中明确提示用户输入必要参数。"
        },
        {
          "id": "test-local-partial-params-merge",
          "name": "部分参数覆盖与合并测试",
          "englishName": "StartWithPartialParamsMergesConfig",
          "steps": "预置含有 VPS IP 的配置文件，仅传入 --web-port 8080 调用 start_codebridge。",
          "expected": "成功将新端口 8080 与历史配置中的 VPS IP 合并并启动，随后更新配置文件。"
        },
        {
          "id": "test-local-success-persists-config",
          "name": "启动成功自动持久化测试",
          "englishName": "StartSuccessPersistsConfig",
          "steps": "首次传入有效参数成功启动桥接任务。",
          "expected": "配置文件被成功创建并写入最新有效参数，下次可零参数直接复用。"
        },
        {
          "id": "test-local-stop-bridge",
          "name": "安全断开停止测试",
          "englishName": "StopBridgeTest",
          "steps": "调用 stop_bridge 停止运行中的桥接会话。",
          "expected": "成功终止会话并安全保留两端磁盘文件。"
        },
        {
          "id": "test-cb-copy-only-local",
          "name": "仅拷贝 Local 程序部署",
          "englishName": "CopyOnlyLocalDeployment",
          "steps": "在无独立 Mutagen 和 Go 的干净测试环境，仅放置匹配平台的 CodeBridgeLocal，提供可用系统 SSH 和登录条件后启动。",
          "expected": "组件自动准备且真实双向同步与网页访问通过；缺失 SSH 或权限返回明确错误，不安装工具。"
        },
        {
          "id": "test-cb-real-roundtrip",
          "name": "真实同步与转发停止",
          "englishName": "RealSyncForwardAndStop",
          "steps": "两端互改独立测试目录文件，VPS 实际请求 Local 测试网页；调用 stop_bridge 后再次检查会话与端口。",
          "expected": "双向文件内容一致，网页响应正确，目标会话与监听确实停止，其他任务不受影响。"
        },
        {
          "id": "test-cb-config-precedence",
          "name": "完整参数继承与失败保存",
          "englishName": "StartupConfigPrecedenceAndFailure",
          "steps": "保存非 3000 网页端口和非当前目录，零参数及部分覆盖重启；再模拟配置损坏、启动失败与保存失败。",
          "expected": "四项参数遵守输入优先、配置其次、默认最后；失败不覆盖成功配置，不吞保存错误。"
        },
        {
          "id": "test-cb-no-fake-status",
          "name": "失败不伪造成功",
          "englishName": "NoFabricatedRuntimeStatus",
          "steps": "无会话、断线、端口冲突和引擎缺失时分别启动或查询，并检查标准输出和退出码。",
          "expected": "恰好一个统一 JSON，失败/未知如实可见，退出码匹配；未探测不返回 connected、ready 或假会话编号。"
        },
        {
          "id": "test-cb-single-connection",
          "name": "唯一物理连接验收",
          "englishName": "SinglePhysicalConnectionAcceptance",
          "steps": "在隔离目标环境同时运行多项目同步、多端口转发和资源查询，实际统计 SSH 物理连接。",
          "expected": "同一 Local/VPS 仅有一条连接方可通过；方案或平台未验证时标记未验证，不以单个 daemon 代替此验收。"
        },
        {
          "id": "test-cb-daemon-logs",
          "name": "持续运行日志汇聚",
          "englishName": "ContinuousDaemonLogCollection",
          "steps": "命令退出后触发同步、重连和错误，检查 Local 与 VPS 日志来源、级别及日期文件。",
          "expected": "已承诺采集的日志不会在命令退出后丢失；各自写入程序目录/logs/yyyy_mm_dd.log；未覆盖路径明确标为未验证。"
        }
      ]
    },
    {
      "id": "module-codebridge-vps",
      "name": "VPS 业务主程序",
      "englishName": "CodeBridgeVPS",
      "purpose": "VPS 的 Rust 业务入口，用户只拷贝 CodeBridgeVPS 即可准备程序环境、管理资源台账及查询实际状态。同步与转发仍由 Local 驱动原生 Agent，VPS 业务服务不是 Mutagen Agent 的改名替代品。",
      "language": "Rust",
      "codeLocation": "src/VPS/main.rs",
      "groupId": "group-0c1d02ac-36eb-4750-b3fc-0f51ae7cc54d",
      "x": 2770,
      "y": 140,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "modified",
      "sources": [],
      "unknowns": [
        "CodeBridgeVPS 后台服务的本机命令通信、SSH 进入方式、调用者认证和停止 Agent/Local 会话的控制链未定；不能仅写台账实现端口释放。",
        "同一 Local/VPS 唯一物理连接如何覆盖原生 Agent、CodeBridge 资源控制和查询，尚未验证。",
        "--name 的实际进程名称设置、跨平台长度限制及内部子进程的命名边界需验证；保留需求，不假称已实现。",
        "Agent 日志回传到 Local 与 VPS Logger 各自的覆盖范围和持续采集路径需确认。",
        "ResourceRecord 的现有字段只描述基础归属；多个端口、真实会话编号及授权信息的持久结构尚待确认，不在本轮擅自扩充参数。"
      ],
      "requirements": [
        "单文件交付：用户只拷贝匹配系统与 CPU 架构的 CodeBridgeVPS；自身必要资源由构建打包和程序自动准备，不要求安装 Go、Mutagen 或手动处理 Agent。已有 SSH 服务、认证与可写目录是明确前提。",
        "start_vps 创建或加载资源台账并确保 CodeBridge 业务服务真实就绪，不启动第二套 Mutagen 同步引擎；Agent 由 Local 的 Mutagen 按原生机制自动部署和调用。后台控制入口及与 Local 的通信方案待确认。",
        "单文件不等于单进程：允许必要内部组件；保留 --name 指定名称及缺省 5 至 10 位英文字母的需求，但各平台如何设置实际进程名称仍需验证，不能只返回一个 service_name 冒充已改名。",
        "同时管理多个 Local 的资源，按持久身份和规范化 VPS 目录区分归属；每台 Local 与 VPS 唯一物理连接仍是待验证约束，不视为原生 Agent 已具备的集中服务。",
        "reserve_resource 原子检查相同、父子重叠和符号链接别名目录，检查台账与系统端口占用；随机端口范围为 10000 至 65535，登记候选不代表实际监听成功，最终以 Mutagen 绑定观测确认。",
        "资源释放只处理本程序管理且归属已确认的任务；先确认对应同步、转发和监听已停止，再解除相应登记。Local 离线、停止不明时保留绑定，不能清空台账让其他主机重用目录。",
        "stop_vps 不扫描关闭所有 10000 以上端口、不停止 SSH 服务或用户业务程序、不删除项目文件；未能停止的任务明确返回失败或未知，不先报告 clean_exit。",
        "inspect_status 查询真实目录、资源归属及 VPS 的 127.0.0.1 端口连接结果；端口能连通不等于网页业务或硬件正常，无登记不返回默认 web_url。",
        "配置和结果复用 Common 的 ConfigManager；台账损坏不可当空台账覆盖，保存失败不得报告登记成功。dispatch 每条命令统一输出一次 JSON，帮助/版本不作为业务失败。",
        "业务和已采集底层日志统一交给 Logger，保存在 VPS 程序目录/logs/yyyy_mm_dd.log，按天保留 90 天；原生 Agent 的 stderr 不会自动进入 Rust 进程，归集路径必须设计并验证。"
      ],
      "dependencies": [
        "ConfigManager::load_json / ConfigManager::deserialize / ConfigManager::serialize / ConfigManager::save_json：资源台账。",
        "ConfigManager::set_result / ConfigManager::get_result：统一命令响应。",
        "Logger::log_info / Logger::log_error / Logger::log_warn / Logger::log_debug：业务与已采集日志。",
        "MutagenAgent：原生端点由 Local 的 Mutagen 启动，不是 VPS 业务服务可直接调用的 Go 类。",
        "CodeBridgeLocal：任务停止与资源控制回执，具体认证和控制通道待确认。"
      ],
      "parameters": [],
      "structures": [
        {
          "id": "struct-vps-resource-record",
          "name": "资源台账记录",
          "englishName": "ResourceRecord",
          "fields": [
            {
              "id": "f-rec-lid",
              "name": "主机标识",
              "englishName": "local_id",
              "type": "String",
              "description": "所属 Local 电脑的主机标识符。"
            },
            {
              "id": "f-rec-root",
              "name": "VPS目录",
              "englishName": "vps_path",
              "type": "String",
              "description": "VPS 上独占的项目目录绝对路径。"
            },
            {
              "id": "f-rec-port",
              "name": "VPS 端口",
              "englishName": "vps_port",
              "type": "u16",
              "description": "VPS 上分配的监听端口号。"
            },
            {
              "id": "f-rec-url",
              "name": "访问网址",
              "englishName": "web_url",
              "type": "String",
              "description": "供 AI Agent 调试访问的完整网址，如 http://127.0.0.1:10086。"
            }
          ]
        }
      ],
      "interfaces": [
        {
          "id": "method-vps-dispatch",
          "name": "命令总调度",
          "englishName": "dispatch",
          "purpose": "VPS 命令行总调度入口。接收并解析命令行参数，路由分发至启动、停止、巡检等具体方法，统一调用 set_result 输出标准 JSON。",
          "flow": "解析外部命令与显式参数，调用相应业务方法并保留执行结果。\n统一调用 set_result 一次并设置正确退出码；帮助和版本为正常请求。",
          "errors": "参数、业务或输出错误不得忽略，不能 JSON 报失败却以成功退出码退出。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-vps-dispatch-args",
              "name": "参数列表",
              "englishName": "args",
              "type": "&[String]",
              "description": "命令行传入的参数切片。",
              "required": true,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "p-vps-dispatch-res",
              "name": "调度结果",
              "englishName": "result",
              "type": "Result<(), String>",
              "description": "Ok(()) 表示调度完成。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-vps-start",
          "name": "启动 VPS 服务",
          "englishName": "start_vps",
          "purpose": "仅需 CodeBridgeVPS 可执行程序即可准备业务服务所需环境，加载持久台账并确认实际后台服务就绪；保留可选 --name，缺省生成 5 至 10 位英文字母，不要求用户操作 Mutagen。",
          "flow": "检查运行环境及所需内嵌资源；已有 SSH 服务和目录权限不足时明确报告。\n按 name 或随机名称请求设置业务进程名，实际设置和平台兼容性须验证。\n加载已有台账或首次创建，不能因文件损坏而清空归属；重复启动识别已有服务。\n只有真实后台服务就绪才返回成功；Mutagen Agent 仍由 Local 的 Mutagen 按需调用，不以此方法启动一个 Agent 集中监听器。",
          "errors": "组件、平台、命名、目录权限、台账加载或后台服务启动失败如实报告；仅生成 JSON 或台账文件不能视为服务已启动。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-vps-start-name",
              "name": "进程名称",
              "englishName": "name",
              "type": "Option<String>",
              "description": "VPS 的 CodeBridge 业务进程名称；未输入时内部生成 5 至 10 位英文字母，不新增随机命名公开方法。实际进程名称设置与平台限制需验证。",
              "required": false,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "p-vps-start-res",
              "name": "启动状态",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "实际后台服务启动或复用结果，名称及进程状态必须真实；Agent 是否运行单独观测，不能以 service_name 字段替代启动验证。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-vps-stop",
          "name": "停止 VPS 服务",
          "englishName": "stop_vps",
          "purpose": "停止 CodeBridgeVPS 管理范围内的任务和业务服务。确认资源停止后再释放登记，保留项目文件及停止状态不明的绑定。",
          "flow": "核对本服务管理的资源及停止范围，all 仅用于本程序范围。\n通过已验证控制链请求对应任务停止并检查回执和监听状态。\n仅释放已确认停止的登记，持久保留未确认项；完成后确认业务服务退出。",
          "errors": "控制链未就绪、Local 离线、身份不符或资源停止无法确认时返回错误或未知；不清空全部台账，不冒称端口已释放。",
          "status": "modified",
          "sources": [],
          "unknowns": [
            "all=false 的精确停止范围在现有接口中没有明确说明，需确认后才能完整实现该分支。"
          ],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-vps-stop-all",
              "name": "停止全部",
              "englishName": "all",
              "type": "Option<bool>",
              "description": "默认 true，表示请求停止本 CodeBridge 服务管理的全部任务，不包含用户其他程序；false 的具体范围尚待确认。",
              "required": false,
              "defaultValue": "true"
            }
          ],
          "outputs": [
            {
              "id": "p-vps-stop-res",
              "name": "停止结果",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "包含已释放端口与退出确认的标准响应对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-vps-inspect-status",
          "name": "巡检当前状态",
          "englishName": "inspect_status",
          "purpose": "按 VPS 目录检查真实资源台账、目录存在性和 VPS 的 127.0.0.1 监听端口可达性，返回已登记的实际 web_url。",
          "flow": "规范化当前或指定 VPS 目录并读取其真实登记。\n检查目录和对应端口，分别报告服务、Agent/任务、监听与网页检查的已知状态。\n无法观测时标记未知或失败；结果交 dispatch 统一输出，不生成默认地址。",
          "errors": "无登记、配置损坏、查询失败、端口不可达分别说明；TCP 可连接不自动判定网页或硬件功能通过。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-vps-ins-path",
              "name": "VPS目录",
              "englishName": "vps_path",
              "type": "Option<&Path>",
              "description": "可选的 VPS 项目目录路径，默认当前工作目录。",
              "required": false,
              "defaultValue": "."
            }
          ],
          "outputs": [
            {
              "id": "p-vps-ins-result",
              "name": "巡检状态",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "包含 web_url、端口连通性与目录状态的 CommandResult 快照。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-vps-reserve-resource",
          "name": "原子独占登记",
          "englishName": "reserve_resource",
          "purpose": "原子校验并登记指定 Local 主机的VPS同步目录和监听端口，重叠冲突时拒绝。",
          "flow": "确认调用者及 Local 身份和目录归属，规范化路径。\n原子检查真实路径重叠及端口台账；未指定端口时选择 10000 至 65535 的候选。\n保存申请结果并区分候选登记与实际监听；实际绑定冲突由控制链反馈，不提前宣称 web_url 可访问。",
          "errors": "身份不符、目录重叠、系统端口或台账冲突、台账损坏及保存失败均拒绝或如实报告；不能用未加锁的读后写冒充原子登记。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-vps-res-lid",
              "name": "Local 标识",
              "englishName": "local_id",
              "type": "&str",
              "description": "申请资源的 Local 电脑标识。",
              "required": true,
              "defaultValue": ""
            },
            {
              "id": "p-vps-res-path",
              "name": "VPS目录",
              "englishName": "vps_path",
              "type": "&str",
              "description": "申请独占的 VPS 项目目录路径。",
              "required": true,
              "defaultValue": ""
            },
            {
              "id": "p-vps-res-port",
              "name": "VPS 端口",
              "englishName": "vps_port",
              "type": "Option<u16>",
              "description": "内部可选指定候选端口；未传在 10000 至 65535 随机选择，经 VPS 检查和原生转发实际绑定后才能确认可用。",
              "required": false,
              "defaultValue": ""
            }
          ],
          "outputs": [
            {
              "id": "p-vps-res-result",
              "name": "登记结果",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "包含 ResourceRecord 台账凭据与 web_url 的结构化结果。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-vps-release-resource",
          "name": "释放独占登记",
          "englishName": "release_resource",
          "purpose": "确认当前或指定 VPS 目录的调用身份与资源归属，并在相关任务已停止后解除该登记，保留项目文件。",
          "flow": "读取真实登记并核对调用身份和目录归属。\n取得相关同步、转发和监听已停止的可靠结果；状态不明则保留登记。\n保存解除结果并返回，实际文件不删除；由 dispatch 统一输出。",
          "errors": "无登记、身份不符、任务停止不明或持久化失败返回错误；删除台账条目不能代替关闭真实端口。",
          "status": "modified",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-vps-rel-path",
              "name": "VPS目录",
              "englishName": "vps_path",
              "type": "Option<&Path>",
              "description": "可选的目标 VPS 目录路径，默认当前工作目录。",
              "required": false,
              "defaultValue": "."
            }
          ],
          "outputs": [
            {
              "id": "p-vps-rel-result",
              "name": "释放结果",
              "englishName": "result",
              "type": "Result<CommandResult, String>",
              "description": "包含释放确认信息的标准响应对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        }
      ],
      "events": [],
      "tests": [
        {
          "id": "test-vps-service-lifecycle",
          "name": "VPS 服务生命周期测试",
          "englishName": "VpsServiceLifecycleTest",
          "steps": "在 VPS 依次调用 start_vps（启动服务）与 stop_vps（停止服务）。",
          "expected": "成功完成台账就绪、端口全额释放与安全退出闭环。"
        },
        {
          "id": "test-vps-zero-param-inspect",
          "name": "零参数巡检测试",
          "englishName": "ZeroParamInspectStatusTest",
          "steps": "在 VPS 目标目录下直接调用 inspect_status（零参数）。",
          "expected": "成功返回当前工作区状态与可直接访问的 web_url。"
        },
        {
          "id": "test-vps-conflict-protection",
          "name": "VPS目录与端口冲突校验测试",
          "englishName": "VpsDirectoryAndPortConflictTest",
          "steps": "两个不同 Local 主机先后申请同一目录或相同端口。",
          "expected": "第二个申请被明确拒绝，原主机登记与文件完好保持。"
        },
        {
          "id": "test-vps-custom-name-start",
          "name": "VPS 指定进程名启动测试",
          "englishName": "VpsCustomProcessNameStart",
          "steps": "传入 --name MyCloudVps 调用 start_vps。",
          "expected": "VPS后台服务以 MyCloudVps 名称启动运行。"
        },
        {
          "id": "test-cb-copy-only-vps",
          "name": "仅拷贝 VPS 程序部署",
          "englishName": "CopyOnlyVpsDeployment",
          "steps": "在无 Go 和独立 Mutagen 的干净 VPS 测试目录，仅拷贝匹配平台的 CodeBridgeVPS 并启动，再从 Local 建立真实同步与转发。",
          "expected": "用户不操作依赖组件；CodeBridge 服务真实存在，Agent 按原生机制自动准备；只输出 ready 不算通过。"
        },
        {
          "id": "test-cb-vps-real-probe",
          "name": "真实端口与无登记检查",
          "englishName": "VpsRealEndpointInspection",
          "steps": "分别构造无登记、已登记但未监听、实际 TCP 监听和网页错误状态，执行 inspect_status。",
          "expected": "无假地址，TCP 和网页就绪不混淆，实际不可达不会返回 port_reachable=true。"
        },
        {
          "id": "test-cb-vps-scoped-shutdown",
          "name": "停止范围与离线绑定保护",
          "englishName": "VpsScopedShutdownAndOfflineOwnership",
          "steps": "建立本程序与外部程序的多个监听，令一个 Local 离线后请求停止和释放。",
          "expected": "不影响外部程序，不删除项目文件；确认停止才释放，离线未确认登记保留且不能被其他 Local 抢占。"
        },
        {
          "id": "test-cb-vps-concurrent-claim",
          "name": "并发目录与端口归属",
          "englishName": "ConcurrentDirectoryAndPortOwnership",
          "steps": "并发申请相同、父子和符号链接别名目录，申请被占系统端口并模拟台账写入失败。",
          "expected": "冲突不同时成功，失败不覆盖台账；候选端口未绑定不报告为可访问。"
        }
      ]
    }
  ],
  "relations": [
    {
      "id": "relation-024d2e97-0259-4243-aeb8-2e0591a3fa0f",
      "from": "module-codebridge-vps",
      "to": "module-mutagen-agent",
      "label": "Agent 由 Local 调用；非直接 Go 接口",
      "status": "modified",
      "sources": [],
      "unknowns": [
        "此箭头表示同在 VPS 的职责关联，不能视为已实现 CodeBridgeVPS 到 Agent 的直接控制链。"
      ],
      "fromPort": "right",
      "toPort": "left"
    },
    {
      "id": "relation-69dd4812-0f81-4f36-904c-e08d5780c0d4",
      "from": "module-codebridge-local",
      "to": "module-mutagen-cli",
      "label": "内嵌准备后调用原生命令",
      "status": "modified",
      "sources": [],
      "unknowns": [],
      "fromPort": "right",
      "toPort": "left"
    }
  ],
  "view": {
    "x": -4805.850368524447,
    "y": -1239.9118046713238,
    "scale": 1.8,
    "expanded": [],
    "expandedInterfaces": []
  }
};
