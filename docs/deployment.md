# CodeBridge 跨平台部署

## 先区分两端

- **本地端**：拥有要共享目录的电脑。启动 Python 服务，在本机浏览器中显示连接界面；只监听 `127.0.0.1`。rclone 通过标准输入/输出提供选中目录，不开本地 SFTP 网络端口。
- **远端**：通过已有 SSH 连接访问的机器。只安装 Python、SSHFS/FUSE 和一个按连接运行的挂载辅助脚本；**没有远端网页、没有 AI Agent、没有 CodeBridge 常驻服务**。
- 文件在远端作为真实文件系统挂载使用，不是“同步完成后再复制回来”。修改、覆盖、删除会作用于本地共享目录，请先用可丢弃的测试目录验证。

先将完整 CodeBridge 文件夹解压到两端各自的普通用户可写目录，再在各端运行对应的一条命令。不要只复制安装脚本；它需要同包的 requirements 或 mount.py。

这些是由你明确运行的部署脚本，不是已执行的远程安装。首次系统软件安装可能请求管理员授权、软件条款确认或重启，脚本不会绕过这些步骤。

## 1. 本地端：安装和启动

在 CodeBridge 根目录运行。

### Windows

在普通用户的 PowerShell 中：

```powershell
powershell -NoProfile -File .\local_client\scripts\windows.ps1
```

成功后双击根目录的 `Start-CodeBridge.cmd`。它会启动本地服务并打开浏览器；保持启动终端运行，使用页面“断开”结束连接，Ctrl+C 退出服务。

- 自动寻找现有 Python 3.10+，缺少时通过 WinGet 安装 Python 3.13，包含 Tcl/Tk。
- 缺少合格 rclone 时，从官方发布站下载 **1.75.2** 到项目 `.tools\rclone.exe`，核对同版本官方 SHA-256 后才安装。
- 如果 Windows 缺少 WinGet，先安装或更新微软 App Installer；也可从 Python 官网自行安装 Python 后重试。
- 如果公司执行策略阻止脚本，请按公司的脚本审查/执行流程处理。脚本不会修改 ExecutionPolicy 或移除下载安全标记。
- 本地 Windows **不需要 WinFsp 或 SSHFS-Win**，只有远端 Windows 挂载才需要它们。

### Linux

```bash
bash local_client/scripts/linux.sh
```

成功后：

```bash
./start-codebridge.sh
```

请以桌面普通用户运行，不要在整个脚本前加 sudo。脚本只在安装系统依赖时请求 sudo。支持 apt、dnf、pacman、zypper；对应发行版需提供 Python 3.10+、Tkinter 和 venv。

缺少安全版本的 rclone 时，脚本下载官方 **1.75.2**，校验 SHA-256 后安装到项目 `.tools/rclone`，不覆盖系统 rclone。自动下载覆盖 x86_64、aarch64/arm64、armv7l、i686；其他架构可按官方文档自行安装后使用 `--skip-deps`。

无图形桌面的环境可运行本地网页服务，但不会有原生文件夹选择器，应填写绝对路径。不要把监听地址改成公网来解决浏览器访问问题。

### macOS

