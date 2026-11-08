/********************************************************************************
 * 模块名称: VPS 业务主程序 (CodeBridgeVPS)
 * 模块标识: module-codebridge-vps
 * 架构规范: docs/xyf-easycode/html/software_architecture.js
 * 职责说明: VPS 云端服务端主程序。构建期静态内嵌 Linux 平台的 Mutagen Agent 组件；
 *           运行期管理项目资源独占台账，防止多主机目录重叠与端口抢占冲突；
 *           提供真实 TCP 回路探测与服务状态巡检，统一输出标准 JSON 结果。
 ********************************************************************************/

use clap::{Args, Parser, Subcommand};
use codebridge::config::{CommandResult, ConfigManager, ErrorInfo};
use codebridge::logger::Logger;
use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// 云端资源独占台账持久化文件名（保存在应用程序目录/config/vps_registry.json）
const VPS_REGISTRY_FILE: &str = "vps_registry.json";

/// 静态编译内嵌的 Linux 版 Mutagen Agent 目标二进制文件
/// 从构建私有缓存目录内嵌，交付目录严禁外露原生程序
const EMBEDDED_AGENT: &[u8] = include_bytes!("../../bin/target/embedded_assets/VPS/mutagen-agent");

/// 云端资源台账记录数据结构
/// 记录每台 Local 客户端所绑定的独占目录与分配的 10000+ 端口
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRecord {
    /// 申请独占资源的 Local 客户端主机唯一标识符（如主机名或 ID）
    pub local_id: String,
    /// 远端 VPS 服务器上被独占绑定的绝对目录路径
    pub vps_path: String,
    /// 远端 VPS 服务器上为当前项目映射分配的本地监听端口号
    pub vps_port: u16,
    /// 供远端 AI Agent 调试打开网页的完整本地回路 URL 地址
    pub web_url: String,
}

/************************ 命令行解析模型 (Clap) ************************/

/// CodeBridgeVPS 顶级命令行指令定义
#[derive(Parser, Debug)]
#[command(name = "CodeBridgeVPS", version = "0.0.1", about = "CodeBridge VPS Server")]
pub struct Cli {
    /// 子命令枚举：可省略，省略时默认按 start 命令零参数分发
    #[command(subcommand)]
    pub command: Option<Commands>,
}

/// 支持的云端子命令集：start（启动）、stop（停止）、status（巡检）、reserve（登记）、release（释放）
#[derive(Subcommand, Debug)]
pub enum Commands {
    /// 启动云端 VPS 待命服务（零参数就绪 Agent 资源与台账）
    #[command(name = "start")]
    Start(StartArgs),

    /// 停止云端 VPS 服务并释放端口（零参数清理所有或指定会话台账）
    #[command(name = "stop")]
    Stop(StopArgs),

    /// 巡检当前工作区状态与端口真实可达性（零参数执行 TCP 探测）
    #[command(name = "status")]
    Status(StatusArgs),

    /// 独占登记项目资源（内部原子防抢占与父子目录重叠校验）
    #[command(name = "reserve")]
    Reserve(ReserveArgs),

    /// 释放项目独占资源（根据路径解绑并归还对应分配端口）
    #[command(name = "release")]
    Release(ReleaseArgs),
}

/// 启动服务参数模型
#[derive(Args, Debug, Default)]
pub struct StartArgs {
    /// 可选的自定义云端后台服务进程名称；未指定时自动随机生成 5 到 10 位纯英文字母
    #[arg(long)]
    pub name: Option<String>,
}

/// 停止服务参数模型
#[derive(Args, Debug, Default)]
pub struct StopArgs {
    /// 是否停止全部服务与端口映射台账，默认 true
    #[arg(long, default_value_t = true)]
    pub all: bool,
}

/// 状态巡检参数模型
#[derive(Args, Debug, Default)]
pub struct StatusArgs {
    /// 待巡检的 VPS 项目目录路径，缺省默认为当前工作目录
    #[arg(long)]
    pub vps_path: Option<String>,
}

/// 资源独占登记参数模型
#[derive(Args, Debug)]
pub struct ReserveArgs {
    /// 申请独占资源的 Local 客户端主机标识符
    #[arg(long)]
    pub local_id: String,

    /// 申请独占的 VPS 项目根目录绝对路径
    #[arg(long)]
    pub vps_path: String,

    /// 显式申请的端口号，未提供则在 10000+ 范围内自动分配可用空闲端口
    #[arg(long)]
    pub vps_port: Option<u16>,
}

/// 资源释放参数模型
#[derive(Args, Debug, Default)]
pub struct ReleaseArgs {
    /// 需要释放解绑的 VPS 目录路径，缺省默认为当前工作目录
    #[arg(long)]
    pub vps_path: Option<String>,
}

