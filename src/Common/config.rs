/********************************************************************************
 * 模块名称: 配置参数模块 (ConfigManager)
 * 模块标识: module-05d74c5b-bdc8-4da4-a97d-c7ec5d67643d
 * 架构规范: docs/xyf-easycode/html/software_architecture.js
 * 职责说明: 提供 JSON 保存、JSON 加载、参数结构体序列化和反序列化四个静态关联函数；
 *           提供 set_result 与 get_result 统一返回值收口与屏幕打印控制；
 *           配置文件固定保存在主程序所在目录/config/ 下。
 ********************************************************************************/

use crate::logger::Logger;
use once_cell::sync::Lazy;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write as IoWrite;
use std::path::PathBuf;
use std::sync::Mutex;

/// 全局暂存的命令返回值单例容器
static CURRENT_RESULT: Lazy<Mutex<Option<CommandResult>>> = Lazy::new(|| Mutex::new(None));

/************************ 数据结构定义 ************************/

/// 配置接口错误结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigError {
    /// 错误类别（如 PathError、IoError、SerdeError、NotFoundError）
    pub kind: String,
    /// 供调用方理解与处理的具体错误原因说明
    pub message: String,
    /// 文件读写错误对应的配置路径；纯内存转换错误时为空
    pub file_path: Option<PathBuf>,
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}]: {}", self.kind, self.message)
    }
}

impl std::error::Error for ConfigError {}

/// 全局统一的机器可读命令响应信封
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    /// 命令是否被正确处理
    pub ok: bool,
    /// 命令执行成功时的结构化业务数据内容
    pub data: Option<serde_json::Value>,
    /// 命令失败时的错误码、可理解原因及重试建议
    pub error: Option<ErrorInfo>,
}

/// 统一错误详情结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorInfo {
    /// 机器可读的稳定错误识别码（如 PORT_IN_USE、MISSING_CONFIG）
    pub code: String,
    /// 通俗易懂、脱敏后的错误原因说明
    pub message: String,
    /// 是否建议调用方沿用原参数直接重试
    pub retryable: bool,
}

/************************ 核心功能实现 ************************/

/// 配置参数核心管理器（全静态关联函数）
pub struct ConfigManager;

impl ConfigManager {
    /// 私有辅助函数：解析主程序所在目录下的 config/ 绝对路径
    fn get_config_dir() -> Result<PathBuf, ConfigError> {
        let exe_dir = std::env::current_exe()
            .map_err(|e| ConfigError {
                kind: "PathError".to_string(),
                message: format!("无法定位主程序可执行文件位置: {}", e),
                file_path: None,
            })?
            .parent()
            .ok_or_else(|| ConfigError {
                kind: "PathError".to_string(),
                message: "无法获取主程序所在父目录".to_string(),
                file_path: None,
            })?
            .to_path_buf();
        Ok(exe_dir.join("config"))
    }

