/********************************************************************************
 * 模块名称: 公共底座单元测试套件 (Common Tests)
 * 覆盖模块: Logger (module-ee5fc9ea...), ConfigManager (module-05d74c5b...)
 * 架构规范: docs/xyf-easycode/html/software_architecture.js
 ********************************************************************************/

use chrono::{Duration, Local};
use codebridge::{ConfigManager, ErrorInfo, Logger};
use serde::{Deserialize, Serialize};
use std::fs;
use std::thread;

/************************ Logger 架构测试用例 ************************/

#[test]
fn test_logger_lazy_initialization_on_first_call() {
    /************************ Test 1: 首次调用自动初始化 ************************/
    // 步骤: 调用 log_info 写入测试日志
    Logger::log_info("单元测试首次调用初始化验证");

    // 验证: 自动在当前执行程序所在目录创建 logs/ 目录与当天的 yyyy_mm_dd.log
    let exe_dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
    let logs_dir = exe_dir.join("logs");
    assert!(logs_dir.exists(), "日志目录应当自动被创建");

    let today_str = Local::now().format("%Y_%m_%d").to_string();
    let log_file = logs_dir.join(format!("{}.log", today_str));
    assert!(log_file.exists(), "当天日志文件应当自动生成");

    let content = fs::read_to_string(&log_file).unwrap();
    assert!(content.contains("[INFO] 单元测试首次调用初始化验证"));
}

#[test]
fn test_logger_daily_rotation_and_retention() {
    /************************ Test 2: 按天滚动与 90 天清理 ************************/
    let exe_dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
    let logs_dir = exe_dir.join("logs");
    fs::create_dir_all(&logs_dir).unwrap();

    // 模拟写入 95 天前和 10 天前的历史日志文件
    let now = Local::now().date_naive();
    let old_date = now - Duration::days(95);
    let recent_date = now - Duration::days(10);

    let old_file = logs_dir.join(format!("{}.log", old_date.format("%Y_%m_%d")));
    let recent_file = logs_dir.join(format!("{}.log", recent_date.format("%Y_%m_%d")));

    fs::write(&old_file, "95天前的陈旧日志内容").unwrap();
    fs::write(&recent_file, "10天前的正常日志内容").unwrap();

    // 触发一次日志记录，带动清理机制
    Logger::log_debug("触发日志系统滚动检查");

    // 验证: 超过 90 天的历史日志被自动清理，最近的保留
    assert!(!old_file.exists(), "超过 90 天的历史日志应当被自动删除");
    assert!(recent_file.exists(), "90 天内的日志文件应当完整保留");

    // 清理测试临时文件
    let _ = fs::remove_file(recent_file);
}

#[test]
fn test_logger_concurrent_singleton_logging() {
    /************************ Test 3: 多线程并发单例安全 ************************/
    let mut handles = Vec::new();
    for i in 0..10 {
        let handle = thread::spawn(move || {
            Logger::log_debug(&format!("线程 {} 测试 debug", i));
            Logger::log_info(&format!("线程 {} 测试 info", i));
            Logger::log_warn(&format!("线程 {} 测试 warn", i));
            Logger::log_error(&format!("线程 {} 测试 error", i));
        });
        handles.push(handle);
    }

    for h in handles {
        h.join().unwrap();
    }
}

/************************ ConfigManager 架构测试用例 ************************/

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct TestModuleParams {
    pub server_ip: String,
    pub timeout: u32,
    pub enable_feature: bool,
}

#[test]
fn test_config_manager_save_and_load_json() {
    /************************ Test 4: 保存与加载 JSON 文件 ************************/
    let file_name = "test_network.json";
    let test_json = r#"{
  "server_ip": "127.0.0.1",
  "timeout": 30,
  "enable_feature": true
}"#;

    // 保存 JSON
    ConfigManager::save_json(file_name, test_json).expect("保存 JSON 应成功");

    // 加载 JSON
    let loaded = ConfigManager::load_json(file_name).expect("加载 JSON 应成功");
    assert!(loaded.contains("127.0.0.1"));
}

#[test]
fn test_config_manager_serialize_and_deserialize() {
    /************************ Test 5: 结构体序列化与反序列化 ************************/
    let params = TestModuleParams {
        server_ip: "192.168.1.100".to_string(),
        timeout: 60,
        enable_feature: false,
    };

    // 序列化
    let json_text = ConfigManager::serialize(&params).expect("序列化应成功");
    assert!(json_text.contains("192.168.1.100"));

    // 反序列化
    let restored: TestModuleParams = ConfigManager::deserialize(&json_text).expect("反序列化应成功");
    assert_eq!(params, restored);
}

#[test]
fn test_config_manager_explicit_errors() {
    /************************ Test 6: 路径越界与文件缺失错误 ************************/
    // 越界路径拒绝
    let err_traversal = ConfigManager::load_json("../hack.json");
    assert!(err_traversal.is_err());
    if let Err(e) = err_traversal {
        assert_eq!(e.kind, "InvalidFileName");
    }

    // 非 json 后缀拒绝
    let err_ext = ConfigManager::load_json("config.yaml");
    assert!(err_ext.is_err());

    // 缺失文件明确报错
    let err_missing = ConfigManager::load_json("non_existent_file_9999.json");
    assert!(err_missing.is_err());
    if let Err(e) = err_missing {
        assert_eq!(e.kind, "NotFound");
    }
}

#[test]
fn test_config_manager_set_and_get_result_with_screen_switch() {
    /************************ Test 7: 返回值设定与屏幕打印开关 ************************/
    let data = serde_json::json!({
        "session_id": "test_sess_001",
        "web_url": "http://127.0.0.1:10086"
    });

    // 1. 成功结果：print_screen = false（静默模式）
    ConfigManager::set_result(true, Some(data.clone()), None, false).expect("设定成功结果");
    let res = ConfigManager::get_result().expect("获取已设定结果");
    assert!(res.ok);
    assert_eq!(res.data.unwrap(), data);
    assert!(res.error.is_none());

    // 2. 失败结果：print_screen = true
    let err_info = ErrorInfo {
        code: "PORT_IN_USE".to_string(),
        message: "端口已被占用".to_string(),
        retryable: false,
    };
    ConfigManager::set_result(false, None, Some(err_info.clone()), true).expect("设定失败结果");
    let res_err = ConfigManager::get_result().expect("获取失败结果");
    assert!(!res_err.ok);
    assert_eq!(res_err.error.unwrap().code, "PORT_IN_USE");
}
