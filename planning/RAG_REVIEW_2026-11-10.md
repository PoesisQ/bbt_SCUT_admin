# RAG 与问答检查（2026-11-10）

对应需求：AG-03/04/09/12、DEL-02/04。

## 已验证与修复

- 保持既定的 FTS5 关键词与中文二字词检索，不新增向量检索。术语别名扩展实际进入 `run_agent.retrieve()`。
- 复现跨课程结果按课程字母顺序拼接、弱相关内容挤掉强相关内容的问题。新增测试先失败，修复后通过：按各课扩展查询的词项覆盖率统一排序，再保留来源多样性。共用 `search_terms()`，与单课搜索的词项规则保持一致。
- 新增组卷用例确认旧版本与停用资料不再进入新题；历史引用保留。原有用例覆盖课程范围、证据 ID、位置、无来源时不编题与 MCP 接口。
- 项目虚拟环境运行 Python 全量：330 项，326 通过、3 跳过、1 失败。问答回归覆盖伪造引文拒绝、限次修复、跨课程隔离、连续对话、重复请求去重、出处核对缓存及失效。
- 5 个学习页面 JavaScript 测试文件共 25 项通过；改动文件编译与 `git diff --check` 通过。
- 唯一全量失败是既存的思维导图资源校验和：工作区 `extension/MARKMAP-LICENSES.txt` 为 CRLF，清单记录 LF 字节。读取 HEAD 原始文件校验通过，工作区转 LF 后的摘要也吻合；与本轮 RAG 修改无关，未修改该资源或清单。

本机日志位于 `.local/rag-review-final-tests.log` 和 `.local/rag-review-js.log`，不纳入公开仓库。系统默认 Python 缺少 FastAPI 等依赖，完整回归使用 `.venv/Scripts/python.exe`。

## 仍待验证

- 当前源码默认模型配置显示 `configured=False`。未运行真实模型回答、支持度审查或真实模型出题；模拟模型回归不能替代回答质量验收。
- 未执行 WorkBuddy 客户端真实对话、学校登录、录音或新安装包验收。
- 关键词检索仍可能漏掉不同措辞；来源多样性只针对召回候选，不保证所有资料均被召回。

## 仓库独立状态

当前 GitHub 返回 `fork=true`，父仓库仍为 `jbykkk/scut-courses-replay-extraction`。当前 CLI 账号 `Ayanami-Makima` 有 push 权限、无 admin 权限，不能解除 fork。

已将本地 GitHub CLI 默认目标设为 `PoesisQ/bbt_SCUT_admin` 并复核；Git origin 与 main 上游也指向本项目，减少误向原项目提交 PR 的可能。这不代表 GitHub fork 关系已解除。

需仓库所有者在 Settings → General → Danger Zone → Leave fork network 操作。官方说明保留 Git 提交元数据，但不保留 Issues、PR、Wiki、Stars 等仓库元数据，且不可重新接回。检查时仓库有 3 Stars、无子 fork。未进行删除重建，也未改变公开性。

参考：[GitHub 官方解除 fork 说明](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/detaching-a-fork)。README 的原项目来源说明继续保留。