    /// 私有辅助函数：校验文件名合法性，禁止路径穿越并强制要求 .json 后缀
    fn resolve_config_file_path(file_name: &str) -> Result<PathBuf, ConfigError> {
        if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
            return Err(ConfigError {
                kind: "InvalidFileName".to_string(),
                message: "配置文件名不允许包含路径分隔符或跨越目录的相对路径".to_string(),
                file_path: None,
            });
        }
        if !file_name.ends_with(".json") {
            return Err(ConfigError {
                kind: "InvalidFileName".to_string(),
                message: "配置文件必须具有 .json 后缀".to_string(),
                file_path: None,
            });
        }
        let config_dir = Self::get_config_dir()?;
        Ok(config_dir.join(file_name))
    }

    /************************ Flow 1: 保存 JSON 文本到配置文件 ************************/
    /// 静态关联函数：将调用方提供的 JSON 文本原子保存到 config/*.json
    pub fn save_json(file_name: &str, json_text: &str) -> Result<(), ConfigError> {
        let target_path = Self::resolve_config_file_path(file_name)?;
        let config_dir = target_path.parent().unwrap();

        // 首次保存时如果 config 目录缺失则自动创建
        if !config_dir.exists() {
            fs::create_dir_all(config_dir).map_err(|e| ConfigError {
                kind: "IoError".to_string(),
                message: format!("创建配置目录 {:?} 失败: {}", config_dir, e),
                file_path: Some(config_dir.to_path_buf()),
            })?;
        }

        // 使用临时文件写入再原子重命名，防止写入中断损坏旧配置
        let temp_path = config_dir.join(format!("{}.tmp.{}", file_name, std::process::id()));
        let mut temp_file = File::create(&temp_path).map_err(|e| ConfigError {
            kind: "IoError".to_string(),
            message: format!("创建临时配置文件 {:?} 失败: {}", temp_path, e),
            file_path: Some(temp_path.clone()),
        })?;

        temp_file.write_all(json_text.as_bytes()).map_err(|e| ConfigError {
            kind: "IoError".to_string(),
            message: format!("写入临时配置文件失败: {}", e),
            file_path: Some(temp_path.clone()),
        })?;
        temp_file.flush().map_err(|e| ConfigError {
            kind: "IoError".to_string(),
            message: format!("刷新文件缓存失败: {}", e),
            file_path: Some(temp_path.clone()),
        })?;

        // 原子覆盖重命名
        fs::rename(&temp_path, &target_path).map_err(|e| ConfigError {
            kind: "IoError".to_string(),
            message: format!("重命名覆盖配置文件 {:?} 失败: {}", target_path, e),
            file_path: Some(target_path),
        })?;

        Ok(())
    }

    /************************ Flow 2: 从配置文件读取 JSON 文本 ************************/
    /// 静态关联函数：从 config/*.json 读取原始 UTF-8 JSON 文本
    pub fn load_json(file_name: &str) -> Result<String, ConfigError> {
        let file_path = Self::resolve_config_file_path(file_name)?;
        if !file_path.exists() {
            return Err(ConfigError {
                kind: "NotFound".to_string(),
                message: format!("配置文件 {:?} 不存在", file_path),
                file_path: Some(file_path),
            });
        }

        fs::read_to_string(&file_path).map_err(|e| ConfigError {
            kind: "IoError".to_string(),
            message: format!("读取配置文件 {:?} 失败: {}", file_path, e),
            file_path: Some(file_path),
        })
    }

    /************************ Flow 3: 结构体与 JSON 转换 ************************/
    /// 静态泛型关联函数：将支持 Serialize 的业务参数结构体转换为 JSON 文本
    pub fn serialize<T: Serialize + ?Sized>(params: &T) -> Result<String, ConfigError> {
        serde_json::to_string_pretty(params).map_err(|e| ConfigError {
            kind: "SerdeError".to_string(),
            message: format!("序列化参数结构体失败: {}", e),
            file_path: None,
        })
    }

    /// 静态泛型关联函数：将 JSON 文本反序列化为目标类型 T
    pub fn deserialize<T: DeserializeOwned>(json_text: &str) -> Result<T, ConfigError> {
        serde_json::from_str(json_text).map_err(|e| ConfigError {
            kind: "SerdeError".to_string(),
            message: format!("反序列化参数结构体失败: {}", e),
            file_path: None,
        })
    }

    /************************ Flow 4: 设定返回值并统一收口 ************************/
    /// 静态关联函数：设定当前命令返回值，调用 Logger 记日志，并按开关决定是否输出控制台屏幕
    pub fn set_result(
        ok: bool,
        data: Option<serde_json::Value>,
        error: Option<ErrorInfo>,
        print_screen: bool,
    ) -> Result<(), ConfigError> {
        let command_result = CommandResult { ok, data, error };

        // 1. 将统一返回值暂存至全局单例容器
        if let Ok(mut guard) = CURRENT_RESULT.lock() {
            *guard = Some(command_result.clone());
        }

        // 2. 将结果自动格式化为标准 JSON 字符串
        let json_str = Self::serialize(&command_result)?;

        // 3. 自动调用 Logger 记录到当天的日志文件
        if ok {
            Logger::log_info(&format!("[CommandSuccess] {}", json_str));
        } else {
            let err_msg = command_result
                .error
                .as_ref()
                .map(|e| format!("{}: {}", e.code, e.message))
                .unwrap_or_else(|| "未知错误".to_string());
            Logger::log_error(&format!("[CommandFailure] {}", err_msg));
        }

        // 4. 根据布尔开关控制是否向标准输出打印 JSON
        if print_screen {
            println!("{}", json_str);
        }

        Ok(())
    }

    /************************ Flow 5: 读取已暂存的统一返回值 ************************/
    /// 静态关联函数：读取此前通过 set_result 暂存的 CommandResult 结构体
    pub fn get_result() -> Result<CommandResult, ConfigError> {
        if let Ok(guard) = CURRENT_RESULT.lock() {
            if let Some(ref res) = *guard {
                return Ok(res.clone());
            }
        }
        Err(ConfigError {
            kind: "NoResult".to_string(),
            message: "当前尚未设定任何命令返回值".to_string(),
            file_path: None,
        })
    }
}
