# SCUT 课程复习组

整套题单由课程导师在 WorkBuddy 内取材，再交给出题员和证据复核员。遇到课件与课堂表述不一致时，只交由证据复核员核对。单题、找出处和今日清单可以直接在当前 WorkBuddy 对话完成。

使用 WorkBuddy 桌面端连接本地 `scut-study` MCP 0.6.0。在个人版可从“专家 → 我的专家 → 专家团 → 创建专家团”设置角色。开放平台打包格式见[专家团规范](https://open.workbuddy.cn/docs/expert-team)。

仓库根目录执行 `python scripts/build_workbuddy_team.py` 生成专家团 ZIP，内容包括角色定义、配置和项目头像。它是提交评审前可审阅的专家团配置。本机连接方式由各自的 `prepare_workbuddy.py --install` 生成。

用[原创演示课](../demo/README.md)验收。要求出两题且末尾给解析，查看任务里是否有导师取材、出题员回传、复核员回传和引文核对。只核对来源冲突时，由证据复核员检查原句和条件。单题作答使用已有的学习记录。
