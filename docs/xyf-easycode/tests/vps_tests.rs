/********************************************************************************
 * 模块名称: VPS 业务主程序测试套件 (VPS Tests)
 * 覆盖模块: CodeBridgeVPS (module-codebridge-vps)
 * 架构规范: docs/xyf-easycode/html/software_architecture.js
 ********************************************************************************/

use std::process::Command;

fn get_bin_path() -> String {
    let mut path = std::env::current_exe().unwrap();
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    path.join("CodeBridgeVPS").to_string_lossy().to_string()
}

#[test]
fn test_vps_service_lifecycle() {
    /************************ Test 1: 启动与停止服务生命周期 ************************/
    let bin = get_bin_path();

    // 1. 指定名字启动
    let start_out = Command::new(&bin)
        .args(["start", "--name", "TestCloudVPS"])
        .output()
        .expect("启动 VPS 应成功");

    let stdout = String::from_utf8_lossy(&start_out.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).expect("输出应为合法 JSON");
    assert!(parsed["ok"].as_bool().unwrap());
    assert_eq!(parsed["data"]["service_name"].as_str().unwrap(), "TestCloudVPS");

    // 2. 巡检状态
    let status_out = Command::new(&bin)
        .arg("status")
        .output()
        .expect("查询状态应成功");

    let stdout_status = String::from_utf8_lossy(&status_out.stdout);
    let parsed_status: serde_json::Value = serde_json::from_str(&stdout_status).expect("输出应为合法 JSON");
    assert!(parsed_status["ok"].as_bool().unwrap());
    assert!(parsed_status["data"]["web_url"].as_str().unwrap().starts_with("http://127.0.0.1:"));

    // 3. 停止服务
    let stop_out = Command::new(&bin)
        .arg("stop")
        .output()
        .expect("停止 VPS 应成功");

    let stdout_stop = String::from_utf8_lossy(&stop_out.stdout);
    let parsed_stop: serde_json::Value = serde_json::from_str(&stdout_stop).expect("输出应为合法 JSON");
    assert!(parsed_stop["ok"].as_bool().unwrap());
    assert_eq!(parsed_stop["data"]["status"].as_str().unwrap(), "stopped");
}

#[test]
fn test_vps_directory_and_port_conflict() {
    /************************ Test 2: 云端目录与端口冲突防御 ************************/
    let bin = get_bin_path();
    let test_dir = "/opt/codebridge_test_exclusive";

    // 1. 主机 A 成功申请独占登记
    let res_a = Command::new(&bin)
        .args(["reserve", "--local-id", "host_alpha", "--vps-path", test_dir])
        .output()
        .expect("主机 A 登记应成功");

    let stdout_a = String::from_utf8_lossy(&res_a.stdout);
    let parsed_a: serde_json::Value = serde_json::from_str(&stdout_a).expect("输出应为合法 JSON");
    assert!(parsed_a["ok"].as_bool().unwrap());
    assert_eq!(parsed_a["data"]["status"].as_str().unwrap(), "reserved");

    // 2. 主机 B 尝试抢占同一目录，必须被坚决拒绝！
    let res_b = Command::new(&bin)
        .args(["reserve", "--local-id", "host_beta", "--vps-path", test_dir])
        .output()
        .expect("主机 B 冲突检测应成功");

    let stdout_b = String::from_utf8_lossy(&res_b.stdout);
    let parsed_b: serde_json::Value = serde_json::from_str(&stdout_b).expect("输出应为合法 JSON");
    assert!(!parsed_b["ok"].as_bool().unwrap(), "冲突申请必须被拒绝");
    assert_eq!(parsed_b["error"]["code"].as_str().unwrap(), "DIRECTORY_CONFLICT");

    // 3. 释放独占资源
    let rel = Command::new(&bin)
        .args(["release", "--vps-path", test_dir])
        .output()
        .expect("释放资源应成功");

    let stdout_rel = String::from_utf8_lossy(&rel.stdout);
    let parsed_rel: serde_json::Value = serde_json::from_str(&stdout_rel).expect("输出应为合法 JSON");
    assert!(parsed_rel["ok"].as_bool().unwrap());
    assert_eq!(parsed_rel["data"]["status"].as_str().unwrap(), "released");
}
