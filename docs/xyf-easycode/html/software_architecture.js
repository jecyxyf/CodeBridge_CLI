globalThis.softwareArchitecture = {
  "formatVersion": 1,
  "id": "project-template",
  "name": "CodeBridge CLI",
  "englishName": "codebridge-cli",
  "description": "CodeBridge 是为远程开发与硬件联调设计的轻量命令行与 AI Skill 外壳，主程序采用 Rust 实现，底层零改动复用 Mutagen 的 Go 核心总入口。Local 与 VPS 之间严格保持唯一单连接通道，多项目多端口复用传输。业务全面支持 AI Agent（Skill）与人类零参数调用：执行 start_codebridge 自动将当前目录同步到云端同名目录，本地网页端口（默认 3000）自动映射至云端 10000+ 随机空闲端口，并统一通过 ConfigManager::set_result 输出包含 web_url 的标准 JSON 并落盘日志。",
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
      "x": 2750,
      "y": 2280
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
      "x": 3340,
      "y": 1180
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
      "id": "module-ee5fc9ea-a9a9-45c3-ba16-e1e531120767",
      "name": "日志模块",
      "englishName": "Logger",
      "purpose": "单例记录主程序运行日志。首次调用自动初始化，按天写入应用程序目录/logs/yyyy_mm_dd.log，最多保留90天并自动翻滚清理。对外仅提供4个单例日志方法。",
      "language": "Rust",
      "codeLocation": "src/common/logger.rs",
      "groupId": "group-e4af7b0a-c2f1-48a1-a84e-5a98653a56c0",
      "x": 3350,
      "y": 2340,
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
      "x": 3360,
      "y": 1240,
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
    },
    {
      "id": "module-codebridge-local",
      "name": "CodeBridgeLocal",
      "englishName": "CodeBridgeLocal",
      "purpose": "Local 客户端业务主程序。负责解析本地命令行参数、管理项目配置、打通至 VPS 的 SSH 通道、驱动 Mutagen 本地命令行执行文件同步与端口反向映射，并将统一返回值存入 ConfigManager。",
      "language": "Rust",
      "codeLocation": "src/local/main.rs",
      "groupId": "group-679f7997-02f7-419d-b8a9-50719242faa9",
      "x": 2770,
      "y": 1240,
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
        "极致零参数体验：启动、停止、查状态默认全支持零参数运行，自动以当前目录为基准推导项目并联动 VPS。",
        "单连接通道铁律：Local 到目标 VPS 有且仅保持 1 条连接通道，所有同步与端口映射均复用该通道，不建立重复物理连接。",
        "目录与端口自适应：支持显式指定 local_path 与 vps_path，未指定时默认当前目录与 ~/codebridge/<目录名>；网页端口 web_port 默认 3000，云端 VPS 端口自动在 10000+ 随机分配空闲端口，返回包含 web_url (如 http://127.0.0.1:10086) 供 AI Agent 直接调试。",
        "动态热插拔端口：支持通过 add_forward 随时追加新的网页端口映射，云端自动分配 10000+ 端口，原同步与网络任务完全不中断。",
        "驱动底层 Mutagen：作为父进程调用 MutagenCli，stdout 捕获 JSON，stderr 管道重定向至 Logger。",
        "统一返回值收口：操作完成后统一调用 ConfigManager::set_result，控制是否打印屏幕，自动记入文件日志。"
      ],
      "dependencies": [
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
          "purpose": "极简发起双向文件同步与端口反向映射：支持传入本地目录与远端目录（默认推导为 ~/codebridge/<目录名>），网页端口默认 3000，云端 VPS 端口自动在 10000+ 分配并在返回值中提供 web_url。",
          "flow": "解析本地目录与远端目录 -> 网页端口默认 3000 -> 从 10000+ 随机分配可用 VPS 端口 -> 驱动 Mutagen 同步与端口映射 -> 返回包含 web_url 的标准 CommandResult 对象。",
          "errors": "本地路径不存在、SSH 无法连通、或端口已被占用时返回错误。",
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
              "description": "云端 VPS 服务器的 IP 地址，默认取已配置的 IP。",
              "required": false,
              "defaultValue": ""
            },
            {
              "id": "p-start-local-path",
              "name": "本地目录",
              "englishName": "local_path",
              "type": "Option<&Path>",
              "description": "Local 电脑上的项目代码根目录，默认当前目录。",
              "required": false,
              "defaultValue": "."
            },
            {
              "id": "p-start-vps-path",
              "name": "远端目录",
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
          "purpose": "默认零参数安全停止当前目录对应项目的同步与端口映射任务，释放云端端口，保留两端磁盘文件。",
          "flow": "读取当前工作目录推导项目 -> 终止对应同步与端口会话 -> 释放云端端口 -> 返回成功结果。",
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
          "purpose": "为当前目录项目动态追加映射端口：只需输入本地网页端口，云端端口自动在 10000+ 随机分配，不中断现有任务。",
          "flow": "校验本地网页端口 -> 云端自动在 10000+ 随机分配可用端口 -> 动态调用底层发起端口映射 -> 返回新端口 web_url。",
          "errors": "本地端口未启动或云端端口被占用返回错误。",
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
              "description": "包含新增映射会话与云端访问地址的标准响应对象。",
              "required": true,
              "defaultValue": ""
            }
          ]
        }
      ],
      "events": [],
      "tests": [
        {
          "id": "test-local-zero-param-lifecycle",
          "name": "零参数完整生命周期测试",
          "englishName": "ZeroParamBridgeLifecycle",
          "steps": "在测试目录下依次执行 start_codebridge（零参数）、query_status（零参数）、stop_bridge（零参数）。",
          "expected": "全流程无需任何参数，自动识别目录并完成启动、状态查询与安全停止。"
        },
        {
          "id": "test-local-dynamic-forward-single-param",
          "name": "单参数动态加端口测试",
          "englishName": "SingleParamDynamicForward",
          "steps": "在运行项目中仅传入 --web-port 8080 执行 add_forward。",
          "expected": "自动在云端 10000+ 开出新端口并返回 web_url，原同步完全不中断。"
        },
        {
          "id": "test-local-dispatch",
          "name": "命令总调度与收口测试",
          "englishName": "CommandDispatchTest",
          "steps": "传入命令行参数执行 dispatch。",
          "expected": "正确路由到对应业务方法并调用 set_result 输出统一 JSON。"
        }
      ]
    },
    {
      "id": "module-codebridge-vps",
      "name": "CodeBridgeVPS",
      "englishName": "CodeBridgeVPS",
      "purpose": "VPS 云端服务端主程序。负责在云端管理项目资源独占登记，校验防止多台 Local 电脑或多个项目产生目录与端口冲突；配合远端 Agent 提供状态汇报与健康检查。",
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
        "云端服务生命周期：start_vps 初始化云端台账并待命；stop_vps 释放全部云端 10000+ 端口、清退临时台账并安全退出。",
        "多主机单通道承载：同时对接多台 Local，但与每台 Local 间严格保持 1 条连接通道，按主机身份隔离资源。",
        "资源独占登记：以 ResourceRecord 记录各 Local 绑定的远端目录 vps_path 与端口，校验并拒绝相同或重叠目录冲突。",
        "零参数状态巡检：inspect_status 默认零参数探测 VPS 本地回路端口连通性，向 AI Agent 返回包含 web_url 的结构化状态。",
        "统一配置与日志：复用公共层 ConfigManager 与 Logger，记录云端操作日志与资源台账。",
        "云端服务命名：启动支持传入 --name 参数自定义 VPS 后台服务进程名称；若未指定，自动随机生成 5 到 10 位纯英文字母作为进程名称。"
      ],
      "dependencies": [
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
          "purpose": "启动云端服务：支持传入 --name 指定云端进程名（未指定时自动随机生成 5 到 10 位纯英文字母），初始化云端资源总台账，检查 ~/codebridge/ 根目录环境，进入就绪待命状态。",
          "flow": "检查并生成/应用云端进程名称 -> 初始化资源台账 -> 检查并创建根工作区环境 -> 进入后台监听待命 -> 返回成功状态。",
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
              "description": "可选的自定义云端后台服务进程名称；未指定时自动随机生成 5 到 10 位纯英文字母。",
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
          "purpose": "默认零参数停止云端服务：释放全部占用的 10000+ 端口，清退临时台账记录，安全退出，保持文件完好。",
          "flow": "扫描当前所有活跃台账 -> 逐一释放占用的云端端口 -> 清空台账缓存 -> 退出服务。",
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
          "purpose": "默认零参数检查当前目录的工作区代码与本地回路端口连通性，并在 CommandResult.data 中返回 web_url 供 AI Agent 直接调试。",
          "flow": "读取当前工作区路径 -> 探测本地回路端口建立连接 -> 汇总并返回包含 web_url 的健康结果。",
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
          "purpose": "原子校验并登记指定 Local 主机的云端同步目录和监听端口，重叠冲突时拒绝。",
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
          "purpose": "默认零参数解除当前目录的独占绑定，释放对应云端端口，保持文件完好。",
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
          "name": "云端目录与端口冲突校验测试",
          "englishName": "VpsDirectoryAndPortConflictTest",
          "steps": "两个不同 Local 主机先后申请同一目录或相同端口。",
          "expected": "第二个申请被明确拒绝，原主机登记与文件完好保持。"
        },
        {
          "id": "test-vps-custom-name-start",
          "name": "VPS 指定进程名启动测试",
          "englishName": "VpsCustomProcessNameStart",
          "steps": "传入 --name MyCloudVps 调用 start_vps。",
          "expected": "云端后台服务以 MyCloudVps 名称启动运行。"
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
    "x": -252.3094400858257,
    "y": 63.38807981571438,
    "scale": 0.2886561967981973,
    "expanded": [],
    "expandedInterfaces": []
  }
};
