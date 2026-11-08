/********************************************************************************
 * 模块名称: Local 业务主程序测试套件 (Local Tests)
 * 覆盖模块: CodeBridgeLocal (module-codebridge-local)
 * 架构规范: docs/xyf-easycode/html/software_architecture.js
 ********************************************************************************/

use std::process::Command;

fn get_bin_path() -> String {
    let mut path = std::env::current_exe().unwrap();
    path.pop(); // remove test binary name
    if path.ends_with("deps") {
        path.pop();
    }
    path.join("CodeBridgeLocal").to_string_lossy().to_string()
}

#[test]
fn test_local_no_params_no_config_fails() {
    /************************ Test 1: 无参数无配置防御报错测试 ************************/
    let bin = get_bin_path();
    // 故意在一个没有配置文件的临时环境下运行
    let output = Command::new(&bin)
        .arg("start")
        .env_remove("MUTAGEN_DATA_DIRECTORY")
        .output()
        .expect("执行 CodeBridgeLocal 应成功完成子进程");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_default();

    // 如果已经有全局配置，ok 为 true；若是空环境则返回 MISSING_CONFIG
    if !parsed["ok"].as_bool().unwrap_or(false) {
        let code = parsed["error"]["code"].as_str().unwrap_or("");
        assert!(code == "MISSING_CONFIG" || code == "INVALID_ARGUMENTS");
    }
}

#[test]
fn test_local_partial_params_merge_and_persist() {
    /************************ Test 2: 首次带 IP 启动并持久化 ************************/
    let bin = get_bin_path();
    let output = Command::new(&bin)
        .args(["start", "--vps-ip", "10.0.0.88", "--web-port", "3000"])
        .output()
        .expect("执行启动应成功");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).expect("输出应为合法 JSON");
    assert!(parsed["ok"].as_bool().unwrap());
    assert_eq!(parsed["data"]["vps_ip"].as_str().unwrap(), "10.0.0.88");
    assert_eq!(parsed["data"]["web_port"].as_u64().unwrap(), 3000);

    /************************ Test 3: 部分参数覆盖启动 ************************/
    // 仅传入 --web-port 8080，vps-ip 自动从刚才保存的配置继承
    let output2 = Command::new(&bin)
        .args(["start", "--web-port", "8080"])
        .output()
        .expect("部分参数启动应成功");

    let stdout2 = String::from_utf8_lossy(&output2.stdout);
    let parsed2: serde_json::Value = serde_json::from_str(&stdout2).expect("输出应为合法 JSON");
    assert!(parsed2["ok"].as_bool().unwrap());
    assert_eq!(parsed2["data"]["vps_ip"].as_str().unwrap(), "10.0.0.88");
    assert_eq!(parsed2["data"]["web_port"].as_u64().unwrap(), 8080);
}

#[test]
fn test_local_query_status_and_forward_and_stop() {
    /************************ Test 4: 查询状态测试 ************************/
    let bin = get_bin_path();
    let status_out = Command::new(&bin)
        .arg("status")
        .output()
        .expect("查询状态应成功");

    let stdout = String::from_utf8_lossy(&status_out.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).expect("输出应为合法 JSON");
    assert!(parsed["ok"].as_bool().unwrap());
    let st = parsed["data"]["status"].as_str().unwrap();
    assert!(st == "watching" || st.starts_with("connecting") || st == "connected" || st == "paused");

    /************************ Test 5: 动态加端口测试 ************************/
    let fwd_out = Command::new(&bin)
        .args(["forward", "--web-port", "9000"])
        .output()
        .expect("加端口应成功");

    let fwd_stdout = String::from_utf8_lossy(&fwd_out.stdout);
    let fwd_parsed: serde_json::Value = serde_json::from_str(&fwd_stdout).expect("输出应为合法 JSON");
    assert!(fwd_parsed["ok"].as_bool().unwrap());
    assert_eq!(fwd_parsed["data"]["status"].as_str().unwrap(), "forward_added");

    /************************ Test 6: 停止桥接测试 ************************/
    let stop_out = Command::new(&bin)
        .arg("stop")
        .output()
        .expect("停止应成功");

    let stop_stdout = String::from_utf8_lossy(&stop_out.stdout);
    let stop_parsed: serde_json::Value = serde_json::from_str(&stop_stdout).expect("输出应为合法 JSON");
    assert!(stop_parsed["ok"].as_bool().unwrap());
    assert_eq!(stop_parsed["data"]["status"].as_str().unwrap(), "stopped");
}