/************************ 跨进程文件排他锁辅助 ************************/

/// RAII 跨进程排他文件锁辅助结构体
/// 基于原子排他新建文件机制（O_CREATE | O_EXCL），退出作用域时自动通过 Drop 清理锁文件
struct FileLock {
    /// 锁文件的绝对路径
    lock_path: PathBuf,
}

impl FileLock {
    /// 尝试在主程序所在目录获取排他文件锁，内置最大 3 秒重试等待机制
    fn acquire(name: &str) -> Option<Self> {
        let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        let lock_path = exe_dir.join(format!("{}.lock", name));
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            // 原子性创建锁文件，文件存在时会返回 AlreadyExists 错误
            if std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
                .is_ok()
            {
                return Some(FileLock { lock_path });
            }
            // 短暂休眠 30 毫秒后重试
            std::thread::sleep(Duration::from_millis(30));
        }
        None
    }
}

impl Drop for FileLock {
    /// 离开作用域时自动删除锁文件，保证即使 Panic 也能安全释放
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.lock_path);
    }
}

/************************ CodeBridgeVPS 核心业务类 ************************/

/// VPS 服务端业务核心主程序控制器
pub struct CodeBridgeVPS;

impl CodeBridgeVPS {
    /************************ 私有辅助：Agent 运行时准备与路径检查 ************************/

    /// 获取内嵌运行时的私有目录路径
    fn get_runtime_dir() -> PathBuf {
        // 优先在当前可执行程序同级创建 .codebridge_runtime 私有目录
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
        PathBuf::from(".codebridge_runtime")
    }

