globalThis.softwareArchitecture = {
  "formatVersion": 1,
  "id": "project-template",
  "name": "CodeBridge CLI",
  "englishName": "codebridge-cli",
  "description": "项目使用 Rust 实现。为 Windows、Linux、macOS 设计主程序与 Agent Skill。主程序以后台服务运行，同一套可执行程序提供 local/vps 两种角色及命令入口。Local 主动通过 SSH 连接 VPS；一台 VPS 管理多个 Local，每台 Local 管理多个项目；Local 与项目共同确定操作范围。项目目录双向同步，本机项目服务由用户自行启动，将本机端口转发到 VPS 供远端 Agent 调试。两端 Agent 经配套 Skill 调用主程序，控制 CodeBridge 服务、连接、同步、映射并读取 JSON 状态与日志。VPS 目录独占，拒绝相同或重叠根目录；项目资源分别管理。该图基于已确认需求记录计划中的软件架构；业务代码尚未实现，接口入参与出参细节尚未逐项确认。",
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
      "x": 2100,
      "y": 2160
    },
    {
      "id": "group-679f7997-02f7-419d-b8a9-50719242faa9",
      "name": "Local",
      "englishName": "Local",
      "color": "#ffffff",
      "backgroundColor": "#559c80",
      "x": 2410,
      "y": 710
    },
    {
      "id": "group-0c1d02ac-36eb-4750-b3fc-0f51ae7cc54d",
      "name": "VPS",
      "englishName": "VPS",
      "color": "#ffffff",
      "backgroundColor": "#ad884f",
      "x": 2400,
      "y": 80
    },
    {
      "id": "group-0cb11cc3-b58d-4551-90c7-2ac347d32ba7",
      "name": "Mutagen Local",
      "englishName": "MutagenLocal",
      "color": "#ffffff",
      "backgroundColor": "#559c80",
      "x": 3360,
      "y": 720
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
      "codeLocation": "",
      "groupId": "group-e4af7b0a-c2f1-48a1-a84e-5a98653a56c0",
      "x": 2120,
      "y": 2220,
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
        "加载文件缺失、文件读写失败、JSON 转换失败都返回错误；是否使用默认参数由调用模块决定，本模块不替业务模块生成默认值。"
      ],
      "dependencies": [
        "Rust std::env::current_exe：取得主程序路径，确定其所在目录下的 config/。",
        "Rust std::fs：读取和保存 UTF-8 JSON 文本。",
        "serde::Serialize / serde::de::DeserializeOwned：业务模块参数结构体的序列化与反序列化约定。",
        "serde_json::to_string / serde_json::from_str：结构体与 JSON 文本转换。"
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
      "x": 2620,
      "y": 2220,
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
      "purpose": "Mutagen 本地主程序总入口（Cobra 根命令），提供 daemon、sync、forward、project 等子命令，输出标准 JSON 状态供外部调用。",
      "language": "Go",
      "codeLocation": "depends/mutagen/cmd/mutagen/main.go",
      "groupId": "group-0cb11cc3-b58d-4551-90c7-2ac347d32ba7",
      "x": 3380,
      "y": 780,
      "appearance": {
        "textColor": "#17254d",
        "backgroundColor": "#fcfdff",
        "headerColor": "#f4f7ff"
      },
      "status": "planned",
      "sources": [],
      "unknowns": [],
      "requirements": [
        "提供 daemon 子命令：管理本地后台守护管家启停与状态查询。",
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
      "name": "Mutagen 远端代理总入口",
      "englishName": "MutagenAgent",
      "purpose": "Mutagen 跑在 VPS 上的轻量临时小助手总入口，随 SSH 管道在云端内存中自动自驱动，全自动处理文件落盘与本地回路端口监听。",
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
        "集成 forwarder 逻辑，在 VPS 本地开出 TCP 回路端口监听并引流回 SSH 数据流。",
        "SSH 会话断开或任务终止时自动干净退出，零进程与文件残留。"
      ],
      "dependencies": [],
      "parameters": [],
      "structures": [],
      "interfaces": [
        {
          "id": "method-agent-run",
          "name": "运行远端代理服务",
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
    }
  ],
  "relations": [],
  "view": {
    "x": -45.79862315643402,
    "y": 110.49092828226264,
    "scale": 0.20138859487980282,
    "expanded": [],
    "expandedInterfaces": []
  }
};
