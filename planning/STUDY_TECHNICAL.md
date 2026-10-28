# 学习工作台：实现说明

## 数据流

```mermaid
flowchart LR
    A[学校字幕 / 本地转写] --> E[带来源的证据片段]
    B[PDF / PPTX / DOCX] --> E
    C[屏幕截图索引] --> V[视觉识别与对齐：后续]
    V --> E
    E --> R[按课程检索]
    R --> L[有预算的分析循环]
    L --> Q[结构与引文校验]
    Q --> P[待核对的结论 / 提案]
    P --> U[学生确认]
    U --> T[任务与课程要求]
    D[确认后的课表] --> S[按容量排程]
    T --> S
    S --> I[计划草稿 → 确认 → ICS]
    Q --> X[练习 → 自评 → 下次复习]
```

## 模块

`assistant_service/study_agent/` 不接管音频线程。通过现有 FastAPI 的 `/api/study/` 接入，沿用本地请求的 Host、Origin 和连接口令检查。网页入口为 `study.html`。

- `storage.py`：独立 SQLite 库 `study-agent.sqlite3`。源内容按指纹去重，原位置更新时使旧版本退出新检索，历史引文保留。
- `ingest.py`：只读注册资料目录；跳过虚拟环境、代码依赖、隐藏配置与疑似凭证文件。保留页码、幻灯片号或字幕时间。提取不到文字返回失败，不能把扫描版 PDF 标记为成功。
- `timetable.py`：按学校导出 PDF 的九列表格读取，保留周次。只是候选课表，必须确认学期与节次时间后才能展开。
- `reasoner.py`：自定义 HTTP 模型适配；唯一自动工具是限定当前课程的检索。每轮最多 3 次模型调用，每次最多 3500 输出 token、30 秒网络超时。来源最多 12 段，超过上下文预算不再追加。JSON 与逐字引文校验失败时限次修复，不能通过则不保存新提案。
- `planner.py`：按确认的耗时上限、截止日期、难度和空闲时段安排，不用模型生成时间表。没有截止日期就没有到期事实。
- `api.py`：资料、提案、计划、练习和课表的状态接口。学习模型调用限为同时 1 个，避免新功能抢占课堂即时事项分析的请求。
- `extension/visual-evidence.js`：只读当前课时 DOM 的 `.ppt_wrap` / `.ppt_time` / `img[data-src]`；校验学校域名、课时和 PPT 图片路径；不导出学校 Cookie。

## 四种记忆不要混用

| 记录 | 谁能写 | 如何使用 |
| --- | --- | --- |
| 原始证据 | 资料导入、课堂同步 | 可引用，不由模型覆盖 |
| 课程要求 | 学生确认后的提案 | 可作为后续问答的上下文 |
| 学习情况 | 学生的完成记录和练习自评 | 用于调整建议，明确属于自报 |
| 模型提案 | 经校验的分析输出 | 等待确认，不自动变成事实或通知 |

目前的引文校验保证“引用确实来自读到的原文”，不能保证模型解释一定正确。语义支持关系、否定、版本先后和跨来源纠错还须通过人工评测改进。纠错提案至少引用两个不同来源；原字幕不被改写。

## 模型配置

不配置新文件时，直接复用已有 DeepSeek Key 和所选模型。网页会显示模型配置是否存在；这不等同于已验证服务连通。

其他兼容服务可在本地 `.local/study-providers.json` 设置。该文件不进仓库，密钥存环境变量，示例见 `config-examples/study-providers.example.json`。本机推理服务可用 HTTP，远程服务要求 HTTPS。默认不跟随重定向；只有精确的 DeepSeek 官方域名可以复用原 Key。

版本化提示词在 `prompts/study-v1.txt`。工具返回的是非可信来源数据，不能授权读文件、调用外部接口或改变工具集合。执行日志保存调用步骤和引用，不记录密钥和模型内部推理。

## 安装与运行

```powershell
uv sync --extra asr --extra study
```

沿用现有启动方式，打开 `http://127.0.0.1:8765/study.html`，或者从扩展的“课程笔记”导航进入“学习工作台”。从浏览器扩展打开时可以读取学校页的 PPT 索引；普通本地网页没有浏览器标签页权限。

首次可只做四步：同步课堂记录 → 为同名课程导入一份课件 → 问一个问题 → 核对引文。随后再加课表和学习计划。扫描 PDF、复杂公式和手写图像尚无自动识别保证。

## 平台接入边界

WorkBuddy 官方支持 MCP 连接器与 CLI 连接器，本地 MCP 可使用 stdio。本轮提供 `python -m assistant_service.study_agent.mcp --data-dir <本地数据目录>`，暴露课程列表、课程检索、原文回查和已确认任务四个只读工具。配置示例在 `config-examples/workbuddy-mcp.example.json`。连接后，平台可读取工具返回的课程片段，因此只应连接学生选择使用的平台工作空间。确认任务、日历写入和通知发送仍留在工作台。参赛发布需另行完成真实的平台部署与访问验证。

参考：[WorkBuddy 连接器规范](https://open.workbuddy.cn/docs/connector)、[MCP stdio 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。本轮完成本地协议测试，尚未在 WorkBuddy 账号中联调，也未提交或安装市场连接器。

DeepSeek 当前文档包含图像输入能力，可以用于后续屏幕截图理解；本轮 HTTP 适配仍走文本 Chat Completions，不能把“接口有能力”写成“项目已具备可靠板书识别”。参考：[DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response/)。
