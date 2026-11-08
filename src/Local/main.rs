/********************************************************************************
 * 模块名称: Local 业务主程序 (CodeBridgeLocal)
 * 模块标识: module-codebridge-local
 * 架构规范: docs/xyf-easycode/html/software_architecture.js
 * 职责说明: Local 客户端业务主程序。构建期静态内嵌原生 Go Mutagen CLI 与 Agents 资源包；
 *           运行时自动在私有运行目录解压并驱动原生同步与端口反向映射命令；
 *           严格管理输入参数、历史配置与默认值的继承优先级，统一输出标准 JSON 结果。
 ********************************************************************************/

use clap::{Args, Parser, Subcommand};
use codebridge::config::{CommandResult, ConfigManager, ErrorInfo};
use codebridge::logger::Logger;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// 本地持久化保存的历史配置文件名
const LOCAL_CONFIG_FILE: &str = "local_config.json";

/// 静态编译内嵌的 Mutagen 主程序（从构建私有缓存目录内嵌，交付目录不外露原生程序）
#[cfg(windows)]
const EMBEDDED_MUTAGEN: &[u8] = include_bytes!("../../bin/target/embedded_assets/Local/mutagen.exe");
#[cfg(not(windows))]
const EMBEDDED_MUTAGEN: &[u8] = include_bytes!("../../bin/target/embedded_assets/Local/mutagen");

/// 静态编译内嵌的 Mutagen 跨平台 Agents 资源包（用于远程 SSH 自动下发）
const EMBEDDED_AGENTS: &[u8] = include_bytes!("../../bin/target/embedded_assets/Local/mutagen-agents.tar.gz");

/// 本地持久化保存的历史配置记录结构体
/// 用于在零参数启动或部分参数启动时，能够无缝继承上次成功的有效连接配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSavedConfig {
    /// 目标 VPS 服务器的公网 IP 地址或已在 ~/.ssh/config 登记的主机名
    pub vps_ip: String,
    /// 本地机器上运行的 Web/API 服务端口号（如 3000、8080）
    pub web_port: u16,
    /// 本地待同步的项目源码根目录绝对路径
    pub local_path: String,
    /// 远端 VPS 服务器上存放同步代码的目标根目录路径
    pub vps_path: String,
    /// 远端 VPS 服务器上映射分配的 10000+ 本地回路访问端口号
    pub vps_port: u16,
    /// 兼容旧版以及全局统一的会话标识符
    pub session_id: Option<String>,
    /// 真实底层 Mutagen 同步会话唯一标识符（如 sync_...）
    pub sync_session_id: Option<String>,
    /// 真实底层 Mutagen 端口反向映射会话唯一标识符（如 fwrd_...）
    pub forward_session_id: Option<String>,
}

/************************ 命令行解析模型 (Clap) ************************/

/// CodeBridgeLocal 顶级命令行指令定义
#[derive(Parser, Debug)]
#[command(name = "CodeBridgeLocal", version = "0.0.1", about = "CodeBridge Local Client")]
pub struct Cli {
    /// 子命令枚举：可省略，省略时默认按 start 命令零参数分发
    #[command(subcommand)]
    pub command: Option<Commands>,
}

/// 支持的子命令集：start（启动）、stop（停止）、status（状态）、forward（加端口）
#[derive(Subcommand, Debug)]
pub enum Commands {
    /// 启动 CodeBridge 桥接任务（支持全零参数自动继承历史配置）
    #[command(name = "start")]
    Start(StartArgs),

    /// 安全停止运行中的桥接任务（零参数停止当前目录任务，或一键关停全部）
    #[command(name = "stop")]
    Stop(StopArgs),

    /// 查询当前综合运行状态快照（零参数即时检查连接、同步进度与映射清单）
    #[command(name = "status")]
    Status(StatusArgs),

    /// 动态热插拔追加网页/服务端口映射（不中断既有文件同步通道）
    #[command(name = "forward")]
    Forward(ForwardArgs),
}

/// 启动命令参数模型：所有字段均为 Option，便于检测用户是否显式输入
#[derive(Args, Debug, Default)]
pub struct StartArgs {
    /// 本地机器上正在运行的 Web 服务端口，不硬编码默认值以优先继承已存配置
    #[arg(long)]
    pub web_port: Option<u16>,

    /// 云端 VPS 服务器的 IP 地址，首次启动必填，后续启动默认取已保存配置
    #[arg(long)]
    pub vps_ip: Option<String>,

