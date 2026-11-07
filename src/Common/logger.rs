/********************************************************************************
 * 模块名称: 日志模块 (Logger)
 * 模块标识: module-ee5fc9ea-a9a9-45c3-ba16-e1e531120767
 * 架构规范: docs/xyf-easycode/html/software_architecture.js
 * 职责说明: 单例记录主程序运行日志。首次调用自动初始化，按天写入 logs/yyyy_mm_dd.log，
 *           最多保留 90 天并自动翻滚清理。对外仅提供 4 个单例日志方法。
 ********************************************************************************/

use chrono::{Duration, Local, NaiveDate};
use once_cell::sync::Lazy;
use std::fs::{self, File, OpenOptions};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 全局单例日志管理器实例
static GLOBAL_LOGGER: Lazy<Mutex<Logger>> = Lazy::new(|| Mutex::new(Logger::new()));

/// 日志核心管理结构体（私有内部状态）
pub struct Logger {
    /// 日志根目录绝对路径（可执行文件所在目录/logs/）
    logs_dir: Option<PathBuf>,
    /// 当前已初始化的日期标识（格式为 YYYY_MM_DD）
    current_date_str: Option<String>,
    /// 当前活跃日志文件写入句柄
    current_file: Option<File>,
}

impl Logger {
    /// 私有构造函数：创建未初始化状态的 Logger 实例
    fn new() -> Self {
        Self {
            logs_dir: None,
            current_date_str: None,
            current_file: None,
        }
    }

    /************************ Flow 1: 惰性初始化与目录准备 ************************/
    /// 确保日志系统就绪：首次调用或跨天时定位 logs 目录、创建当天文件并清理过期日志
    fn ensure_initialized(&mut self) -> Result<(), String> {
        let now = Local::now();
        let today_str = now.format("%Y_%m_%d").to_string();

        // 检查是否已经初始化且仍为同一天
        if let (Some(_), Some(ref date_str), Some(_)) = (&self.logs_dir, &self.current_date_str, &self.current_file) {
            if date_str == &today_str {
                return Ok(());
            }
        }

        // 定位主程序可执行文件所在目录，确定 logs/ 路径
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("无法定位当前可执行文件路径: {}", e))?
            .parent()
            .ok_or_else(|| "无法获取主程序所在父目录".to_string())?
            .to_path_buf();
        let logs_path = exe_dir.join("logs");

        // 若 logs 目录不存在则自动创建
        if !logs_path.exists() {
            fs::create_dir_all(&logs_path)
                .map_err(|e| format!("创建日志目录 {:?} 失败: {}", logs_path, e))?;
        }

        // 打开或创建当天的日志文件（格式：yyyy_mm_dd.log）
        let log_file_name = format!("{}.log", today_str);
        let log_file_path = logs_path.join(log_file_name);
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file_path)
            .map_err(|e| format!("打开当天日志文件 {:?} 失败: {}", log_file_path, e))?;

        self.logs_dir = Some(logs_path.clone());
        self.current_date_str = Some(today_str);
        self.current_file = Some(file);

        /************************ Flow 2: 执行 90 天翻滚清理 ************************/
        Self::clean_old_logs(&logs_path, now.date_naive());

        Ok(())
    }

    /// 扫描 logs/ 目录，自动清理超过 90 天的历史日志文件
    fn clean_old_logs(logs_dir: &Path, today: NaiveDate) {
        let retention_days = Duration::days(90);
        let entries = match fs::read_dir(logs_dir) {
            Ok(iter) => iter,
            Err(_) => return, // 读取失败静默跳过，不阻塞正常写日志
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            // 检查文件名格式是否符合 yyyy_mm_dd.log
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if file_name.ends_with(".log") && file_name.len() == 14 {
                    let date_part = &file_name[0..10];
                    if let Ok(file_date) = NaiveDate::parse_from_str(date_part, "%Y_%m_%d") {
                        // 若文件生成日期距离今天超过 90 天，则安全删除
                        if today.signed_duration_since(file_date) > retention_days {
                            let _ = fs::remove_file(path);
                        }
                    }
                }
            }
        }
    }

    /************************ Flow 3: 内部日志写入通道 ************************/
    /// 格式化时间、级别与消息内容，线程安全地追加写入文件
    fn write_entry(&mut self, level: &str, message: &str) {
        if self.ensure_initialized().is_err() {
            // 初始化失败则向标准错误做简要诊断，不让调用方崩毁
            eprintln!("[LoggerFallback] [{}] {}", level, message);
            return;
        }

        // 定期翻滚检查：每次写入时自动清理超过 90 天的历史日志
        if let Some(ref logs_path) = self.logs_dir {
            Self::clean_old_logs(logs_path, Local::now().date_naive());
        }

        if let Some(ref mut file) = self.current_file {
            let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let line = format!("[{}] [{}] {}\n", timestamp, level, message);
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }

    /************************ Flow 4: 对外 4 个单例公开方法 ************************/

    /// 单例方法：记录 ERROR 级别的错误日志
    /// 第一次调用若未初始化，内部自动完成初始化
    pub fn log_error(message: &str) {
        if let Ok(mut guard) = GLOBAL_LOGGER.lock() {
            guard.write_entry("ERROR", message);
        }
    }

    /// 单例方法：记录 WARN 级别的警告日志
    pub fn log_warn(message: &str) {
        if let Ok(mut guard) = GLOBAL_LOGGER.lock() {
            guard.write_entry("WARN", message);
        }
    }

    /// 单例方法：记录 INFO 级别的运行日志
    pub fn log_info(message: &str) {
        if let Ok(mut guard) = GLOBAL_LOGGER.lock() {
            guard.write_entry("INFO", message);
        }
    }

    /// 单例方法：记录 DEBUG 级别的调试日志
    pub fn log_debug(message: &str) {
        if let Ok(mut guard) = GLOBAL_LOGGER.lock() {
            guard.write_entry("DEBUG", message);
        }
    }
}
