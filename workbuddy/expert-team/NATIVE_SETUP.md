# 原生专家团接入清单

按下列步骤把 `workbuddy/expert-team/` 配置成 WorkBuddy 里的原生专家团，并用原创样例核对成员回传。

## 步骤

1. **创建专家团**。在「专家 → 我的专家 → 专家团 → 创建专家团」按 `.codebuddy-plugin/plugin.json` 填名称、描述、3 个 quickPrompts 和默认引导语，按 `agents/*.md` 建立 5 个角色。也可将 `dist/scut-learning-team.zip` 作为配置附件。
2. **附上演示资料**。在个人资料库上传[原创讲义与通知](../demo/README.md)，新建任务时从「＋ → 添加文件 → 资料库」选用本轮所需文件。先用讲义跑补学或复测，再附原始实验通知和教师改期通知。测试同学转述时，附件只放原始通知和转述。
3. **按需连接本机索引**。检索本机课程、保存原答或确认改期时，在「专家·技能·连接器 → 连接器 → 自定义连接器」接入 `scut-study`，按客户端提示确认连接。新任务调用 `study_connection_status`，应返回 `0.7.0 / 28 工具`。用[隔离演示数据](../demo/README.md#准备隔离的-mcp-演示数据)验收确认写回。仅使用附件时，交付带出处的复测题和改期草案。
4. **分享链接**。从「我的专家 → 专家团卡片右上三个点 → 分享 → 复制链接」获得 WorkBuddy 客户端召唤入口。无需客户端的网页体验入口见[线上版说明](../../competition/site/README.md)。

## 本机注册副本（可选，用于 expert-manager 校验）

`validate_expert.py` 要求专家目录位于 `~/.workbuddy/plugins/marketplaces/my-experts/plugins/` 下，且 `categoryId` 只接受 01–12。仓库配置用 `15-Education`（开放平台合法），本机副本需替换为 `12-IndustryConsultant`：

```powershell
$src = Resolve-Path '.\workbuddy\expert-team'
$dst = "$env:USERPROFILE\.workbuddy\plugins\marketplaces\my-experts\plugins\scut-learning-team"
Copy-Item -Recurse -Force $src $dst
$p = Join-Path $dst ".codebuddy-plugin\plugin.json"
$j = Get-Content $p -Raw -Encoding utf8 | ConvertFrom-Json
$j.categoryId = "12-IndustryConsultant"
$j | ConvertTo-Json -Depth 12 | Set-Content $p -Encoding utf8
```

注册后是否需要在客户端重启或刷新才能看到，官方文档未写明；若「我的专家」没有出现，重启客户端再检查。不要改仓库里的 `15-Education`。

## 验证清单

- [ ] 客户端能看到 5 个角色，花名与职业头衔各自唯一
- [ ] 发「我缺了条件变量那一讲，帮我补齐并出两道题」→ WF-1，看到讲解员、出题员、复核员三份回传
- [ ] 发「字幕和课件说法不一致，帮我核对这处冲突」→ WF-2，只调度复核员
- [ ] 发「考前复习数字电路，出一套带出处的题单」→ WF-3，题单末尾有解析与页标
- [ ] 发「这个概念和前后课什么关系」→ WF-4，输出联系、差异与证据缺口
- [ ] 用同一建立时间题分别测试两种原答。原答一「时钟沿前已经稳定，所以一定满足」应检查稳定时长够不够。原答二「8 − 7 = 1 ns，这是保持时间，建立时间要看时钟沿之后」应检查沿前和沿后的适用条件。分别核对讲师引用的原答、识别的卡点以及出题员设计的不同变式。新开任务后可从同一目标续接
- [ ] 说「只讲解，请把这道题完整讲完」，检查结果只包含推导与出处，练习记录没有新增
- [ ] 发「核对松针-27 教师改期，先给我看新旧截止和移动的时段」。检查复核员和规划师的真实回传，确认前仍能读到旧期限。确认后开新任务读取同一目标和新期限，再用同一预览重试。对照同学转述应得到待核对结果
- [ ] 仅使用资料库附件的对照任务能展示改期草案，并说明草案状态
- [ ] 每条结论带出处，未验证能力标「设计目标 / 待验证」
- [ ] 分享链接用**另一个账号**实测能否召唤（当前台账标为待验证）

## 已知未知

- 专家分享链接对外部账号的实际能力、是否需 WorkBuddy 登录：**待验证**。
- 专家团成员实际调度与原生资料库产物回存：**待验证**（防火墙曾挡住回存）。
- 本机未安装 `sentence-transformers`，向量召回未启用；当前为 FTS5 关键词 + 术语别名检索。
- `scut-study` MCP 是本机 stdio 服务，不会随专家分享链接迁移到外部账号。
