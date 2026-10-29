# WorkBuddy 接入准备

目前已具备本地 MCP 工具和技能文件，协议测试可在没有 WorkBuddy 账号的情况下运行。尚未完成 WorkBuddy 客户端联调、账号权限确认或平台发布；这里没有可提交的公开 Agent 链接。

## 本机接入

在项目目录运行：

```powershell
.\.venv\Scripts\python.exe scripts\prepare_workbuddy.py
```

安装版可将 Python 路径换为 `runtime\python.exe`。自定义数据目录时加 `--data-dir "实际资料目录"`。程序生成该目录下的 `workbuddy/mcp.json` 和 `skills/scut-study/SKILL.md`；不修改 WorkBuddy 设置，也不读取 API Key。配置包含本机路径，不要提交生成文件。

注册后，在 WorkBuddy 自定义连接器中使用生成的 stdio 配置，并添加技能文件。客户端的导入入口和权限提示需以届时的实际版本核验。MCP 由 WorkBuddy 启动，因此本地网页没打开时也能检索已有索引；新录音和新导入内容仍需学习助手完成索引同步。

工具共六个：课程列表、资料搜索、原文读取、已确认任务列表、`find_classroom_mentions`、`plan_today_review`。后两个与网页对话共用实现，不另外复制一份排序或引用规则。MCP 只读；不启动录音、不修改任务、不发送通知、不暴露通用文件或命令执行能力。

## 知识库怎么接

实时课堂位置、字幕版本、任务与复习状态由 MCP 查询。资料库适合存教材、课件和可审阅的复习产物，不能替代这份动态状态。

如需测试导入一门课的静态材料，可显式执行：

```powershell
.\.venv\Scripts\python.exe scripts\prepare_workbuddy.py --export-course "操作系统"
```

导出的 Markdown、`evidence.jsonl` 和 `manifest.json` 在本机 `knowledge-snapshot` 目录中，保留来源 ID、版本、课时/页码、字幕时间和可靠性标签。只导出所选课，排除停用来源；没有全盘扫描或自动上传。教材和课堂内容是否适合上传，由使用者决定。快照更新后，旧内容需移除或标注失效；回答前仍应通过 MCP 检查来源当前状态。已经存在的快照不会被无提示覆盖。

## 两条工作流

**查讲解**：确认课程 → 跨课时检索 → 展开原句前后文 → 必要时对照教材 → 输出解释与回看位置。字幕相互重复不算双来源核验；没有对应课堂证据时停止推断。

**今晚复习**：读取时间预算 → 查询已确认期限与作答反馈 → 本地计算清单 → 选择一项开始 → 作答/进度回到原系统。当前 MCP 是只读接入，写入反馈仍在学习助手完成。未来增加写入时需独立的带确认接口，不能让模型直接改 SQLite。

这些是业务流程说明，不冒充 WorkBuddy 可导入的可视化工作流配置。简单问题由一个 Agent 调工具完成。涉及教材与课堂冲突时，适合拆为“课堂取证”“资料核对”，再由主 Agent 汇总；各角色交接 evidence ID、引文和分歧，不复制完整材料。周期复习仍由现有调度器负责，接入平台定时任务时必须停用其中一套，避免重复提醒。

## 注册后的验收

- 连接器显示六个工具；关闭学习网页仍可查出一段已索引的原句。
- 用一门有两节以上记录的课问出处；核对课时、原句和回放时间；在登录状态下验证链接定位。
- 输入 30 分钟预算，合计不超过 30；改掉一个任务期限或复习反馈后，新清单随之变化。
- 资料失效、无证据、学校未登录、MCP 断开各走一次，确认没有编造链接或丢失消息。
- 根据账号开放的能力，选择桌面连接器/专家或企业智能体，再验证平台内可访问的真实入口。比赛提交前用另一台设备及评委相同的账号权限打开；`127.0.0.1` 不是公开 Agent 链接。

## 官方资料与边界

核对日期：2026-10-29。

- [连接器](https://open.workbuddy.cn/docs/connector)：支持 stdio MCP；配置和权限需依平台要求设置。本项目先采用本地进程，不将现有本机服务直接暴露公网。
- [技能格式](https://open.workbuddy.cn/docs/skill)：本目录按其 frontmatter 与目录结构准备技能文件。
- [资料库](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library)：文件与产物管理，可从任务读取材料；不等同于自动获得我们的字幕索引。
- [专家团](https://open.workbuddy.cn/docs/expert-team)：有角色定义与团队配置；是否适合本项目要以冲突核验收益和额外成本衡量。
- [企业智能体](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/CloudAgent)：文档中的创建入口要求分配企业坐席；个人账号是否具备比赛需要的发布权限，尚待注册确认。
- [MCP 生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)：本地适配器遵循初始化、版本协商、工具查询与调用的顺序。
