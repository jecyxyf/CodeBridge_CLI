globalThis.softwareArchitecture = {
  "formatVersion": 1,
  "id": "project-template",
  "name": "CodeBridge CLI",
  "englishName": "codebridge-cli",
  "description": "CodeBridge 是为远程开发与硬件联调设计的轻量命令行与 AI Skill 外壳，主程序采用 Rust 实现，底层零改动复用 Mutagen 的 Go 核心总入口。Local 与 VPS 之间严格保持唯一单连接通道，多项目多端口复用传输。业务全面支持 AI Agent（Skill）与人类零参数调用：执行 start_codebridge 自动将当前目录同步到 VPS 同名目录，网页端口（默认 3000）自动映射至 VPS 10000+ 随机空闲端口，并统一通过 ConfigManager::set_result 输出包含 web_url 的标准 JSON 并落盘日志。",
  "repository": {
    "path": "/home/xyf/orca/CodeBridge_CLI/0.0.1",
    "revision": "8321944aeda2d85aa9a94ff4230bcf63b98a952e",
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
      "purpose": "提供 JSON 保存、JSON 加载、参数结构体序列化和反序列化四个静态关联函数。配置目录固定为主程序所在目录/config/；业务参数结构体由各模块自行定义和持有。保留每个主程序进程一个实例的单例约束，对外无需先获取实例。",
      "language": "Rust",
      "codeLocation": "src/common/config.rs",
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
        "项目使用 Rust 实现；对外仅提供 save_json、load_json、serialize、deserialize 四个静态关联函数，不增加获取实例或业务参数管理接口。",
        "配置文件保存为当前运行主程序所在目录/config/*.json；从主程序可执行文件路径确定目录，不使用启动命令所在目录，也不在定位失败时回退到其他目录。",
        "各业务模块自行定义并持有自己的参数结构体；本模块不集中保存、缓存或解释各业务模块的参数。",
        "save_json 和 load_json 仅负责 JSON 文本与配置文件之间的读写；serialize 和 deserialize 仅负责参数结构体与 JSON 文本之间的转换。",
        "调用方为 serialize 传入支持 serde::Serialize 的参数结构体，为 deserialize 指定支持 serde::de::DeserializeOwned 的目标类型 T；反序列化成功时返回 T。",
        "文件名由调用模块明确传入；只允许 config 目录下的 .json 配置文件，拒绝绝对路径和越出配置目录的路径。首次保存时创建缺少的 config 目录。",
        "加载文件缺失、文件读写失败、JSON 转换失败都返回错误；是否使用默认参数由调用模块决定，本模块不替业务模块生成默认值。",
        "提供 set_result 与 get_result 静态关联函数：集中托管命令返回值，并在 set_result 中通过布尔开关控制控制台屏幕打印，自动触发 Logger 日志落盘。"
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
          "purpose": "静态关联函数：设定当前命令的标准返回值结构体，自动调用 Logger 记录日志，并根据布尔开关决定是否打印到控制台屏幕。",
          "flow": "保存返回值 -> 自动调用 Logger 记录日志 -> 根据 print_screen 布尔开关决定是否通过 println! 打印标准 JSON。",
          "errors": "日志写入失败或序列化异常返回 Err(ConfigError)。",
          "status": "planned",
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
      "codeLocation": "src/common/logger.rs",
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
        "方法约束：对外仅提供 log_error、log_debug、log_warn、log_info 4 个单例方法，不提供其他方法。"
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
      "purpose": "Mutagen Local 主程序总入口（Cobra 根命令），提供 daemon、sync、forward、project 等子命令，输出标准 JSON 状态供外部调用。",
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
      "status": "planned",
      "sources": [],
      "unknowns": [],
      "requirements": [
        "提供 daemon 子命令：管理Local后台守护管家启停与状态查询。",
        "提供 sync 子命令：管理项目双向文件同步生命周期（create/list/flush/pause/resume/terminate）。",
        "提供 forward 子命令：管理反向端口映射生命周期（create/list/pause/resume/terminate）。",
        "提供 project 子命令：基于 mutagen.yml 一键编排并启停全部同步与端口会话。",
        "所有查询命令支持 --template '{{json .}}' 输出机器可读的标准 JSON 格式。"
      ],
      "dependencies": [],
      "parameters": [],
      "structures": [],
      "interfaces": [
        {
          "id": "method-cli-execute",
          "name": "执行 Mutagen 命令",
          "englishName": "ExecuteCommand",
          "purpose": "调用 Mutagen 根命令执行指定子命令并捕获标准输出或 JSON 结果。",
          "flow": "解析参数数组 -> 分发到对应子命令 -> 返回标准输出或格式化 JSON 文本。",
          "errors": "命令不存在或执行失败返回 error 与退出码。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-cli-args",
              "name": "参数数组",
              "englishName": "args",
              "type": "[]string",
              "description": "命令行参数切片，如 [sync, list, --template, {{json .}}]。",
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
              "description": "标准输出捕获文本。",
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
        }
      ]
    },
    {
      "id": "module-mutagen-agent",
      "name": "Mutagen VPS 代理总入口",
      "englishName": "MutagenAgent",
      "purpose": "Mutagen 跑在 VPS 上的轻量临时小助手总入口，随 SSH 管道在VPS内存中自动自驱动，全自动处理文件落盘与Local回路端口监听。",
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
      "status": "planned",
      "sources": [],
      "unknowns": [],
      "requirements": [
        "随 SSH 管道由 Local 自动推送至 VPS 并在内存中临时运行，零手动安装与环境依赖。",
        "集成 synchronizer 逻辑，在 VPS 目标目录执行文件落盘与修改扫描。",
        "集成 forwarder 逻辑，在 VPS Local开出 TCP 回路端口监听并引流回 SSH 数据流。",
        "SSH 会话断开或任务终止时自动干净退出，零进程与文件残留。"
      ],
      "dependencies": [],
      "parameters": [],
      "structures": [],
      "interfaces": [
        {
          "id": "method-agent-run",
          "name": "运行VPS代理服务",
          "englishName": "RunAgent",
          "purpose": "接管 SSH stdin/stdout 流并响应同步落盘与端口监听请求。",
          "flow": "监听 stdio 数据流 -> 协调工作区与端口监听 -> 通道断开时优雅注销。",
          "errors": "通信通道中断正常退出。",
          "status": "planned",
          "sources": [],
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
              "description": "退出状态码，正常为 0。",
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
          "steps": "启动代理并模拟通道关闭。",
          "expected": "干净退出且无多余后台进程残留。"
        }
      ]
    },
    {
      "id": "module-codebridge-local",
      "name": "Local 业务主程序",
      "englishName": "CodeBridgeLocal",
      "purpose": "Local 客户端业务主程序。负责解析Local命令行参数、管理项目配置、打通至 VPS 的 SSH 通道、驱动 Mutagen Local命令行执行文件同步与端口反向映射，并将统一返回值存入 ConfigManager。",
      "language": "Rust",
      "codeLocation": "src/local/main.rs",
      "groupId": "group-679f7997-02f7-419d-b8a9-50719242faa9",
      "x": 2780,
      "y": 1350,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "planned",
      "sources": [],
      "unknowns": [],
      "requirements": [
        "命令行参数解析：使用 clap 解析子命令（start_codebridge、stop_bridge、query_status、add_forward）与独立参数。",
        "参数继承与增量覆盖：每次启动优先使用命令行传入的参数；未传入的参数自动读取Local配置文件补齐；支持传入部分参数实现增量更新覆盖。",
        "首次无配置防御报错：启动时如果既没有输入参数，Local又没有历史配置文件，直接报错拒绝盲启动，提示用户提供必要参数。",
        "启动成功自动持久化：桥接任务启动成功后，自动将本次生效的完整参数持久化保存到Local配置文件，供下次启动直接复用。",
        "单连接通道铁律：Local 到目标 VPS 有且仅保持 1 条连接通道，所有同步与端口映射均复用该通道，不建立重复物理连接。",
        "驱动底层 Mutagen：作为父进程调用 MutagenCli，stdout 捕获 JSON，stderr 管道重定向至 Logger。",
        "统一返回值收口：操作完成后统一调用 ConfigManager::set_result，控制是否打印屏幕，自动记入文件日志。"
      ],
      "dependencies": [
        "ConfigManager::set_result / ConfigManager::get_result",
        "Logger::log_info / Logger::log_error",
        "MutagenCli"
      ],
      "parameters": [],
      "structures": [],
      "interfaces": [
        {
          "id": "method-local-dispatch",
          "name": "命令总调度",
          "englishName": "dispatch",
          "purpose": "命令行总调度入口。接收并解析命令行独立参数，分发调用启动、停止、查状态、加端口等具体业务方法，并调用 set_result 统一收口输出。",
          "flow": "解析输入命令行参数 -> 匹配子命令 -> 路由调用对应具体业务方法 -> 统一通过 set_result 打印屏幕与记日志。",
          "errors": "未知命令或参数不全时设置错误码并输出。",
          "status": "planned",
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
          "purpose": "支持参数继承、增量覆盖与零参数启动：优先使用命令行传入参数，未传参数自动读取Local配置文件补齐；启动成功后自动将最新参数持久化保存供下次直接复用；既无输入参数又无配置文件时明确报错。",
          "flow": "1. 参数合并：读取命令行输入参数，未传参数尝试通过 ConfigManager::load_json 读取配置文件补齐；\n2. 防御校验：若无输入且无配置文件，返回错误并提示提供必要参数；\n3. 驱动启动：使用有效参数调起同步与端口映射，VPS自动分配 10000+ 可用端口；\n4. 保存记忆：启动成功后自动调用 ConfigManager::save_json 将最新有效参数保存到配置文件；\n5. 统一收口：调用 ConfigManager::set_result 输出包含 web_url 的标准 JSON 结果并记日志。",
          "errors": "既无输入参数又无配置文件、Local路径不存在、SSH 无法连通、或端口已被占用时返回错误。",
          "status": "planned",
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
              "description": "Local 电脑上正在运行的网页服务端口，默认 3000。",
              "required": false,
              "defaultValue": "3000"
            },
            {
              "id": "p-start-vps-ip",
              "name": "VPS IP",
              "englishName": "vps_ip",
              "type": "Option<&str>",
              "description": "VPS VPS 服务器的 IP 地址，默认取已配置的 IP。",
              "required": false,
              "defaultValue": ""
            },
            {
              "id": "p-start-local-path",
              "name": "项目目录",
              "englishName": "local_path",
              "type": "Option<&Path>",
              "description": "Local 电脑上的项目代码根目录，默认当前目录。",
              "required": false,
              "defaultValue": "."
            },
            {
              "id": "p-start-vps-path",
              "name": "VPS目录",
              "englishName": "vps_path",
              "type": "Option<&str>",
              "description": "VPS 上的代码同步保存目录，默认自动推导为 '~/codebridge/<目录名>'，也支持显式指定。",
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
              "description": "包含 web_url (如 http://127.0.0.1:10086)、web_port、vps_port 与同步状态的 CommandResult 对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-local-stop-bridge",
          "name": "停止桥接",
          "englishName": "stop_bridge",
          "purpose": "默认零参数安全停止当前目录对应项目的同步与端口映射任务，释放VPS端口，保留两端磁盘文件。",
          "flow": "读取当前工作目录推导项目 -> 终止对应同步与端口会话 -> 释放VPS端口 -> 返回成功结果。",
          "errors": "项目不存在或未在运行返回错误。",
          "status": "planned",
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
          "flow": "读取当前工作目录推导项目 -> 向底层查询会话状态 -> 解析连接、同步进度与端口清单 -> 组装状态对象并返回。",
          "errors": "未找到指定项目返回错误。",
          "status": "planned",
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
          "flow": "校验Local网页端口 -> VPS自动在 10000+ 随机分配可用端口 -> 动态调用底层发起端口映射 -> 返回新端口 web_url。",
          "errors": "Local端口未启动或VPS端口被占用返回错误。",
          "status": "planned",
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
        }
      ]
    },
    {
      "id": "module-codebridge-vps",
      "name": "VPS 业务主程序",
      "englishName": "CodeBridgeVPS",
      "purpose": "VPS VPS服务端主程序。负责在VPS管理项目资源独占登记，校验防止多台 Local 电脑或多个项目产生目录与端口冲突；配合VPS Agent 提供状态汇报与健康检查。",
      "language": "Rust",
      "codeLocation": "src/vps/main.rs",
      "groupId": "group-0c1d02ac-36eb-4750-b3fc-0f51ae7cc54d",
      "x": 2770,
      "y": 140,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "planned",
      "sources": [],
      "unknowns": [],
      "requirements": [
        "命令行参数解析：使用 clap 解析子命令（start_vps、stop_vps、inspect_status 等）与独立参数，默认支持零参数运行。",
        "VPS服务生命周期：start_vps 初始化VPS台账并待命；stop_vps 释放全部VPS 10000+ 端口、清退临时台账并安全退出。",
        "多主机单通道承载：同时对接多台 Local，但与每台 Local 间严格保持 1 条连接通道，按主机身份隔离资源。",
        "资源独占登记：以 ResourceRecord 记录各 Local 绑定的VPS目录 vps_path 与端口，校验并拒绝相同或重叠目录冲突。",
        "零参数状态巡检：inspect_status 默认零参数探测 VPS Local回路端口连通性，向 AI Agent 返回包含 web_url 的结构化状态。",
        "统一配置与日志：复用公共层 ConfigManager 与 Logger，记录VPS操作日志与资源台账。",
        "VPS服务命名：启动支持传入 --name 参数自定义 VPS 后台服务进程名称；若未指定，自动随机生成 5 到 10 位纯英文字母作为进程名称。"
      ],
      "dependencies": [
        "ConfigManager::set_result / ConfigManager::get_result",
        "Logger::log_info / Logger::log_error",
        "MutagenAgent"
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
          "flow": "解析命令行参数 -> 分发到对应业务方法 -> 统一通过 set_result 打印屏幕与记日志。",
          "errors": "未知命令或参数不全时输出错误。",
          "status": "planned",
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
          "purpose": "启动VPS服务：支持传入 --name 指定VPS进程名（未指定时自动随机生成 5 到 10 位纯英文字母），初始化VPS资源总台账，检查 ~/codebridge/ 根目录环境，进入就绪待命状态。",
          "flow": "检查并生成/应用VPS进程名称 -> 初始化资源台账 -> 检查并创建根工作区环境 -> 进入后台监听待命 -> 返回成功状态。",
          "errors": "环境异常或初始化失败返回错误。",
          "status": "planned",
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
              "description": "可选的自定义VPS后台服务进程名称；未指定时自动随机生成 5 到 10 位纯英文字母。",
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
              "description": "包含服务就绪标识的标准响应对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        },
        {
          "id": "method-vps-stop",
          "name": "停止 VPS 服务",
          "englishName": "stop_vps",
          "purpose": "默认零参数停止VPS服务：释放全部占用的 10000+ 端口，清退临时台账记录，安全退出，保持文件完好。",
          "flow": "扫描当前所有活跃台账 -> 逐一释放占用的VPS端口 -> 清空台账缓存 -> 退出服务。",
          "errors": "停止异常返回错误。",
          "status": "planned",
          "sources": [],
          "unknowns": [],
          "inputsConfirmed": true,
          "outputsConfirmed": true,
          "inputs": [
            {
              "id": "p-vps-stop-all",
              "name": "停止全部",
              "englishName": "all",
              "type": "Option<bool>",
              "description": "是否清退全部台账与端口，默认 true。",
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
          "purpose": "默认零参数检查当前目录的工作区代码与Local回路端口连通性，并在 CommandResult.data 中返回 web_url 供 AI Agent 直接调试。",
          "flow": "读取当前工作区路径 -> 探测Local回路端口建立连接 -> 汇总并返回包含 web_url 的健康结果。",
          "errors": "目录不存在或端口不可达返回状态说明。",
          "status": "planned",
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
          "flow": "校验路径重叠与端口占用 -> 登记台账 -> 保存并返回确认信息。",
          "errors": "路径已被其他项目占用或端口冲突时返回错误。",
          "status": "planned",
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
              "description": "可选的指定端口号；未指定时自动在 10000+ 随机分配。",
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
          "purpose": "默认零参数解除当前目录的独占绑定，释放对应VPS端口，保持文件完好。",
          "flow": "核对当前目录身份 -> 撤销台账独占记录 -> 保留实际磁盘文件。",
          "errors": "未曾登记或身份不符返回错误。",
          "status": "planned",
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
        }
      ]
    }
  ],
  "relations": [
    {
      "id": "relation-024d2e97-0259-4243-aeb8-2e0591a3fa0f",
      "from": "module-codebridge-vps",
      "to": "module-mutagen-agent",
      "label": "",
      "status": "planned",
      "sources": [],
      "unknowns": [],
      "fromPort": "right",
      "toPort": "left"
    },
    {
      "id": "relation-69dd4812-0f81-4f36-904c-e08d5780c0d4",
      "from": "module-codebridge-local",
      "to": "module-mutagen-cli",
      "label": "",
      "status": "planned",
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