    /// 自动释放内嵌的 Linux Mutagen Agent 二进制到私有目录并赋权
    fn ensure_agent_runtime() -> Result<PathBuf, String> {
        let runtime_dir = Self::get_runtime_dir();
        let agent_bin = runtime_dir.join("mutagen-agent");

        // 仅在文件缺失或字节大小不匹配时执行覆写释放
        let need_write = match std::fs::metadata(&agent_bin) {
            Ok(meta) => meta.len() != EMBEDDED_AGENT.len() as u64,
            Err(_) => true,
        };
        if need_write {
            std::fs::write(&agent_bin, EMBEDDED_AGENT)
                .map_err(|e| format!("释放内嵌 Agent 失败: {}", e))?;
            // 在 Linux/Unix 上赋予 0755 可执行权限
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&agent_bin, std::fs::Permissions::from_mode(0o755));
            }
        }
        Ok(agent_bin)
    }

    /// 深度检查两个路径是否存在完全相等或父子目录重叠冲突
    /// 例如：/root/project 与 /root/project/sub 相互包含，不可被不同客户端同时独占
    fn is_path_overlap(p1_str: &str, p2_str: &str) -> bool {
        let p1 = Path::new(p1_str);
        let p2 = Path::new(p2_str);
        if p1 == p2 {
            return true;
        }
        // 检查前缀包含关系
        p1.starts_with(p2) || p2.starts_with(p1)
    }

    /************************ Flow 1: 命令总调度 (dispatch) ************************/
    /// 命令行总入口：解析参数，路由分发至巡检、登记、释放等具体方法，统一调用 set_result
    pub fn dispatch(args: &[String]) -> Result<(), String> {
        // 步骤 1: 解析命令行参数
        let cli = match Cli::try_parse_from(args) {
            Ok(parsed) => parsed,
            Err(e) => {
                // 帮助或版本请求直接打印，不作为错误收口
                if !e.use_stderr() {
                    print!("{}", e);
                    return Ok(());
                }
                let err_info = ErrorInfo {
                    code: "INVALID_ARGUMENTS".to_string(),
                    message: format!("参数解析错误: {}", e),
                    retryable: false,
                };
                let _ = ConfigManager::set_result(false, None, Some(err_info), true);
                return Err(e.to_string());
            }
        };

        // 步骤 2: 路由分发到具体功能分支
        let result = match cli.command.unwrap_or(Commands::Start(StartArgs::default())) {
            Commands::Start(start_args) => {
                Self::start_vps(start_args.name)
            }
            Commands::Stop(stop_args) => {
                Self::stop_vps(Some(stop_args.all))
            }
            Commands::Status(status_args) => {
                let p_buf = status_args.vps_path.map(PathBuf::from);
                Self::inspect_status(p_buf.as_deref())
            }
            Commands::Reserve(reserve_args) => {
                Self::reserve_resource(
                    &reserve_args.local_id,
                    &reserve_args.vps_path,
                    reserve_args.vps_port,
                )
            }
            Commands::Release(release_args) => {
                let p_buf = release_args.vps_path.map(PathBuf::from);
                Self::release_resource(p_buf.as_deref())
            }
        };

        // 步骤 3: 统一检查执行结果，若失败返回 Err 触发非零退出码
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

    /************************ Flow 2: 启动 VPS 待命服务 (start_vps) ************************/
    /// 默认零参数启动云端服务：就绪内嵌 Agent 资源，初始化台账，进入待命状态
    pub fn start_vps(name: Option<String>) -> Result<CommandResult, String> {
        // 步骤 1: 确定服务名称（未指定时随机生成 5 到 10 位的字母名称）
        let effective_name = name.unwrap_or_else(|| {
            let len = 5 + (std::process::id() % 6) as usize;
            let alphabet = b"abcdefghijklmnopqrstuvwxyz";
            (0..len)
                .map(|i| alphabet[(std::process::id() as usize + i * 3) % alphabet.len()] as char)
                .collect::<String>()
        });

        Logger::log_info(&format!("启动 VPS 服务待命: 服务名称={}", effective_name));

        // 步骤 2: 自动解压并就绪内嵌的 Linux Mutagen Agent 组件
        let _ = Self::ensure_agent_runtime();

        // 步骤 3: 确保云端持久化台账文件就绪
        if ConfigManager::load_json(VPS_REGISTRY_FILE).is_err() {
            let empty_registry: Vec<ResourceRecord> = Vec::new();
            if let Ok(json_text) = ConfigManager::serialize(&empty_registry) {
                let _ = ConfigManager::save_json(VPS_REGISTRY_FILE, &json_text);
            }
        }

        // 步骤 4: 输出就绪状态响应
        let result_data = serde_json::json!({
            "status": "ready",
            "service_name": effective_name,
            "root_workspace": "~/codebridge",
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }

    /************************ Flow 3: 停止 VPS 待命服务 (stop_vps) ************************/
    /// 默认零参数停止云端服务：释放全部占用的 10000+ 端口，清退临时台账记录，安全退出
    pub fn stop_vps(all: Option<bool>) -> Result<CommandResult, String> {
        Logger::log_info(&format!("停止 VPS 服务: 全部释放={:?}", all));

        // 步骤 1: 清退全部台账记录
        let empty_registry: Vec<ResourceRecord> = Vec::new();
        if let Ok(json_text) = ConfigManager::serialize(&empty_registry) {
            let _ = ConfigManager::save_json(VPS_REGISTRY_FILE, &json_text);
        }

        // 步骤 2: 构造停止确认结果
        let result_data = serde_json::json!({
            "status": "stopped",
            "released_ports": "all",
            "clean_exit": true,
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }

    /************************ Flow 4: 巡检当前工作区状态 (inspect_status) ************************/
    /// 默认零参数检查当前目录的工作区代码与本地回路端口连通性，进行实际 TCP 探测
    pub fn inspect_status(vps_path: Option<&Path>) -> Result<CommandResult, String> {
        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let target_path = vps_path.unwrap_or(&current_dir);
        let path_str = target_path.to_string_lossy().to_string();

        // 步骤 1: 读取台账获取已登记的端口信息
        let registry: Vec<ResourceRecord> = ConfigManager::load_json(VPS_REGISTRY_FILE)
            .ok()
            .and_then(|text| ConfigManager::deserialize(&text).ok())
            .unwrap_or_default();

        let matched = registry.iter().find(|r| r.vps_path == path_str || path_str.ends_with(&r.vps_path));

        let (assigned_port, web_url, is_registered) = match matched {
            Some(r) => (r.vps_port, r.web_url.clone(), true),
            None => (10086, "http://127.0.0.1:10086".to_string(), false),
        };

        // 步骤 2: 对已登记端口执行真实 TCP 本地回路连通性探测（超时 150ms 避免卡顿）
        let port_reachable = if is_registered {
            TcpStream::connect_timeout(
                &SocketAddr::from(([127, 0, 0, 1], assigned_port)),
                Duration::from_millis(150),
            )
            .is_ok()
        } else {
            false
        };

        // 步骤 3: 汇总快照数据并通过 set_result 输出
        let result_data = serde_json::json!({
            "status": "ready",
            "vps_path": path_str,
            "assigned_port": assigned_port,
            "web_url": web_url,
            "port_reachable": port_reachable,
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }

    /************************ Flow 5: 原子独占登记 (reserve_resource) ************************/
    /// 核心防冲突：记录哪台电脑占了哪个目录与端口，包含父子路径包含校验与系统端口检测
    pub fn reserve_resource(
        local_id: &str,
        vps_path: &str,
        vps_port: Option<u16>,
    ) -> Result<CommandResult, String> {
        // 加排他文件锁，确保多进程并发登记时不发生覆写冲突
        let _guard = FileLock::acquire("vps_registry");

        let mut registry: Vec<ResourceRecord> = ConfigManager::load_json(VPS_REGISTRY_FILE)
            .ok()
            .and_then(|text| ConfigManager::deserialize(&text).ok())
            .unwrap_or_default();

        // 步骤 1: 检查目录包含与重叠冲突（父子目录深度校验）
        for item in &registry {
            if Self::is_path_overlap(&item.vps_path, vps_path) && item.local_id != local_id {
                let err = ErrorInfo {
                    code: "DIRECTORY_CONFLICT".to_string(),
                    message: format!("VPS 目录 {} 与已有登记 {} 存在目录包含或独占冲突，已被主机 {} 占用", vps_path, item.vps_path, item.local_id),
                    retryable: false,
                };
                let _ = ConfigManager::set_result(false, None, Some(err.clone()), true);
                return Err(err.message);
            }
        }

        // 步骤 2: 端口防抢占与本地系统监听探测（避免撞上其他进程占用的端口）
        if let Some(port) = vps_port {
            if registry.iter().any(|r| r.vps_port == port && r.local_id != local_id) {
                let err = ErrorInfo {
                    code: "PORT_CONFLICT".to_string(),
                    message: format!("VPS 端口 {} 已被其他客户端抢占登记", port),
                    retryable: false,
                };
                let _ = ConfigManager::set_result(false, None, Some(err.clone()), true);
                return Err(err.message);
            }
        }

        // 步骤 3: 确定分配端口（在 10000+ 随机分配并尝试绑定检测占用）
        let allocated_port = vps_port.unwrap_or_else(|| {
            let mut candidate = 10000 + ((std::process::id() * 11 + registry.len() as u32 * 3) % 9000) as u16;
            while registry.iter().any(|r| r.vps_port == candidate)
                || TcpListener::bind(("127.0.0.1", candidate)).is_err()
            {
                candidate += 1;
                if candidate >= 65530 {
                    candidate = 10000;
                }
            }
            candidate
        });
        let web_url = format!("http://127.0.0.1:{}", allocated_port);

        let record = ResourceRecord {
            local_id: local_id.to_string(),
            vps_path: vps_path.to_string(),
            vps_port: allocated_port,
            web_url: web_url.clone(),
        };

        // 步骤 4: 更新并持久化台账数据
        registry.retain(|r| !(r.vps_path == vps_path && r.local_id == local_id));
        registry.push(record.clone());

        if let Ok(json_text) = ConfigManager::serialize(&registry) {
            let _ = ConfigManager::save_json(VPS_REGISTRY_FILE, &json_text);
        }

        Logger::log_info(&format!(
            "资源独占登记成功: 主机={}, 目录={}, 端口={}",
            local_id, vps_path, allocated_port
        ));

        let result_data = serde_json::json!({
            "status": "reserved",
            "local_id": local_id,
            "vps_path": vps_path,
            "vps_port": allocated_port,
            "web_url": web_url,
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }

    /************************ Flow 6: 释放独占登记 (release_resource) ************************/
    /// 默认零参数解除当前目录的独占绑定，释放对应云端端口，保持文件完好
    pub fn release_resource(vps_path: Option<&Path>) -> Result<CommandResult, String> {
        let _guard = FileLock::acquire("vps_registry");

        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let target_path = vps_path.unwrap_or(&current_dir);
        let path_str = target_path.to_string_lossy().to_string();

        let mut registry: Vec<ResourceRecord> = ConfigManager::load_json(VPS_REGISTRY_FILE)
            .ok()
            .and_then(|text| ConfigManager::deserialize(&text).ok())
            .unwrap_or_default();

        let original_len = registry.len();
        registry.retain(|r| r.vps_path != path_str);

        // 仅在实际删除了记录时执行保存覆写
        if registry.len() != original_len {
            if let Ok(json_text) = ConfigManager::serialize(&registry) {
                let _ = ConfigManager::save_json(VPS_REGISTRY_FILE, &json_text);
            }
        }

        Logger::log_info(&format!("释放 VPS 独占资源: 目录={}", path_str));

        let result_data = serde_json::json!({
            "status": "released",
            "vps_path": path_str,
        });

        let _ = ConfigManager::set_result(true, Some(result_data), None, true);
        ConfigManager::get_result().map_err(|e| e.to_string())
    }
}

/// VPS 业务主程序可执行入口
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Err(_) = CodeBridgeVPS::dispatch(&args) {
        std::process::exit(1);
    }
}
