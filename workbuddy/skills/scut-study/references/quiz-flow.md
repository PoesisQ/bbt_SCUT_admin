# 用原文出题与继续练习

学生说“考我一道”或要逐题练习，先用 `get_learning_session` 恢复匹配目标。如果当前练习还在等待作答，沿用题干和 ID。需要出新题时调用 `prepare_quiz(course, topic, count=1, delivery="interactive")`。一次性交付可打印题单时选 `worksheet`。`partial` 时按实际返回的题位交付，`needs_sources` 时说清缺少的内容。

按题位中的原文设计题目。英文名随概念出现，依据写出资料名、页码或视频时间。自编题标明自编，给出答案依赖的条件和推导步骤。只有转写支持时标明待核对。若要问概念之间的联系，先检查证据是否覆盖双方。集中用 `verify_study_quotes` 核对原句与位置。

逐题模式用 `start_practice` 保存课程、主题、题干、参考解法和原句。每条 `citations` 填原文的 `evidence_id` 和字面 `quote`。沿用已有会话时传 `session_id` 及会话的 `expected_revision`，从今日复习开始的题也可传 `review_id`。拿到返回记录后只发题干，然后等待学生实际作答。

收到答案后用 `submit_practice_answer`，传同一 `practice_id`、这道题的 `revision`、原始 `answer` 和新 `request_id`。同次重试保留 ID，冲突后重读会话。只有学生明确选择 1–4 才传 `rating`。根据返回的参考解法和引文，解释学生答案里具体成立的步骤或遗漏的条件。自评与实际作答可在另一对话或学习页接续，暂未作答时不提交空答案。

原文更新或停用时，用当前资料核对并另出一题，保留原练习记录。学生要求暂停后先记录会话的 pause，明确恢复时用 resume。逐题练习的原答由练习工具保存一次。

整套题单先列题目，再集中放解析与引用。涉及公式和代码按 `document-format.md` 检查。需要跨来源纠错或整套难题时，WorkBuddy 专家团的出题与证据复核角色可分工，分别交回草案和待修项。简单练习在当前对话完成。