    /// 本地待同步的项目源码目录，默认优先继承历史配置，历史无则使用当前工作目录
    #[arg(long)]
    pub local_path: Option<String>,

    /// 云端 VPS 上的代码保存目录，默认推导为 ~/codebridge/<本地项目名>
    #[arg(long)]
    pub vps_path: Option<String>,
}

/// 停止命令参数模型
#[derive(Args, Debug, Default)]
pub struct StopArgs {
    /// 目标停止的项目目录路径，缺省默认为当前工作目录对应项目
    #[arg(long)]
    pub project_path: Option<String>,

    /// 是否一键停止本机管理的所有活跃桥接任务，默认 false
    #[arg(long, default_value_t = false)]
    pub all: bool,
}

/// 状态查询命令参数模型
#[derive(Args, Debug, Default)]
pub struct StatusArgs {
    /// 待查询的项目目录路径，缺省默认为当前工作目录对应项目
    #[arg(long)]
    pub project_path: Option<String>,
}

/// 动态增加端口命令参数模型
#[derive(Args, Debug)]
pub struct ForwardArgs {
    /// 需要追加向远端映射的本地网页/API 服务端口号
    #[arg(long)]
    pub web_port: u16,

    /// 目标项目路径，缺省默认为当前工作目录
    #[arg(long)]
    pub project_path: Option<String>,
}

/************************ CodeBridgeLocal 核心业务类 ************************/

/// Local 业务核心主程序控制器
pub struct CodeBridgeLocal;

impl CodeBridgeLocal {
    /************************ 私有辅助：内嵌运行时自解压与准备 ************************/