先具备 [Homebrew](https://brew.sh/)，再运行：

```bash
bash local_client/scripts/macos.sh
```

成功后双击 `Start-CodeBridge.command`，或在终端运行它。使用 Homebrew core 的 `python@3.13`、`python-tk@3.13` 和 `rclone`，兼容 Homebrew 的 Intel 与 Apple Silicon 标准安装位置。本地端不需要安装 macFUSE。

若 macOS 阻止打开下载的启动器，请先审查来源，再按系统正常“打开”流程操作；脚本不会关闭 Gatekeeper。

### 所有本地端共用行为

- Python 应用依赖装在项目根目录 `.venv`，不污染系统 Python：`paramiko==3.5.1`、`PySocks==1.7.1`。
- 实际入口是 `python -m local_client.app`，不是 Tk 主界面；Tkinter 只用于可选的原生目录选择。
- rclone 必须 **>= 1.75.0** 且实际支持 `serve sftp --stdio`。旧版即使有 stdio 也不会通过检查；建议使用 1.75.2 或更新的安全稳定版。
- 不要把其他操作系统的 `.venv` 一起搬过来。脚本发现明显不兼容的环境会停止，不会擅自删除。重建前请自行重命名旧 `.venv`。
- 安装后移动项目目录可能使 venv 内部路径失效，需在新位置重建 `.venv` 并重跑脚本。

## 2. 远端：安装挂载适配器

**务必以客户端将登录的同一个 SSH 用户运行**。安装在 A 用户的 home 下，不会自动供 B 用户使用。

前提是这台机器已有可访问的 SSH 服务和获准使用的账户。脚本不安装/启用 sshd、不修改 Remote Login、不打开防火墙端口、不改密码认证、不改变系统权限或 FUSE 用户组。需要这些管理操作时，应由主机管理员按现有安全策略完成。

### Linux

```bash
bash remote_server/scripts/linux.sh
```

脚本安装 Python 与发行版 SSHFS 包，让包管理器解决匹配的 FUSE 库依赖，然后验证：

- Python >= 3.10；
- 真实 sshfs 可执行文件声明 `passive` 或 `slave` 模式；
- `/dev/fuse` 存在，当前用户有读写权限；
- 有 `fusermount3` 或 `fusermount` 可用于正常卸载。

容器、部分托管主机和 WSL 环境可能没有可用 FUSE。脚本将报错，不会使用假目录冒充挂载，也不会自动添加容器权限、chmod `/dev/fuse` 或改用户组。

成功后安装：

```text
~/.codebridge/remote_server/mount.py
~/.local/bin/codebridge-mount
```

后者绑定安装时的完整 Python 路径，避免 SSH 非交互 shell 的 PATH 指向错误 Python。连接时使用 `~/.codebridge/mounts/<session-id>` 下独立的挂载目录。

### macOS

```bash
bash remote_server/scripts/macos.sh
```

使用 Homebrew core 安装 `python@3.13`、`macfuse` 和 `sshfs-mac`。`sshfs-mac` cask 指向官方 SSHFS 安装包，不需要另加第三方 tap。

macFUSE 与 SSHFS 是分开的组件。某些系统版本/后端需要你完成系统扩展授权、管理员授权或重启；较新的 macFUSE 提供其他后端，但这不代表当前 SSHFS/系统组合免于所有授权。脚本不会更改启动安全策略、SIP 或 Gatekeeper。

安装位置与 Linux 相同。生成的 wrapper 同时补充 `/opt/homebrew/bin` 和 `/usr/local/bin`，解决非交互 SSH PATH 缺少 sshfs 的问题。

**依赖检测通过不等于驱动已获准或挂载成功**。若首次连接失败，按 [macFUSE 官方说明](https://macfuse.github.io/) 完成必要授权/重启，再重试。

### Windows

```powershell
powershell -NoProfile -File .\remote_server\scripts\windows.ps1
```

使用 WinGet 安装缺少的 `Python.Python.3.13`、`WinFsp.WinFsp`、`SSHFS-Win.SSHFS-Win`。驱动安装可能弹出 UAC 或要求重启。

成功后安装：

```text
%USERPROFILE%\.codebridge\remote_server\mount.py
%USERPROFILE%\.codebridge\codebridge-mount.cmd
```

辅助脚本直接运行 SSHFS-Win 的 `sshfs.exe`，以二进制 stdin/stdout 承载 SFTP。**不使用 Explorer/net use 的另一条网络连接，也不启动本地明文 TCP 服务作为替代**。

Windows 远端属于**待实机验证的适配路径**，不能仅凭安装成功宣称完整可用：

1. 脚本会检查本机 SSHFS-Win 是否实际提供 passive/slave 模式，不满足时立即停止。
2. 通过 OpenSSH 会话创建的盘符可能只对该登录会话可见，未必能在交互桌面、另一条登录会话或其他服务账户中看到。
3. 必须让真正要消费目录的进程验证盘符与读写能力。不要通过扩大 ACL、全局盘符或改服务账户去掩盖会话隔离问题。
4. 首先验证 Windows x64；Windows ARM64、不同 Windows Server 版本和非标准 SSHFS 安装组合未在本包内实机认证，包管理器或驱动可能拒绝安装。

如果需要保证远端普通工具立即可见，优先先验证 Linux 远端的标准 FUSE 路径；不要把尚未验证的 Windows 适配结果当成生产承诺。

## 3. 依赖检查与重复部署

所有脚本都可以先做**只读检查**，不会安装软件或复制文件：

```bash
bash local_client/scripts/linux.sh --check
bash remote_server/scripts/linux.sh --check
bash local_client/scripts/macos.sh --check
bash remote_server/scripts/macos.sh --check
```

Windows 等价选项：

```powershell
.\local_client\scripts\windows.ps1 -CheckOnly
.\remote_server\scripts\windows.ps1 -CheckOnly
```

只运行本机平台的命令。检查用于确认依赖，不会创建一次真实共享挂载。

已自行装好依赖时，可加 Unix 的 `--skip-deps` 或 Windows 的 `-SkipDependencies`。它跳过系统安装，但仍会更新 CodeBridge 自己的环境、requirements、辅助脚本及启动器。`CODEBRIDGE_PYTHON` 环境变量可指定已有 Python 的完整路径。

远端快速自检：

```bash
~/.local/bin/codebridge-mount --self-test
```

```powershell
& "$env:USERPROFILE\.codebridge\codebridge-mount.cmd" --self-test
```

重复运行会更新 CodeBridge 自己的 helper/启动器，不会删除共享目录。正在连接时先断开，再做更新。更新 Python 安装路径后，需重跑远端安装器重新生成绝对路径 wrapper。

## 4. 首次连接验收

1. 先建一个没有重要资料的本地目录，放入测试文本、中文名文件和一个小二进制文件。
2. 启动本地页面，填写远端主机、SSH 端口、用户名、密码、共享目录和远端操作系统。只使用你拥有或被明确授权的远端主机。
3. 首次连接时确认服务器地址，点击“信任并连接”，无需手工填写指纹。首次信任并不能独立证明身份；有疑虑可展开详情，通过可信渠道核对。后续自动校验已保存身份，变化时拒绝发送密码。服务器重装或确实换钥后，可先断开并确认“删除指纹”，仅清除当前主机和端口的 CodeBridge 记录，再重新连接确认。不要用清除身份尝试修复普通网络或密码错误。
4. 代理可留空；如填写，当前版本仅接受不带账号密码的 `socks5://主机:端口` 或 `http://主机:端口`。代理失败不会自动退回直连。
5. 可先点“SSH Ping”和“测试代理”。前者是应用层 SSH 服务可达性，不是 ICMP；后者确认到目标 SSH 的实际代理隧道。配置代理时两者都不会偷偷改为直连。点击连接，必须等到界面报告真实远端挂载路径及目录可读后再使用。Linux/macOS 可在另一条同用户 SSH 会话中读取该路径；Windows 必须另验消费进程的登录会话可见性。
6. 先点击“验证读写”，等待临时文件的远端读取、写入和本地写回确认及清理。它只验证分开的读取/保存流程，不保证所有 O_RDWR 操作。然后在远端对测试目录读取、创建、覆盖、改名、删除，并回本地确认结果；测试一个中文路径和二进制文件，必要时比对哈希。
7. 主动断开，确认挂载释放；再测断网、关闭客户端后是否清理。切勿在未完成写入时直接关闭或断电。
8. 只有上述验收通过后才共享实际项目。对重要项目先备份或提交版本控制；该方案不提供离线同步、冲突合并或数据恢复保证。

浏览器界面仅在本机使用；关闭浏览器标签页不等于退出 Python 进程。不要把带会话 token 的本地启动链接发给别人。

## 5. 安全边界与常见问题

- **远端是获得目录读写能力的一方**。仅共享需要的最小目录，不要共享用户 home、SSH 密钥目录或密码数据库；远端账户/主机被攻破时，该目录同样面临风险。
- **没有打开新的对外服务**：唯一连接入口是已有 SSH。客户端页面仅 loopback，SFTP 通过既有 SSH exec 通道的标准流传输。
- **目录不是完整 POSIX 本地盘**：跨 Windows/macOS/Linux 时，大小写、权限、锁和元数据行为有差异。先测试应用要求，不要把 SSHFS 当成数据库事务存储。
- **找不到 helper**：确认远端安装用户与 SSH 用户相同；重新运行部署脚本；检查非交互命令可执行对应 wrapper。
- **Permission denied / FUSE 不可用**：读取报错并由主机管理员处理权限/驱动，不要盲目 chmod、使用 allow_other 或改 SSH 认证。
- **macOS driver 未批准**：只按官方文档处理授权与重启，不自动降低安全设置。
- **Windows 能连接却看不到盘符**：检查实际消费进程的登录会话。依赖自检无法证明跨会话可见。
- **目录选择窗口没弹出**：直接填写绝对路径；检查 Python Tkinter 和本地桌面会话。
- **停止/卸载**：先断开连接并退出本地进程，确认没有未完成写入和活动挂载。之后可自行移除本项目的 `.venv`、`.tools`、生成的启动器，以及远端的 helper/wrapper。不要在挂载仍存在时递归删除挂载目录。系统 Python、FUSE、SSHFS 或 rclone 可能被其他程序使用，是否卸载应另行决定。

## 官方参考与验证范围

- [rclone 官方安装与发布](https://rclone.org/install/)、[版本 1.75.2 文件](https://downloads.rclone.org/v1.75.2/)、[发布校验说明](https://rclone.org/release_signing/)
- [rclone SFTP stdio 模式](https://rclone.org/commands/rclone_serve_sftp/)
- [Homebrew Python Tk 3.13](https://formulae.brew.sh/formula/python-tk@3.13)、[macFUSE cask](https://formulae.brew.sh/cask/macfuse)、[SSHFS cask](https://formulae.brew.sh/cask/sshfs-mac)
- [SSHFS-Win 官方说明](https://github.com/winfsp/sshfs-win)、[macFUSE 官方站](https://macfuse.github.io/)
- [WinFsp WinGet 官方仓库清单](https://github.com/microsoft/winget-pkgs/tree/master/manifests/w/WinFsp/WinFsp)

脚本不等同于跨平台实机验收。交付时可做的静态语法、应用和协议检查，与 Windows/macOS 驱动安装及三平台真实挂载测试必须分别记录；未运行的环节不能视为通过。
