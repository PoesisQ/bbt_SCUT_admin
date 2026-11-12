# SCUT 课程复习组

WorkBuddy 原生专家团（team 型，0.4.0）。从带出处的补学讲解开始，按学生实际作答给变式。教师改期时，核对通知并预览剩余计划怎样调整。

| Agent ID | 花名 | 职责 |
| --- | --- | --- |
| `scut-learning-team-lead` | 路续之 · 课程主理人 | 取材、恢复同一学习目标、转交成员回传、确认后调用工具写回 |
| `scut-concept-explainer` | 纪承前 · 概念衔接讲师 | 连续讲解、前后课联系、用真实作答定位卡点 |
| `scut-quiz-writer` | 毕有据 · 证据出题员 | 带出处的练习和解析、检验指定卡点的变式 |
| `scut-evidence-reviewer` | 严据实 · 课程证据复核员 | 复核原文、条件和推导，核对新旧通知及发布者 |
| `scut-study-planner` | 程知序 · 学习规划师 | 说明第一步、调整前后的时段和来不及安排的工作 |

WF-1 缺课补学、WF-2 来源冲突、WF-3 考前复习、WF-4 跨课程衔接沿用现有分工。WF-5 在学生需要定位复杂卡点和复测时由讲师和出题员协作。WF-6 在通知改期时由复核员核对证据，规划师解释剩余工作怎么挪动。各阶段由主理人转交上下文。普通单题反馈、查原句、简单讲解和看今日清单在当前任务完成。学生选择只讲解时，讲师完整讲解，练习留到学生主动提出时。

## 在 WorkBuddy 里变成原生专家团

在 WorkBuddy 个人版从「专家 → 我的专家 → 专家团 → 创建专家团」按本目录配置设置角色，也可把 `dist/scut-learning-team.zip` 作为配置附件。使用选定的资料库附件即可出题、复核和拟定改期草案。检索本机课程、保存学习进度或实际更新已确认的任务和计划时使用 `scut-study` MCP。分步操作与验证清单见 [NATIVE_SETUP.md](NATIVE_SETUP.md)。

专家包不声明 MCP 依赖。使用资料库附件可以拟定练习和改期草案；需要读取个人课程或写回时，由使用者接入本机 `scut-study`。

## 构建与校验

仓库根目录执行：

```powershell
python scripts/build_workbuddy_team.py
```

输出 `dist/scut-learning-team.zip`，内容是角色定义、配置、README 与 512×512 头像。脚本会校验 `agents`、`teamInfo.memberAgents` 与 `members` 三者顺序一致，不一致即拒绝打包。

`categoryId` 有两套口径：本目录用 **`15-Education`**（开放平台行业分类表 01–15 中的教育学习）；本机 `expert-manager` 的 `validate_expert.py` 白名单只到 `12-IndustryConsultant`。本机注册副本需替换为 `12-IndustryConsultant` 才能通过校验，见 NATIVE_SETUP.md。其余字段两边一致：Team 的 `profession` 必须等于 `displayName`、`tags` 与 `quickPrompts` 各 3 条、`defaultInitPrompt` 等于 `quickPrompts[0]`、头像文件须实际存在。

## 用原创演示课验收

用[原创演示课与松针-27 通知](../demo/README.md)验收。先提交「只要时钟沿前已稳定就满足建立时间要求」，检查讲师能否从原答定位缺少的时长比较，以及出题员是否据此换一个条件。再用新旧教师通知看复核员和规划师是否回传前后期限、出处和调整的时段。MCP 路径在学生确认后写回，随后打开一个新任务验证是否能接续。仅凭同学转述时保留原期限，提示还需哪项证据。

当前主理人配置用成员 Agent ID 调度。以客户端实际成员回传核对工具参数兼容性。

## 当前边界

配置与 ZIP 可构建、可校验；**专家团成员实际调度、原生资料库回写与专家分享链接的跨账号可用性仍待在客户端验证**。本机未装 `sentence-transformers`，向量召回当前未启用；公开网页演示使用 `workbuddy/demo/` 的原创合成语料，不接真实校内系统。