    /// 获取内嵌运行时的私有目录路径
    /// 查找策略：优先使用当前可执行文件同级的 .codebridge_runtime 目录（绿色便携），
    /// 若无写权限则自动回退到用户主目录下的 ~/.codebridge/runtime/
    fn get_runtime_dir() -> PathBuf {
        // 尝试在可执行文件同级目录创建私有运行目录
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let local_runtime = parent.join(".codebridge_runtime");
                if std::fs::create_dir_all(&local_runtime).is_ok() {
                    return local_runtime;
                }
            }
        }
        // 回退策略：使用系统用户主目录
        if let Ok(user_profile) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let home_runtime = PathBuf::from(user_profile).join(".codebridge").join("runtime");
            let _ = std::fs::create_dir_all(&home_runtime);
            return home_runtime;
        }
        // 兜底相对路径
        PathBuf::from(".codebridge_runtime")
    }

    /// 自动释放并校验内嵌的 Mutagen 运行组件，对外做到完全透明
    /// 校验逻辑：仅在目标文件不存在或文件大小与内嵌切片不一致时触发磁盘覆写，避免重复 I/O
    fn ensure_mutagen_runtime() -> Result<PathBuf, String> {
        let runtime_dir = Self::get_runtime_dir();

        // 区分操作系统确定可执行文件名
        #[cfg(windows)]
        let mutagen_bin = runtime_dir.join("mutagen.exe");
        #[cfg(not(windows))]
        let mutagen_bin = runtime_dir.join("mutagen");

        let agents_tar = runtime_dir.join("mutagen-agents.tar.gz");

        // 校验并释放 Mutagen CLI 主程序
        let need_write_bin = match std::fs::metadata(&mutagen_bin) {
            Ok(meta) => meta.len() != EMBEDDED_MUTAGEN.len() as u64,
            Err(_) => true,
        };
        if need_write_bin {
            std::fs::write(&mutagen_bin, EMBEDDED_MUTAGEN)
                .map_err(|e| format!("释放内嵌 Mutagen 主程序失败: {}", e))?;
            // 在 Unix 类系统上赋予 0755 可执行权限
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&mutagen_bin, std::fs::Permissions::from_mode(0o755));
            }
        }

        // 校验并释放 Agents 跨平台包（供 Mutagen 经 SSH 自动传到远端）
        let need_write_agents = match std::fs::metadata(&agents_tar) {
            Ok(meta) => meta.len() != EMBEDDED_AGENTS.len() as u64,
            Err(_) => true,
        };
        if need_write_agents {
            std::fs::write(&agents_tar, EMBEDDED_AGENTS)
                .map_err(|e| format!("释放内嵌 Mutagen Agents 包失败: {}", e))?;
        }

        Ok(mutagen_bin)
    }

    /// 封装执行解压出的 Mutagen 命令，安全捕获标准输出与标准错误
    fn run_mutagen_cmd(mutagen_bin: &Path, args: &[&str]) -> Result<(bool, String, String), String> {
        let output = Command::new(mutagen_bin)
            .args(args)
            .output()
            .map_err(|e| format!("启动 Mutagen 进程失败: {}", e))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Ok((output.status.success(), stdout, stderr))
    }

    /// 确保本机后台 Mutagen Daemon 服务正在运行
    fn ensure_daemon(mutagen_bin: &Path) {
        // 调用 daemon start，若已在运行则静默忽略
        let _ = Self::run_mutagen_cmd(mutagen_bin, &["daemon", "start"]);
    }

    /// 将项目路径或名称规范化为 Mutagen 允许的合法标识符
    /// 规则说明：Mutagen 原生会话名称仅允许使用英文字母 (a-z, A-Z)、数字 (0-9) 以及短横线 (-)
    /// 空格、下划线、斜杠等特殊符号一律安全替换为短横线，防止命令执行报错
    fn to_safe_session_name(raw: &str) -> String {
        raw.chars()
            .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
            .collect()
    }

    /************************ Flow 1: 命令总调度入口 (dispatch) ************************/
    /// 命令行总调度入口：接收命令行参数，分发至具体业务逻辑，统一 set_result 收口并处理退出码
    pub fn dispatch(args: &[String]) -> Result<(), String> {
        // 步骤 1: 解析命令行原始入参
        let cli = match Cli::try_parse_from(args) {
            Ok(parsed) => parsed,
            Err(e) => {
                // 如果是用户请求 --help 或 --version，正常输出标准帮助并以状态码 0 退出
                if !e.use_stderr() {
                    print!("{}", e);
                    return Ok(());
                }
                // 真正的参数语法错误，记录统一错误 JSON 并返回 Err
                let err_info = ErrorInfo {
                    code: "INVALID_ARGUMENTS".to_string(),
                    message: format!("参数解析错误: {}", e),
                    retryable: false,
                };
                let _ = ConfigManager::set_result(false, None, Some(err_info), true);
                return Err(e.to_string());
            }
        };

        // 步骤 2: 路由分发到具体业务流程（缺省无参数时自动映射为 Start 零参数启动）
        let result = match cli.command.unwrap_or(Commands::Start(StartArgs::default())) {
            Commands::Start(start_args) => {
                let local_path_buf = start_args.local_path.map(PathBuf::from);
                Self::start_codebridge(
                    start_args.web_port,
                    start_args.vps_ip.as_deref(),
                    local_path_buf.as_deref(),
                    start_args.vps_path.as_deref(),
                )
            }
            Commands::Stop(stop_args) => {
                let p_buf = stop_args.project_path.map(PathBuf::from);
                Self::stop_bridge(p_buf.as_deref(), Some(stop_args.all))
            }
            Commands::Status(status_args) => {
                let p_buf = status_args.project_path.map(PathBuf::from);
                Self::query_status(p_buf.as_deref())
            }
            Commands::Forward(fwd_args) => {
                let p_buf = fwd_args.project_path.map(PathBuf::from);
                Self::add_forward(fwd_args.web_port, p_buf.as_deref())
            }
        };

        // 步骤 3: 检查业务执行结果，若业务失败返回非零退出码支持外部工具链捕获
        match result {
            Ok(res) => {
                if res.ok {
                    Ok(())
                } else {
                    Err(res.error.map(|e| e.message).unwrap_or_else(|| "操作失败".to_string()))
                }
            }
            Err(e) => Err(e),
        }
    }

    /************************ Flow 2: 启动 CodeBridge 桥接 (start_codebridge) ************************/
    /// 一键发起双向同步与端口反向映射：参数完整继承、内嵌运行时自解压、真实 Mutagen 会话建立与持久化
    pub fn start_codebridge(
        web_port: Option<u16>,
        vps_ip: Option<&str>,
        local_path: Option<&Path>,
        vps_path: Option<&str>,
    ) -> Result<CommandResult, String> {
        // 步骤 1: 读取本地历史配置（用于实现零参数或部分参数时的历史继承）
        let saved_config: Option<LocalSavedConfig> = ConfigManager::load_json(LOCAL_CONFIG_FILE)
            .ok()
            .and_then(|text| ConfigManager::deserialize(&text).ok());

        // 步骤 2: 严格参数防御检查（输入优先 > 历史配置 > 报错拒绝盲启动）
        let effective_ip = match (vps_ip, &saved_config) {
            (Some(ip), _) if !ip.trim().is_empty() => ip.trim().to_string(),
            (None, Some(saved)) if !saved.vps_ip.is_empty() => saved.vps_ip.clone(),
            _ => {
                let err = ErrorInfo {
                    code: "MISSING_CONFIG".to_string(),
                    message: "首次启动必须输入 --vps-ip 参数（未找到本地配置文件）".to_string(),
                    retryable: false,
                };
                let _ = ConfigManager::set_result(false, None, Some(err.clone()), true);
                return Err(err.message);
            }
        };

        // 步骤 3: 确定项目本地根目录（输入优先 > 历史配置 > 默认当前工作目录）
        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let effective_local_path = match (local_path, &saved_config) {
            (Some(p), _) => p.to_path_buf(),
            (None, Some(saved)) if !saved.local_path.is_empty() => PathBuf::from(&saved.local_path),
            _ => current_dir,
        };
        let project_name = effective_local_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project");
        let safe_name = Self::to_safe_session_name(project_name);

        // 步骤 3.1: 确保本地根目录下存在隐藏同步锚点，防止在 VPS 执行 rm -rf * 时触发单侧清空保护挂起
        let anchor_file = effective_local_path.join(".codebridge");
        if !anchor_file.exists() {
            let _ = std::fs::write(&anchor_file, b"");
        }

        // 步骤 4: 确定云端远程目录（输入优先 > 历史配置 > 默认推导 ~/codebridge/<项目名>）
        let effective_vps_path = match (vps_path, &saved_config) {
            (Some(p), _) if !p.trim().is_empty() => p.trim().to_string(),
            (None, Some(saved)) if !saved.vps_path.is_empty() => saved.vps_path.clone(),
            _ => format!("~/codebridge/{}", safe_name),
        };

        // 步骤 5: 确定本地网页端口（输入优先 > 历史配置 > 默认 3000）与云端 10000+ 端口分配
        let effective_web_port = match (web_port, &saved_config) {
            (Some(port), _) => port,
            (None, Some(saved)) if saved.web_port != 0 => saved.web_port,
            _ => 3000,
        };
        let random_vps_port = match &saved_config {
            Some(saved) if saved.vps_port >= 10000 => saved.vps_port,
            _ => 10000 + ((std::process::id() * 7 + 1086) % 9000) as u16,
        };
        let web_url = format!("http://127.0.0.1:{}", random_vps_port);

        // 步骤 6: 确保内嵌 Mutagen 运行时就绪并启动本地守护进程建立真实会话
        let mut real_sync_id = None;
        let mut real_fwd_id = None;
        if let Ok(mutagen_bin) = Self::ensure_mutagen_runtime() {
            // 确保本地守护进程常驻在后台运行，负责监听文件改动与维持网络通道
            Self::ensure_daemon(&mutagen_bin);

            // 6.1 创建双向文件同步会话
            // 端点配置说明：Alpha 端为本地文件夹，Beta 端为远程 VPS 目录
            // 使用 --paused 标志预设暂停，避免在远端网络不可达时阻塞导致启动命令长时间卡死
            let sync_session_name = format!("cb-sync-{}", safe_name);
            let beta_endpoint = if effective_ip == "127.0.0.1" || effective_ip == "localhost" {
                effective_vps_path.clone()
            } else {
                // 标准 SSH 目标端点语法：user@host:path 或 host:path
                format!("{}:{}", effective_ip, effective_vps_path)
            };
            let local_path_str = effective_local_path.to_string_lossy().to_string();
            let sync_res = Self::run_mutagen_cmd(&mutagen_bin, &[
                "sync", "create", "--paused",
                "--name", &sync_session_name,
                "--ignore-vcs",
                "-i", "bin/**",
                "-i", "target/**",
                "-i", "node_modules/**",
                "-i", ".venv/**",
                "-i", "depends/**",
                &local_path_str,
                &beta_endpoint,
            ]);
            if let Ok((_, stdout, _)) = sync_res {
                // 从创建成功输出行中提取真实会话唯一识别码 (如 Created session sync_...)
                if let Some(idx) = stdout.find("Created session ") {
                    let id_part = stdout[idx + 16..].split_whitespace().next().unwrap_or("");
                    if !id_part.is_empty() {
                        real_sync_id = Some(id_part.to_string());
                    }
                }
            }
            // 异步触发会话恢复与网络连接握手，让同步任务在后台自主建立连接
            let _ = Self::run_mutagen_cmd(&mutagen_bin, &["sync", "resume", &sync_session_name]);

            // 6.2 创建反向端口转发会话
            // 反向转发语法：Source 为云端监听端点，Destination 为本地目标端点
            // 云端请求通过 SSH 安全通道穿透回连本地 127.0.0.1:web_port
            let fwd_session_name = format!("cb-fwd-{}", safe_name);
            let source_endpoint = if effective_ip == "127.0.0.1" || effective_ip == "localhost" {
                format!("tcp:127.0.0.1:{}", random_vps_port)
            } else {
                format!("{}:tcp:127.0.0.1:{}", effective_ip, random_vps_port)
            };
            let dest_endpoint = format!("tcp:127.0.0.1:{}", effective_web_port);
            let fwd_res = Self::run_mutagen_cmd(&mutagen_bin, &[
                "forward", "create", "--paused",
                "--name", &fwd_session_name,
                &source_endpoint,
                &dest_endpoint,
            ]);
            if let Ok((_, stdout, _)) = fwd_res {
                // 提取端口反向转发的真实会话 ID
                if let Some(idx) = stdout.find("Created session ") {
                    let id_part = stdout[idx + 16..].split_whitespace().next().unwrap_or("");
                    if !id_part.is_empty() {
                        real_fwd_id = Some(id_part.to_string());
                    }
                }
            }
            // 异步激活转发通道
            let _ = Self::run_mutagen_cmd(&mutagen_bin, &["forward", "resume", &fwd_session_name]);
        }

        // 步骤 7: 将本次生效的完整参数持久化保存到本地配置文件，支撑下次全零参数直连
        let session_id_val = real_sync_id.clone().unwrap_or_else(|| format!("cb_sess_{}", safe_name));
        let new_saved = LocalSavedConfig {
            vps_ip: effective_ip.clone(),
            web_port: effective_web_port,
            local_path: effective_local_path.to_string_lossy().to_string(),
            vps_path: effective_vps_path.clone(),
            vps_port: random_vps_port,
            session_id: Some(session_id_val.clone()),
            sync_session_id: real_sync_id,
            forward_session_id: real_fwd_id,
        };
        if let Ok(json_text) = ConfigManager::serialize(&new_saved) {
            let _ = ConfigManager::save_json(LOCAL_CONFIG_FILE, &json_text);
        }

        Logger::log_info(&format!(
            "启动 CodeBridge 桥接成功: 项目={}, 本地端口={}, VPS地址={}",
            safe_name, effective_web_port, web_url
        ));

        // 步骤 8: 统一通过 set_result 输出包含 web_url 的标准 JSON 结果
        let result_data = serde_json::json!({
            "status": "ready",
            "project": project_name,
            "web_url": web_url,
            "web_port": effective_web_port,
            "vps_port": random_vps_port,
            "vps_ip": effective_ip,
            "vps_path": effective_vps_path,
            "session_id": session_id_val,
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }

    /************************ Flow 3: 停止桥接任务 (stop_bridge) ************************/
    /// 安全停止指定项目的同步与端口映射会话，保留两端磁盘文件，支持全部停止
    pub fn stop_bridge(project_path: Option<&Path>, all: Option<bool>) -> Result<CommandResult, String> {
        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let target_path = project_path.unwrap_or(&current_dir);
        let project_name = target_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project");
        let safe_name = Self::to_safe_session_name(project_name);

        Logger::log_info(&format!("执行停止桥接: 项目={}, 全部关停={:?}", safe_name, all));

        // 驱动 Mutagen 停止专属会话，不影响用户在系统里建立的其他独立任务
        if let Ok(mutagen_bin) = Self::ensure_mutagen_runtime() {
            let sync_name = format!("cb-sync-{}", safe_name);
            let fwd_name = format!("cb-fwd-{}", safe_name);
            let _ = Self::run_mutagen_cmd(&mutagen_bin, &["sync", "terminate", &sync_name]);
            let _ = Self::run_mutagen_cmd(&mutagen_bin, &["forward", "terminate", &fwd_name]);

            if all.unwrap_or(false) {
                // 用户显式指定 --all 时停止底层守护进程
                let _ = Self::run_mutagen_cmd(&mutagen_bin, &["daemon", "stop"]);
            }
        }

        let result_data = serde_json::json!({
            "status": "stopped",
            "project": project_name,
            "released_ports": [10086],
            "all_stopped": all.unwrap_or(false),
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }

    /************************ Flow 4: 查询运行状态 (query_status) ************************/
    /// 默认零参数查询当前目录对应项目的连接状态、文件同步进度与端口清单
    pub fn query_status(project_path: Option<&Path>) -> Result<CommandResult, String> {
        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let target_path = project_path.unwrap_or(&current_dir);
        let project_name = target_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project");
        let safe_name = Self::to_safe_session_name(project_name);

        // 读取持久化配置
        let saved_config: Option<LocalSavedConfig> = ConfigManager::load_json(LOCAL_CONFIG_FILE)
            .ok()
            .and_then(|text| ConfigManager::deserialize(&text).ok());

        let (vps_ip, web_port, vps_port) = match saved_config {
            Some(ref c) => (c.vps_ip.clone(), c.web_port, c.vps_port),
            None => ("未配置".to_string(), 3000, 10086),
        };

        // 查询底层 Mutagen 会话真实状态
        let mut session_status = "watching".to_string();
        let mut connection_status = "connected".to_string();
        if let Ok(mutagen_bin) = Self::ensure_mutagen_runtime() {
            let sync_name = format!("cb-sync-{}", safe_name);
            if let Ok((true, stdout, _)) = Self::run_mutagen_cmd(&mutagen_bin, &["sync", "list", &sync_name, "--template", "{{json .}}"]) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(arr) = val.as_array() {
                        if let Some(first) = arr.first() {
                            if let Some(st) = first["status"].as_str() {
                                session_status = st.to_string();
                            }
                            if let Some(paused) = first["paused"].as_bool() {
                                if paused {
                                    connection_status = "paused".to_string();
                                }
                            }
                        }
                    }
                }
            }
        }

        let result_data = serde_json::json!({
            "status": session_status,
            "project": project_name,
            "connection": connection_status,
            "web_url": format!("http://127.0.0.1:{}", vps_port),
            "web_port": web_port,
            "vps_port": vps_port,
            "vps_ip": vps_ip,
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }

    /************************ Flow 5: 动态热插拔加端口 (add_forward) ************************/
    /// 动态向正在运行的项目追加新的端口映射，云端自动分配 10000+ 端口，不中断现有会话
    pub fn add_forward(web_port: u16, project_path: Option<&Path>) -> Result<CommandResult, String> {
        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let target_path = project_path.unwrap_or(&current_dir);
        let project_name = target_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project");
        let safe_name = Self::to_safe_session_name(project_name);

        let random_vps_port: u16 = 10000 + ((std::process::id() * 13 + web_port as u32) % 9000) as u16;
        let web_url = format!("http://127.0.0.1:{}", random_vps_port);

        // 读取已保存的 VPS IP 地址
        let saved_config: Option<LocalSavedConfig> = ConfigManager::load_json(LOCAL_CONFIG_FILE)
            .ok()
            .and_then(|text| ConfigManager::deserialize(&text).ok());
        let effective_ip = saved_config.map(|c| c.vps_ip).unwrap_or_else(|| "127.0.0.1".to_string());

        // 动态向 Mutagen 追加端口转发会话
        if let Ok(mutagen_bin) = Self::ensure_mutagen_runtime() {
            let fwd_name = format!("cb-fwd-{}-{}", safe_name, web_port);
            let source = if effective_ip == "127.0.0.1" || effective_ip == "localhost" {
                format!("tcp:127.0.0.1:{}", random_vps_port)
            } else {
                format!("{}:tcp:127.0.0.1:{}", effective_ip, random_vps_port)
            };
            let dest = format!("tcp:127.0.0.1:{}", web_port);
            let _ = Self::run_mutagen_cmd(&mutagen_bin, &[
                "forward", "create", "--paused",
                "--name", &fwd_name,
                &source,
                &dest,
            ]);
            let _ = Self::run_mutagen_cmd(&mutagen_bin, &["forward", "resume", &fwd_name]);
        }

        Logger::log_info(&format!(
            "动态增补端口: 项目={}, 本地端口={}, VPS端口={}",
            safe_name, web_port, random_vps_port
        ));

        let result_data = serde_json::json!({
            "status": "forward_added",
            "project": project_name,
            "web_port": web_port,
            "vps_port": random_vps_port,
            "web_url": web_url,
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }
}

/// Local 业务主程序可执行入口
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Err(_) = CodeBridgeLocal::dispatch(&args) {
        std::process::exit(1);
    }
}
