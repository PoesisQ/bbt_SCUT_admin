/* 课程补学助手 · 对话式交互逻辑
 *
 * 界面沿用本机 extension/study.html 的学习对话工作台；运行时替换为浏览器端
 * 检索（retrieval.js）。默认展示一条带出处的答复，
 * 原文核对、练习与复习建议可展开查看。
 */
(function () {
  "use strict";

  var R = window.BuxueRetrieval;
  var CORPUS = window.BUXUE_CORPUS;

  var SCENARIOS = {
    missed: { query: "条件变量", course: "os" },
    confused: { query: "while 循环", course: "os" },
    exam: { query: "建立时间", course: "dsd" },
    bridge: { query: "synchronous reset", course: "" }
  };

  var PLATFORM = [
    ["线上演示", "WorkBuddy 托管的公开网页，可直接在浏览器打开", "免登录"],
    ["知识库", "本页包含 " + CORPUS.sources.length + " 份原创合成来源，涵盖讲义与示例课程通知", "网页示例库"],
    ["WorkBuddy 专家团", "五个角色负责课程协调、讲解、出题、证据复核和学习规划", "配置完成 / 调度待验"],
    ["MCP 0.7.0 · 28 工具", "连接器在本机提供课程检索、练习续接和改期确认", "本机协议已验证"],
    ["浏览器端真实检索", "normal / terms / expand_query / 四级打分 / NOISY / source_family / 上下文预算", "本页已验证 12/12"],
    ["免密钥大模型（平台云服务）", "未激活。不占用云应用名额、不消耗创建者资源点", "未启用"],
    ["访客自带 API Key（BYOK）", "纯前端内存保存，可选模型改写，引文 ID 校验失败即拦截", "本页可用"],
    ["浏览器语义检索", "关键词证据不足时，由浏览器加载量化嵌入模型查找相关讲义", "首次使用时加载"],
    ["专家团分享链接", "通过 WorkBuddy 客户端打开", "待跨账号验证"]
  ];

  var state = {
    result: null, blocked: [], conflicts: [], usable: [], quiz: [], plan: [],
    query: "", course: "", picks: {}, submitted: false, quizError: "",
    byok: { endpoint: "", model: "", key: "" }, modelAnswer: "", attachment: null
  };
  var SAMPLE_ATTACHMENT = { name: "Chapter 25 Capacitance.pptx", size: 2530675, sample: true };
  var SAMPLE_ATTACHMENT_SHA256 = "84c9a8822bc43ebcb43b4c53514911f3996855b6fb1456cd914b21102582d006";
  var CAPACITANCE_GUIDE = [
    ["电容（capacitance）衡量彼此绝缘的两块导体的储荷能力。把电容器（capacitor）接上电池，两极板逐渐积累等量异号的电荷，直到板间电压等于电源电压。用 q 表示一块板上的电荷量大小，V 表示板间电压，就有 q = CV。同样的电压下，C 越大，储存的电荷越多。", "第 5–9 张"],
    ["为什么板靠近会提高电容？对均匀介质中的理想平行板电容器（parallel-plate capacitor），忽略边缘电场。给定 q，板面积 A 越大，电荷越分散，场越弱。减小板距 d 也会减小两板之间的电势差，因为积分距离变短了。于是同样的 q 对应更小的 V，得到 C = εA/d，其中 ε 是介质的介电率（permittivity）。", "第 10–14 张"],
    ["看电路时先找哪一个量相同。并联（parallel）共用电压，电荷相加。串联（series）时中间节点若起初不带电且与外界绝缘，各电容的电荷量相同，电压相加。以第 18 张的 3 μF 和 6 μF、18 V 为例，并联得 9 μF 和 162 μC，串联得 2 μF 和 36 μC。这里的电荷量指电源转移到等效电容一端的电荷量。", "第 15–18 张"],
    ["充电越往后，电压越高，搬运下一小份电荷所做的功越多。把这些功相加，得到电场储能（electric-field energy）U = ½CV²。再将均匀电介质（dielectric）填满板间，极化会削弱给定自由电荷产生的场，电容增为原来的 κ 倍。断开电池时 q 固定，V 降低。仍接着电池时 V 固定，电池会继续向极板输送电荷。", "第 21–22 张、第 26–30 张"],
    ["介质里还要区分极板上的自由电荷（free charge）和极化产生的束缚电荷（bound charge）。用电位移（electric displacement）D 写高斯定律（Gauss’s law）时，闭合面上 D 的通量等于包围的自由电荷。遇到分层介质，可以先从自由电荷和对称性求 D，再按各层的介电常数求电场。", "第 33–42 张"]
  ];
  var draftAttachment = null;
  var currentAttachment = null;
  var runNumber = 0;
  var semanticWorker;

  /* ---------- DOM 小工具：bx- 前缀隔离本机骨架样式 ---------- */
  function pfx(cls) {
    return String(cls || "").split(/\s+/).filter(Boolean).map(function (c) {
      return c.indexOf("bx-") === 0 ? c : "bx-" + c;
    }).join(" ");
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = pfx(cls);
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function raw(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function attachmentDetails(attachment) {
    var details = el("details", "attachment");
    var suffix = attachment.name.match(/\.([a-z\d]+)$/i);
    var format = suffix ? suffix[1].toUpperCase() : "文件";
    var size = attachment.size + " B";
    if (attachment.size >= 1024 ** 2) size = (attachment.size / 1024 ** 2).toFixed(2) + " MB";
    else if (attachment.size >= 1024) size = (attachment.size / 1024).toFixed(1) + " KB";
    var source = attachment.sample ? "示例附件" : "本机文件";
    details.append(el("summary", "", attachment.name), el("span", "attachment-meta", [format, size, source].join(" · ")));
    return details;
  }

  function setDraftAttachment(attachment) {
    draftAttachment = attachment;
    var draft = $("draft-attachment");
    clear(draft);
    if (!attachment) return;
    var remove = el("button", "attachment-remove", "移除附件");
    remove.type = "button";
    remove.addEventListener("click", function () {
      setDraftAttachment(null);
      $("add-attachment").focus();
    });
    draft.append(attachmentDetails(attachment), remove);
  }

  async function isSampleDeck(file) {
    if (file.size !== SAMPLE_ATTACHMENT.size || !globalThis.crypto?.subtle) return false;
    try {
      var digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      var signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      return signature === SAMPLE_ATTACHMENT_SHA256;
    } catch {
      return false;
    }
  }

  function asksToExplainAttachment(query) {
    var phrase = query.replace(/\s+/g, "").replace(/[吗呢吧。！!？?]+$/, "")
      .replace(/^(?:请|能不能|可以)?(?:帮我)?/, "");
    return /^(?:讲解|解释|讲讲|解读)(?:一下)?(?:(?:这[个份页]?)?(?:课件|pptx?|附件|文件))?$/i.test(phrase)
      || /^(?:这[个份]?)?(?:课件|pptx?|附件|文件)(?:讲了什么|讲的是什么)$/i.test(phrase);
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function firstSentence(text) {
    var s = String(text || "").split(/[。；]/)[0].trim();
    return s.length > 68 ? s.slice(0, 66) + "…" : s;
  }
  function pickDistractors(pool, seed, count) {
    var out = [], used = {};
    for (var k = 0; k < pool.length && out.length < count; k++) {
      var item = pool[(seed + k * 3 + 1) % pool.length];
      if (!item || used[item.id]) continue;
      used[item.id] = true;
      out.push(item);
    }
    while (out.length < count) {
      out.push({ id: "（无出处）", text: "原文没有给出这一结论，属于推测。", reason: "无证据支持" });
    }
    return out;
  }
  function shuffle(list, seed) {
    var arr = list.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (seed + i * 7) % (i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 推荐问法与场景卡 ---------- */
  function renderStarters() {
    var box = $("starters-chips");
    clear(box);
    var noticeExamples = [
      { query: "什么时候考试，考试考什么？", course: "dsd" },
      { query: "松针-27 什么时候交作业？", course: "dsd" },
      { query: "并发控制的作业要求是什么？", course: "os" }
    ];
    noticeExamples.concat(CORPUS.queries).forEach(function (q, i) {
      var b = el("button", i >= 6 ? "extra" : "", q.query);
      b.type = "button";
      b.title = q.course ? CORPUS.courses[q.course] : "跨课程";
      b.addEventListener("click", function () { fillAndRun(q.query, q.course); });
      box.appendChild(b);
    });
  }
  function bindScenarios() {
    document.querySelectorAll("[data-scenario]").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = SCENARIOS[b.getAttribute("data-scenario")];
        if (s) fillAndRun(s.query, s.course);
      });
    });
  }
  function fillAndRun(query, course) {
    $("question").value = query;
    $("course").value = course || "";
    run(query, course || "");
  }

  /* ---------- 常见对话与当前学习内容 ---------- */
  function conversationIntent(query) {
    var phrase = query.toLowerCase().replace(/[\s。！!？?，,.、]+$/g, "");
    if (/^(你好[呀啊]?|您好|嗨|hello|hi)$/.test(phrase)) return "greeting";
    phrase = phrase.replace(/^(?:你好|您好|嗨)[，,。！!\s]+/, "").replace(/^请问[，,\s]*/, "");
    if (/^(你是谁|怎么用|怎么开始|使用帮助|帮助|知识库里?有(?:什么(?:内容)?|哪些资料)|(?:你|您|这里|这个助手)?有(?:什么|哪些)(?:功能|资料))$/.test(phrase)) return "help";
    if (/^(?:你|您|我|这里|学习伙伴|这个助手)?(?:都)?(?:可以|能|会)(?:帮我)?(?:做|问(?:你|您)?|查|学|提供)?(?:些)?(?:什么|哪些事(?:情)?|哪些内容|哪些课程|哪些资料)(?:吗|呢)?$/.test(phrase)) return "help";
    if (/^(?:你|您)?(?:能不能|能|可以)(?:帮我(?:一下)?|帮帮我|帮忙)(?:吗|呢)?$/.test(phrase)) return "help";
    if (/^(谢谢[你啦]?[啊呀]?|多谢|感谢|thanks|thank you)$/.test(phrase)) return "thanks";
    if (/^(?:能|可以|请)?(?:再)?(?:讲|说)(?:得)?(?:简单|通俗)(?:一)?点(?:吗)?$/.test(phrase)) return "summary";
    if (/^(继续|继续讲|接着讲|接着上次讲|接着刚才讲|继续刚才的内容)$/.test(phrase)) return "resume";
    if (/^(做题|做道题|做个练习|出题|出一道题|给我一道题|来一道题|再来一道(?:题)?|再出一道(?:题)?|继续练习)$/.test(phrase)) return "practice";
    return "";
  }

  function renderFollowUp(query, course, intent, attachment) {
    var followUp = $("study-follow-up");
    clear(followUp);
    var reply = createReply(followUp, query, "", attachment);
    var hasTopic = state.usable.length > 0 && (!course || course === state.course);
    var message;
    switch (intent) {
      case "attachment":
        message = "已添加附件。点击文件名可查看格式和大小。添加电容课件示例后，可以接着输入「讲解一下」。";
        break;
      case "greeting":
        message = "你好！今天想补哪一讲，或弄懂哪个概念？可以先问「条件变量是什么」。";
        break;
      case "help":
        message = "我可以查并发控制和数字电路的示例讲义与课程通知。可以问「什么时候考试，考什么」「什么时候交作业」，也可以带着一道题来复习。";
        break;
      case "thanks":
        message = "不客气。还有哪一点想弄清楚，随时接着问。";
        break;
      default:
        if (!hasTopic) {
          message = "先告诉我想学哪个概念，比如「条件变量」或「建立时间」。";
        } else if (intent === "practice") {
          message = !state.quiz.length
            ? "这一轮可以先读相关讲义。试着用讲义里的概念名提问，再做练习。"
            : state.submitted
            ? "本轮练习已做完。可以回看答案，或换个相关问题做新练习。"
            : "可以做本轮练习。提交后能看到答案和出处。";
        } else {
          message = intent === "summary" ? "先记住讲义里的这句话。" : "接着看刚才这份讲义。";
        }
    }
    reply.appendChild(el("p", "", message));
    if ((intent === "summary" || intent === "resume") && hasTopic) {
      var item = state.usable[0];
      var end = item.text.indexOf("。");
      appendExcerpt(reply, item, end === -1 ? item.text : item.text.slice(0, end + 1));
    }
    if (intent === "practice" && hasTopic && state.quiz.length) {
      var button = el("button", "btn", state.submitted ? "回看答案" : "打开练习");
      button.type = "button";
      button.addEventListener("click", function () { openReplySection("reply-quiz"); });
      reply.appendChild(button);
    }
    followUp.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function explainAttachment(query, attachment, runId) {
    var supported = attachment.sample || await attachment.matchesSample;
    if (runId !== runNumber) return;
    var followUp = $("study-follow-up");
    clear(followUp);
    var reply = createReply(followUp, query, "", attachment);
    if (supported) {
      reply.appendChild(el("h3", "", "电容器怎样储存电荷与能量"));
      CAPACITANCE_GUIDE.forEach(function ([paragraph, source]) {
        var section = el("p", "", paragraph);
        section.appendChild(el("small", "citation", "Chapter 25 Capacitance · " + source));
        reply.appendChild(section);
      });
    } else {
      reply.appendChild(el("p", "", "目前只有电容课件示例提供讲解。可以从「附件」选择「使用示例附件」试试。"));
    }
    followUp.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- 运行一次检索 ---------- */
  function loadSemanticScores(query) {
    semanticWorker ||= new Worker("./semantic-worker.js?v=20261112-notices", { type: "module" });
    var worker = semanticWorker;
    var id = runNumber;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { finish(new Error("Semantic search timed out")); }, 20000);
      function finish(error, scores) {
        clearTimeout(timer);
        worker.removeEventListener("message", receive);
        worker.removeEventListener("error", fail);
        if (error) reject(error);
        else resolve(scores);
      }
      function fail() {
        if (semanticWorker === worker) semanticWorker = null;
        worker.terminate();
        finish(new Error("Semantic search unavailable"));
      }
      function receive(event) {
        if (event.data.id !== id) return;
        if (event.data.failed) finish(new Error("Semantic search failed"));
        else finish(null, event.data.scores);
      }
      worker.addEventListener("message", receive);
      worker.addEventListener("error", fail);
      worker.postMessage({ id: id, query: query });
    });
  }

  function isUsableEvidence(item) {
    return R.NOISY.indexOf(item.kind) < 0 && item.query_match.basis !== "title" && !item.excluded;
  }

  function renderCourseNotice(query, selectedCourse, topics, attachment) {
    var namedCourses = Object.keys(CORPUS.courses).filter(function (code) {
      return R.contains(query, CORPUS.courses[code].split("·").pop()) || CORPUS.sources.some(function (source) {
        return source.course === code && source.meta && source.meta.assignment && R.contains(query, source.meta.assignment);
      });
    });
    var lastCourses = new Set(state.usable.map(function (item) { return item.courseCode; }));
    var inferredCourse = lastCourses.size === 1 ? Array.from(lastCourses)[0] : "";
    var course = selectedCourse || inferredCourse;
    if (namedCourses.length === 1) course = namedCourses[0];
    if (namedCourses.length > 1 && namedCourses.indexOf(selectedCourse) < 0) course = "";
    var followUp = $("study-follow-up");
    clear(followUp);
    var reply = createReply(followUp, query, course, attachment);
    if (!course) {
      reply.appendChild(el("p", "", "你想查哪门课的通知？"));
      var choices = raw("div", "suggestions");
      var courses = namedCourses.length ? namedCourses : Object.keys(CORPUS.courses);
      courses.filter(function (code) {
        return R.courseNotices(CORPUS, code, Object.keys(R.NOTICE_LABELS)).length > 0;
      }).forEach(function (code) {
        var button = el("button", "btn", CORPUS.courses[code]);
        button.type = "button";
        button.addEventListener("click", function () {
          $("course").value = code;
          renderCourseNotice(query, code, topics, attachment);
        });
        choices.appendChild(button);
      });
      reply.appendChild(choices);
    } else {
      $("course").value = course;
      var notices = R.courseNotices(CORPUS, course, topics);
      if (notices.length) reply.appendChild(el("p", "", "根据这门演示课的模拟教师通知："));
      topics.forEach(function (topic) {
        var matches = notices.filter(function (item) { return item.notice === topic; });
        reply.appendChild(el("h3", "subhead", R.NOTICE_LABELS[topic]));
        if (!matches.length) reply.appendChild(el("p", "", "示例库里还没有这项教师通知。"));
        matches.forEach(function (item) { appendExcerpt(reply, item, item.text); });
      });
    }
    followUp.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function run(query, course, attachment = null) {
    query = String(query || "").trim();
    var status = $("ask-status");
    if (!query && !attachment) {
      status.textContent = "请先写一个问题再发送。";
      status.hidden = false;
      $("question").focus();
      return;
    }
    var runId = ++runNumber;
    if (attachment) currentAttachment = attachment;
    if (currentAttachment && asksToExplainAttachment(query)) {
      status.hidden = true;
      await explainAttachment(query, currentAttachment, runId);
      return;
    }
    var intent = query ? conversationIntent(query) : "attachment";
    if (intent) {
      status.hidden = true;
      renderFollowUp(query, course, intent, attachment);
      return;
    }
    var noticeTopics = R.noticeTopics(query);
    if (noticeTopics.length) {
      status.hidden = true;
      renderCourseNotice(query, course, noticeTopics, attachment);
      return;
    }
    var result;
    try {
      result = R.retrieve(CORPUS, query, course, 8);
    } catch (err) {
      if (attachment) setDraftAttachment(attachment);
      status.textContent = "暂时无法查找讲义，请刷新页面后再试。";
      status.hidden = false;
      return;
    }
    var hasStrongEvidence = result.items.some(function (item) {
      return isUsableEvidence(item) && R.strongKeywordMatch(item);
    });
    if (!hasStrongEvidence && location.protocol !== "file:") {
      status.textContent = "正在查找相关讲义。首次使用可能需要加载模型。";
      status.hidden = false;
      try {
        var scores = await loadSemanticScores(query);
        result = R.retrieve(CORPUS, query, course, 8, scores);
      } catch {
        result.vector_retrieval = { status: "unavailable", reason: "模型暂未加载，使用关键词结果" };
      }
      if (runId !== runNumber) return;
    }
    var blocked = R.blockedSources(CORPUS, query, course, result.items);
    var conflicts = R.conflicts(result.items);
    var usable = result.items.filter(isUsableEvidence);
    state.result = result;
    state.blocked = blocked;
    state.conflicts = conflicts;
    state.usable = usable;
    state.query = query;
    state.course = course;
    state.attachment = attachment;
    state.picks = {};
    state.submitted = false;
    state.quizError = "";
    state.modelAnswer = "";
    state.quiz = buildQuiz(usable.filter(function (item) { return item.query_match.basis !== "semantic"; }), blocked, query);
    state.plan = buildPlan(usable, conflicts, state.quiz.length);
    $("byok-output").hidden = true;
    byokStatus("", false);
    status.hidden = true;
    $("starters").hidden = true;
    $("open-sources").disabled = !result.items.length && !blocked.length;
    $("open-runtime").disabled = false;
    renderConversation(true);
    $("conversation").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- 由证据动态生成练习 ---------- */
  function buildQuiz(usable, blocked, query) {
    var pool = blocked.map(function (b) {
      return { id: b.id, text: b.text, reason: b.reason };
    });
    return usable.slice(0, 2).map(function (item) {
      var correct = firstSentence(item.text);
      var distractors = pickDistractors(pool, hash(query + item.id) % Math.max(1, pool.length), 2);
      var options = [{ text: correct, ok: true }].concat(distractors.map(function (d) {
        return { text: firstSentence(d.text), ok: false };
      }));
      options = shuffle(options, hash(query + item.id + "s") % 97 + 1);
      var answer = options.findIndex(function (o) { return o.ok; });
      return {
        q: "依据 [" + item.id + "]（" + R.locatorText(item) + "），下面哪一条是这份原文支持的说法？",
        options: options, answer: answer,
        rationale: "正确选项出自 [" + item.id + "]。其余选项分别来自 " +
          distractors.map(function (d) { return "[" + d.id + "]（" + d.reason + "）"; }).join("、") +
          "，不能作为这道题的依据。"
      };
    });
  }
  function buildPlan(usable, conflicts, quizCount) {
    if (!usable.length) return [];
    var plan = [];
    usable.slice(0, 3).forEach(function (item) {
      plan.push("回看《" + item.title + "》" + R.locatorText(item) + "，用自己的话复述一次。");
    });
    if (conflicts.length) plan.push("对照字幕、转写和讲义，核对有出入的那句话。");
    if (quizCount) plan.push("3 天后再做一次本轮练习，回看答错的题和出处。");
    return plan;
  }

  /* ---------- 对话渲染 ---------- */
  function createReply(container, question, course, attachment) {
    $("welcome").hidden = true;
    document.querySelector(".conversation-shell").classList.add("has-conversation");
    var exchange = raw("article", "exchange");
    var userMsg = raw("div", "user-message");
    if (course) userMsg.appendChild(raw("span", "course-label", CORPUS.courses[course]));
    if (question) userMsg.appendChild(el("p", "", question));
    if (attachment) userMsg.appendChild(attachmentDetails(attachment));
    exchange.appendChild(userMsg);
    var reply = raw("div", "assistant-message");
    reply.appendChild(raw("span", "speaker", "SCUT"));
    exchange.appendChild(reply);
    container.appendChild(exchange);
    return reply;
  }

  function renderConversation(newQuestion) {
    var conv = $("study-exchange");
    var expanded = newQuestion ? [] : Array.from(conv.querySelectorAll("details[open]"), function (node) { return node.id; });
    var attachmentOpen = !newQuestion && Boolean(conv.querySelector(".bx-attachment[open]"));
    if (newQuestion) clear($("study-follow-up"));
    clear(conv);
    var reply = createReply(conv, state.query, state.course, state.attachment);
    if (attachmentOpen) conv.querySelector(".bx-attachment").open = true;
    renderExplanation(reply);
    function appendDetails(id, label, render) {
      var details = el("details", "reply-section");
      details.id = id;
      details.open = expanded.indexOf(id) >= 0;
      details.appendChild(el("summary", "", label));
      render(details);
      reply.appendChild(details);
    }
    if (state.result.items.length || state.blocked.length) {
      appendDetails("reply-sources", "查看原文与核对记录", renderEvidence);
    }
    if (state.quiz.length) {
      appendDetails("reply-quiz", state.submitted ? "查看练习结果" : "做 " + state.quiz.length + " 道练习", renderQuiz);
    }
    if (state.plan.length) {
      appendDetails("reply-review", "复习建议", renderPlan);
    }
  }

  function renderMetrics(body, result) {
    var blockedCount = state.blocked.filter(function (b) { return b.status === "blocked"; }).length;
    var downCount = state.blocked.length - blockedCount;
    var box = el("div", "metrics");
    [["命中证据", result.items.length], ["可用作依据", state.usable.length],
     ["拦截", blockedCount], ["降级为线索", downCount],
     ["扫描片段", result.scanned_chunks], ["同源族", result.families],
     ["浏览器向量检索", result.vector_retrieval.status === "ready" ? "已运行" : "本轮未用"]].forEach(function (p) {
      var m = el("div", "metric");
      m.appendChild(el("b", "", p[1]));
      m.appendChild(document.createTextNode(" " + p[0]));
      box.appendChild(m);
    });
    body.appendChild(box);
  }

  function renderTrace(body, result) {
    body.appendChild(el("div", "subhead", "检索步骤"));
    var trace = el("div", "trace");
    var exp = result.expansions[Object.keys(result.expansions)[0]];
    var counts = { phrase: 0, text: 0, title: 0, generic_alias: 0, semantic: 0 };
    result.items.forEach(function (i) { counts[i.query_match.basis]++; });
    var rows = [
      ["归一化 / 切词", "normal() → " + R.normal(result.query) + "；参与匹配的词：" + Array.from(R.queryTerms(result.query)).join(", ")],
      ["同课术语扩展", "variants=" + JSON.stringify(exp.variants) + "；命中术语=" + (exp.concepts.join("、") || "无")],
      ["FTS5 等价扫描", "课程范围 " + result.courses_searched.join(" / ") + "；扫描 " + result.scanned_chunks +
        " 个片段，命中候选 " + result.matched_candidates + " 个"],
      ["四级打分", "原句 " + counts.phrase + " / 正文 " + counts.text + " / 标题 " + counts.title +
        " / 术语兜底 " + counts.generic_alias + "；按 (层级, 覆盖度, 来源可信度, 独立性) 排序"],
      ["来源策略与去重", "旧版 / 停用 / 跨课 / 仅标题命中被拦；同源族 " + result.families + " 个，重复族在同分层内降权"],
      ["上下文预算", "已用 " + result.budget.characters + " / " + result.budget.budget + " 字符；延后 " +
        result.budget.deferred.length + " 条"],
      ["向量召回", result.vector_retrieval.status + "：" + result.vector_retrieval.reason +
        (result.vector_retrieval.status === "ready" ? "，语义候选 " + counts.semantic + " 条" : "")]
    ];
    rows.forEach(function (r) {
      var row = el("div", "trace-row");
      row.appendChild(el("span", "k", r[0]));
      row.appendChild(el("span", "v", r[1]));
      trace.appendChild(row);
    });
    body.appendChild(trace);

  }

  function renderEvidenceCards(body, result) {
    if (!result.items.length) return;
    body.appendChild(el("h3", "subhead", "相关原文"));
    result.items.forEach(function (item) {
      var usable = state.usable.indexOf(item) >= 0;
      var card = el("div", "evidence" + (usable ? "" : " noisy"));
      var head = el("div", "evidence-head");
      head.appendChild(el("span", "badge" + (usable ? "" : " alt"),
        usable ? (item.query_match.basis === "semantic" ? "语义相关原文" : "可用依据") :
          (item.query_match.basis === "title" ? "仅标题命中" : "待核对线索")));
      head.appendChild(el("span", "eid", "[" + item.id + "]"));
      head.appendChild(el("span", "locator", item.title + " · " + R.locatorText(item)));
      card.appendChild(head);
      card.appendChild(el("p", "quote", item.text));
      body.appendChild(card);
    });
  }

  function renderBlocked(body) {
    if (!state.blocked.length) return;
    body.appendChild(el("h3", "subhead", "未采用的来源"));
    state.blocked.forEach(function (b) {
      var row = el("div", "blocked-row" + (b.status === "downgraded" ? " downgraded" : ""));
      var top = el("div", "top");
      top.appendChild(el("span", "badge " + (b.status === "downgraded" ? "alt" : "blocked"),
        b.status === "downgraded" ? "仅供参考" : "已排除"));
      top.appendChild(el("span", "eid", "[" + b.id + "]"));
      top.appendChild(document.createTextNode(b.title));
      row.appendChild(top);
      row.appendChild(el("div", "reason", b.reason));
      row.appendChild(el("div", "quote", "原文片段：" + firstSentence(b.text)));
      body.appendChild(row);
    });
  }

  function renderEvidence(body) {
    renderEvidenceCards(body, state.result);
    renderBlocked(body);
    if (state.conflicts.length) {
      var note = el("div", "caveat", "同源冲突提示：[" + state.conflicts[0].asr + "] 与 [" +
        state.conflicts[0].reference + "] 来自同一课时但措辞不同。" + state.conflicts[0].note + "。");
      body.appendChild(note);
    }
  }

  /* ---------- 讲解 ---------- */
  function appendExcerpt(body, item, text) {
    var p = el("p", "", text);
    p.appendChild(el("small", "citation", "《" + item.title + "》 · " + R.locatorText(item)));
    body.appendChild(p);
    if (item.illustration) {
      var figure = el("figure", "illustration");
      var image = document.createElement("img");
      image.src = "data/" + encodeURIComponent(item.illustration);
      image.alt = item.illustration_alt;
      image.loading = "lazy";
      figure.appendChild(image);
      figure.appendChild(el("figcaption", "note", "原创教学波形"));
      body.appendChild(figure);
    }
  }

  function renderExplanation(body) {
    if (!state.usable.length) {
      body.appendChild(el("p", "", "没有找到足以回答这个问题的讲义原文。可以换一个关键词，或把课程范围改成「跨课程」。"));
      return;
    }
    var prose = el("div", "prose");
    state.usable.slice(0, 2).forEach(function (item) {
      appendExcerpt(prose, item, item.text);
    });
    if (state.conflicts.length) {
      prose.appendChild(el("p", "note", "同一课时的字幕和转写措辞有出入，可展开查看两段原文。"));
    }
    body.appendChild(prose);

    if (state.modelAnswer) {
      var answer = el("div", "model-answer");
      answer.appendChild(el("b", "", "模型改写"));
      answer.appendChild(el("div", "", state.modelAnswer));
      body.appendChild(answer);
    }
  }

  /* ---------- 练习 ---------- */
  function renderQuiz(body) {
    state.quiz.forEach(function (q, qi) {
      var item = el("div", "quiz-item");
      item.appendChild(el("div", "q", (qi + 1) + ". " + q.q));
      q.options.forEach(function (o, ci) {
        var b = el("button", "choice", String.fromCharCode(65 + ci) + ". " + o.text);
        b.type = "button";
        b.setAttribute("aria-pressed", String(state.picks[qi] === ci));
        if (state.submitted) {
          if (ci === q.answer) b.classList.add("bx-correct");
          else if (state.picks[qi] === ci) b.classList.add("bx-wrong");
          b.disabled = true;
        } else if (state.picks[qi] === ci) {
          b.classList.add("bx-selected");
        }
        b.addEventListener("click", function () {
          if (state.submitted) return;
          state.picks[qi] = ci;
          state.quizError = "";
          renderConversation();
          $("reply-quiz").querySelectorAll(".bx-quiz-item")[qi].querySelectorAll(".bx-choice")[ci].focus();
        });
        item.appendChild(b);
      });
      if (state.submitted) {
        var res = el("div", "quiz-result");
        var correct = state.picks[qi] === q.answer;
        res.appendChild(el("div", "", (correct ? "回答正确。" : "参考答案 " + String.fromCharCode(65 + q.answer) + "。") + q.rationale));
        item.appendChild(res);
      }
      body.appendChild(item);
    });
    if (!state.submitted) {
      var submit = el("button", "btn primary", "提交作答并查看出处");
      submit.type = "button";
      submit.addEventListener("click", function () {
        if (Object.keys(state.picks).length < state.quiz.length) {
          state.quizError = "请先为每道题选一个答案。";
          renderConversation();
          return;
        }
        state.submitted = true;
        try {
          sessionStorage.setItem("buxue-answer-" + hash(state.query + state.course),
            JSON.stringify({ query: state.query, picks: state.picks, at: new Date().toISOString() }));
        } catch (e) { /* 隐私模式下不记录，不影响闭环 */ }
        renderConversation();
      });
      body.appendChild(submit);
      if (state.quizError) body.appendChild(el("p", "caveat", state.quizError));
    } else {
      body.appendChild(el("p", "record-note", "本轮作答已提交。"));
    }
  }

  /* ---------- 复习安排 ---------- */
  function renderPlan(body) {
    var ul = el("ul", "plan-list");
    state.plan.forEach(function (p) { ul.appendChild(el("li", "", p)); });
    body.appendChild(ul);
  }

  /* ---------- 访客自带模型（BYOK） ---------- */
  function byokStatus(text, bad) {
    var n = $("byok-status");
    n.textContent = text;
    n.style.color = bad ? "#993c1d" : "#6b6963";
  }
  function saveByok() {
    state.byok.endpoint = $("byok-endpoint").value.trim();
    state.byok.model = $("byok-model").value.trim();
    state.byok.key = $("byok-key").value.trim();
    byokStatus(state.byok.key ? "已保存在本标签页内存，刷新即清空；未写入任何存储。" : "尚未填写密钥，核心闭环照常可用。", false);
  }
  function clearByok() {
    state.byok = { endpoint: "", model: "", key: "" };
    $("byok-endpoint").value = "";
    $("byok-model").value = "";
    $("byok-key").value = "";
    $("byok-output").hidden = true;
    byokStatus("密钥已清除。", false);
  }
  function showByokOutput(text) {
    var out = $("byok-output");
    clear(out);
    out.hidden = false;
    out.appendChild(el("b", "", "模型回答（引文已校验）"));
    out.appendChild(el("div", "", text));
  }
  function callByok() {
    saveByok();
    if (!state.result || !state.usable.length) {
      byokStatus("请先检索出一个有可用证据的问题。", true);
      return;
    }
    var cfg = state.byok;
    if (!cfg.endpoint || !cfg.model || !cfg.key) {
      byokStatus("请填写接口地址、模型名和密钥。", true);
      return;
    }
    var result = state.result;
    $("byok-output").hidden = true;
    byokStatus("正在向你填写的接口请求…", false);
    $("byok-run").disabled = true;
    var allowed = state.usable.map(function (i) { return i.id; });
    var system = "你是课程补学助手。只能依据下面列出的证据回答，每条结论后用 [证据ID] 标注出处。" +
      "不得引用列表之外的证据 ID，不得补充未经原文支持的事实，不得推定考试范围。证据清单：\n" +
      state.usable.map(function (i) { return "[" + i.id + "] " + i.title + "（" + R.locatorText(i) + "）：" + i.text; }).join("\n");
    var user = "学生问题：" + state.query + "\n请用 180 字以内讲清这一讲的关键点，并说明前后课联系里哪些属于未知。";
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
      body: JSON.stringify({ model: cfg.model, stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error("模型服务返回 HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      var text = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || "";
      if (state.result !== result || state.byok !== cfg) return;
      if (typeof text !== "string" || !text.trim()) throw new Error("模型没有返回讲解");
      var cited = (text.match(/\[[a-z_]+:\d+\]/g) || []).map(function (x) { return x.slice(1, -1); });
      if (!cited.length) throw new Error("回答未标注证据 ID，按本页规则拦截");
      var unknown = cited.filter(function (id) { return allowed.indexOf(id) < 0; });
      if (unknown.length) throw new Error("引用了证据清单之外的 ID：" + unknown.join("、") + "，已拦截");
      state.modelAnswer = text;
      byokStatus("调用成功，引文校验通过。消耗的是你自己账号的额度。", false);
      showByokOutput(text);
      renderConversation();
    }).catch(function (err) {
      if (state.result !== result || state.byok !== cfg) return;
      var reason = err.name === "AbortError" ? "请求超时" :
        /^(模型|回答|引用)/.test(err.message) ? err.message : "无法连接模型或读取回答";
      byokStatus(reason + "。你仍可以阅读讲义原文。", true);
    }).finally(function () {
      clearTimeout(timer);
      $("byok-run").disabled = false;
    });
  }

  /* ---------- 面板（浏览器实时复跑评测） ---------- */
  function renderPanels() {
    var report = R.selfCheck(CORPUS);
    $("eval-headline").textContent = report.passed
      ? "浏览器端复跑：12/12 检索用例通过 · 4 条错误引文全部拦截"
      : "浏览器端复跑：存在未通过用例";
    var sum = $("eval-summary");
    clear(sum);
    [["检索用例", report.queries + " 条"], ["Recall@3", report.recall_at_3.toFixed(3)],
     ["Recall@8", report.recall_at_8.toFixed(3)], ["错误引文拦截", report.negative_quotes_rejected + " / 4"],
     ["来源数", report.fixture_sources], ["模型调用", report.model_calls]].forEach(function (p) {
      var m = el("div", "metric good");
      m.appendChild(el("b", "", p[1]));
      m.appendChild(document.createTextNode(" " + p[0]));
      sum.appendChild(m);
    });
    var t = $("eval-table");
    clear(t);
    report.rows.forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(el("td", "", row.id));
      tr.appendChild(el("td", "", row.query));
      tr.appendChild(el("td", "", row.expected.join(", ") || "（应为空）"));
      tr.appendChild(el("td", "", row.returned.join(", ") || "（空）"));
      tr.appendChild(el("td", row.pass ? "pass" : "fail", row.pass ? "PASS" : "FAIL"));
      t.appendChild(tr);
    });
    var q = $("quote-table");
    clear(q);
    report.quotes.forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(el("td", "", row.label));
      tr.appendChild(el("td", "", row.id));
      tr.appendChild(el("td", row.pass ? "pass" : "fail", row.status));
      tr.appendChild(el("td", "", row.reason));
      q.appendChild(tr);
    });
    $("eval-caveat").textContent = report.scope +
      "。本机真实 MCP 评测另有 14 项流程检查、26 次工具调用与延迟数据，这里不复刻也不冒充。检索语料评测不是学习成效。";

    var p = $("platform-table");
    clear(p);
    PLATFORM.forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(el("td", "", row[0]));
      var td = el("td");
      td.appendChild(document.createTextNode(row[1] + " "));
      td.appendChild(el("span", "state", "[" + row[2] + "]"));
      tr.appendChild(td);
      p.appendChild(tr);
    });
  }

  /* ---------- dialog ---------- */
  function openDialog(id) {
    var d = $(id);
    if (!d) return;
    if (id === "panel-review") {
      var review = $("review-content");
      clear(review);
      if (state.plan.length) renderPlan(review);
      else review.appendChild(raw("p", "subtle", "先提一个有讲义依据的问题，这里会列出本轮的复习建议。"));
    }
    if (id === "panel-runtime") {
      var runtime = $("runtime-content");
      clear(runtime);
      runtime.appendChild(el("p", "", state.query + " · " + state.result.courseName));
      renderMetrics(runtime, state.result);
      renderTrace(runtime, state.result);
    }
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  }
  function closeDialog(d) {
    if (typeof d.close === "function") d.close();
    else d.removeAttribute("open");
  }

  function openReplySection(id) {
    var section = $(id);
    section.open = true;
    section.querySelector("summary").focus({ preventScroll: true });
    section.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- 事件绑定 ---------- */
  $("ask-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var attachment = draftAttachment;
    setDraftAttachment(null);
    run($("question").value, $("course").value, attachment);
  });
  $("question").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("ask-form").requestSubmit();
    }
  });
  $("add-attachment").addEventListener("click", function () { openDialog("attachment-dialog"); });
  $("choose-attachment").addEventListener("click", function () {
    closeDialog($("attachment-dialog"));
    $("attachment-file").click();
  });
  $("use-sample-attachment").addEventListener("click", function () {
    setDraftAttachment(SAMPLE_ATTACHMENT);
    closeDialog($("attachment-dialog"));
  });
  $("attachment-file").addEventListener("change", function (event) {
    var file = event.target.files[0];
    if (file) setDraftAttachment({ name: file.name, size: file.size, matchesSample: isSampleDeck(file) });
    event.target.value = "";
  });
  $("btn-examples").addEventListener("click", function () {
    $("starters").hidden = false;
    $("starters").scrollIntoView({ behavior: "smooth", block: "center" });
    $("starters-chips").classList.add("bx-expanded");
    $("toggle-starters").textContent = "收起";
  });
  $("toggle-starters").addEventListener("click", function () {
    var expanded = $("starters-chips").classList.toggle("bx-expanded");
    $("toggle-starters").textContent = expanded ? "收起" : "展开全部";
  });
  $("open-tools").addEventListener("click", function () { openDialog("tools-dialog"); });
  $("open-sources").addEventListener("click", function () {
    closeDialog($("tools-dialog"));
    openReplySection("reply-sources");
  });
  document.querySelectorAll("[data-open]").forEach(function (b) {
    b.addEventListener("click", function () {
      var current = b.closest("dialog");
      if (current) closeDialog(current);
      openDialog("panel-" + b.getAttribute("data-open"));
    });
  });
  document.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", function () { closeDialog(b.closest("dialog")); });
  });
  document.querySelectorAll("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) closeDialog(d); });
  });
  $("byok-save").addEventListener("click", saveByok);
  $("byok-run").addEventListener("click", callByok);
  $("byok-clear").addEventListener("click", clearByok);

  bindScenarios();
  renderStarters();
  renderPanels();
  var linkParams = new URLSearchParams(location.search);
  var linkedCourse = linkParams.get("course");
  var linkedQuestion = linkParams.get("question");
  if (Object.prototype.hasOwnProperty.call(CORPUS.courses, linkedCourse) && linkedQuestion) {
    $("course").value = linkedCourse;
    $("question").value = linkedQuestion.slice(0, $("question").maxLength);
  }
})();
