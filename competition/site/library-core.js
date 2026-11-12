(function(root){
  "use strict";
  const busy = s => ["queued","running"].includes(s.analysis_status);
  const titles = s => [...new Set((s.summary?.topics || []).map(t=>t.title).filter(Boolean))];
  const hasNotes = s => !!s.summary && !s.summary.partial && s.analysis_status === "complete";
  const needsNotes = s => s.status !== "cancelled" && !!s.segment_count && !hasNotes(s);
  const pending = s => s.isImport ? ["pending","failed"].includes(s.status) : needsNotes(s)||["queued","downloading","transcribing","processing","failed"].includes(s.status);
  const eventCategories=[
    {id:"assignment",label:"作业"},{id:"quiz",label:"测验考试"},{id:"attendance",label:"点名签到"},
    {id:"qr",label:"扫码互动"},{id:"question",label:"课堂提问"},{id:"schedule",label:"课程安排"},
    {id:"grading",label:"评分"},{id:"requirements",label:"课程要求"},{id:"reminder",label:"特别提醒"}
  ];
  function lessonTime(s){
    const versions=[s,...(s.versions||[])];
    for(const version of versions){const start=Number(version.start_at);if(Number.isFinite(start)&&start>0)return start;}
    for(const version of versions){
      const date=String(version.title||"").match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if(!date)continue;
      const [year,month,day,hour,minute,second]=date.slice(1).map(value=>(value||"0").padStart(2,"0"));
      const parsed=Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`)/1000;
      if(Number.isFinite(parsed)&&parsed>0)return parsed;
    }
    const created=Number(s.created_at);return Number.isFinite(created)&&created>0?created:0;
  }
  function compareLessons(a,b){return lessonTime(b)-lessonTime(a);}
  function lessons(records){
    const map=new Map();
    for(const s of records){const key=s.course_id+":"+s.sub_id;if(!map.has(key))map.set(key,[]);map.get(key).push(s);}
    return [...map.values()].map(versions=>{
      const span=Math.max(0,...versions.filter(s=>s.time_basis!=="capture").map(s=>s.coverage_seconds||0));
      const comprehensive=s=>s.time_basis!=="capture"&&(s.coverage_seconds||0)>=span*.95;
      const ranked=[...versions].sort((a,b)=>Number(!b.isImport)-Number(!a.isImport)||Number(comprehensive(b))-Number(comprehensive(a))||Number(hasNotes(b))-Number(hasNotes(a))||(b.coverage_seconds||0)-(a.coverage_seconds||0)||b.created_at-a.created_at);
      const events=new Map();for(const s of versions)for(const e of s.important_events||[]){const key=[s.time_basis==="capture"?s.id:"video",e.start,e.category,e.message].join("|");if(!events.has(key))events.set(key,{...e,sid:s.id,lesson_at:lessonTime(s),time_basis:s.time_basis,page_url:s.page_url});}
      const main=ranked[0],ready=versions.filter(hasNotes),readyCoverage=Math.max(0,...ready.filter(s=>s.time_basis!=="capture").map(s=>s.coverage_seconds||0));
      const meaningfulPending=ready.length?versions.some(s=>pending(s)&&!s.isImport&&s.time_basis!=="capture"&&(s.coverage_seconds||0)>readyCoverage*1.05):versions.some(pending);
      return {...main,important_events:[...events.values()],versions:ranked,lesson_pending:meaningfulPending,record_count:versions.filter(s=>!s.isImport).length};
    });
  }
  function importRows(imports){
    const latest=new Map();
    for(const item of [...imports].sort((a,b)=>b.created_at-a.created_at)){
      const key=item.course_id+":"+item.sub_id;
      if(!latest.has(key))latest.set(key,item);
    }
    return [...latest.values()].filter(i=>["pending","failed"].includes(i.status)).map(i=>({...i,isImport:true,segment_count:0,event_count:0}));
  }
  function groups(sessions){
    const result = new Map();
    for(const s of sessions){
      const key = s.course_id || s.course_title || "unknown";
      if(!result.has(key))result.set(key,{id:key,title:s.course_title||"未命名课程",lessons:[]});
      result.get(key).lessons.push(s);
    }
    return [...result.values()].map(g=>({...g,topics:[...new Set(g.lessons.flatMap(s=>(s.versions||[s]).flatMap(v=>v.summary?.groups?.length?v.summary.groups.map(t=>t.title):titles(v))))],
      ready:g.lessons.filter(hasNotes).length,needs:g.lessons.filter(needsNotes).length,
      events:g.lessons.flatMap(s=>(s.important_events||[]).map(e=>({...e,sid:e.sid||s.id,lesson:s.title,lesson_at:e.lesson_at||lessonTime(s)})))}));
  }
  function eventTimeline(groups,category="all"){
    return groups.flatMap(g=>g.events.map(e=>({...e,course:g.title})))
      .filter(e=>category==="all"||e.category===category)
      .sort((a,b)=>(b.lesson_at||0)-(a.lesson_at||0)||(b.start||0)-(a.start||0)||(b.end||0)-(a.end||0));
  }
  function action(s,configured){
    if(s.status === "cancelled")return {label:"任务已取消",disabled:true};
    if(!s.stopped || ["queued","downloading","transcribing","processing"].includes(s.status))return {label:"等待字幕处理完成",disabled:true};
    if(busy(s))return {label:`正在整理 ${s.analysis_progress || ""}`.trim(),disabled:true};
    if(!configured)return {label:"设置分析 Key",settings:true};
    if(!s.segment_count)return {label:"暂无可分析字幕",disabled:true};
    if(hasNotes(s)&&!s.events_version)return {label:"整理完整事项"};
    if(hasNotes(s))return {label:"笔记已就绪",hidden:true};
    if(s.analysis_status === "failed")return s.notes_retry_at>Date.now()/1000&&s.notes_auto_attempts<3?{label:"稍后自动重试",disabled:true}:{label:"继续生成笔记"};
    return {label:"等待自动生成笔记",disabled:true};
  }
  const api={groups,lessons,titles,hasNotes,needsNotes,pending,importRows,busy,action,eventCategories,eventTimeline,compareLessons};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  root.CourseLibrary=api;
})(globalThis);

/* Theme-first reading. Original topic indexes remain the source of every action. */
(() => {
  "use strict";
  const states = new Map();
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  function sections(summary = {}) {
    const topics = Array.isArray(summary.topics) ? summary.topics : [];
    const groups = (Array.isArray(summary.groups) ? summary.groups : []).filter(g => g && typeof g.title === "string" && g.title.trim());
    const result = groups.map((g, index) => ({
      key: `group:${index}:${g.title}`, title: g.title, detail: g.detail || "", kind: "theme",
      indices: [...new Set((Array.isArray(g.topic_indices) ? g.topic_indices : []).filter(i => Number.isInteger(i) && i >= 0 && i < topics.length && topics[i]))]
    }));
    const covered = new Set(result.flatMap(g => g.indices));
    if (!result.length) {
      const chapters = new Map();
      topics.forEach((topic, index) => {
        const title = typeof topic?.chapter === "string" ? topic.chapter.trim() : "";
        if (!title) return;
        if (!chapters.has(title)) chapters.set(title, {key: `chapter:${title}`, title, detail: "", kind: "chapter", indices: []});
        chapters.get(title).indices.push(index); covered.add(index);
      });
      result.push(...chapters.values());
    }
    const remaining = topics.flatMap((topic, index) => topic && !covered.has(index) ? [index] : []);
    if (remaining.length) result.push({key: "ungrouped", title: result.length ? "尚未归组的笔记" : "课堂笔记", detail: "", kind: "ungrouped", indices: remaining});
    return result;
  }
  function matchingTopics(topics, query) {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return topics.flatMap((topic, index) => {
      if (!topic) return [];
      const text = [topic.title, topic.chapter, topic.detail].join(" ").toLocaleLowerCase();
      return words.every(word => text.includes(word)) ? [index] : [];
    });
  }
  function mount(root, record, {seek, compare, markdown}) {
    const summary = record.summary || {}, topics = summary.topics || [], groups = sections(summary);
    const key = record.id || "current";
    if (!states.has(key)) states.set(key, {selected: "", mode: "read", query: "", opened: new Set(), sources: new Set()});
    const state = states.get(key);
    if (!groups.some(group => group.key === state.selected)) state.selected = groups[0]?.key || "";
    const box = el("section", undefined, "lesson-reading");
    box.setAttribute("aria-label", "按主题学习课程笔记");
    const toolbar = el("div", undefined, "notes-toolbar"), modes = el("div", undefined, "notes-modes");
    modes.setAttribute("role", "group"); modes.setAttribute("aria-label", "笔记阅读方式");
    const button = (text, action, cls) => { const node = el("button", text, cls); node.type = "button"; node.onclick = action; return node; };
    const readButton = button("按主题学习", () => switchMode("read"));
    const findButton = button("查找分段笔记", () => switchMode("find"));
    modes.append(readButton, findButton);
    const themeCount = groups.filter(g => g.kind === "theme").length;
    const chapterCount = groups.filter(g => g.kind === "chapter").length;
    toolbar.append(modes, el("span", `${themeCount ? themeCount + " 个主题 · " : chapterCount ? chapterCount + " 个章节 · " : ""}${topics.filter(Boolean).length} 段原笔记${summary.partial ? " · 仍在整理" : ""}`, "notes-count"));
    const reading = el("div", undefined, "notes-reading"), directory = el("nav", undefined, "notes-directory"), article = el("article", undefined, "notes-article");
    directory.setAttribute("aria-label", "本课主题目录");
    directory.append(el("h3", themeCount ? "本课主题" : chapterCount ? "本课章节" : "本课内容"));
    const choices = [];
    for (const [index, group] of groups.entries()) {
      const choice = button(undefined, () => select(group.key), "notes-theme-choice");
      choice.append(el("span", String(index + 1).padStart(2, "0"), "notes-order"), el("span", group.title));
      choices.push([group.key, choice]); directory.append(choice);
    }
    if (!themeCount && topics.length) directory.append(el("p", summary.partial ? "主题还在整理，可先按已有章节或查找原笔记。" : "当前笔记没有主题概览，先按已有章节查看；分段原文均保留。", "notes-hint"));
    reading.append(directory, article);
    const finder = el("section", undefined, "notes-finder"), searchLabel = el("label", "在本课笔记中查找"), input = el("input"), count = el("p", undefined, "notes-count"), results = el("div", undefined, "notes-source-list");
    input.type = "search"; input.placeholder = "搜索概念、公式或笔记中的内容"; input.value = state.query;
    searchLabel.append(input); count.setAttribute("role", "status");
    finder.append(searchLabel, count, results);
    input.oninput = () => { state.query = input.value; renderSearch(); };
    box.append(toolbar, reading, finder); root.append(box);

    function topicNode(index, prefix) {
      const topic = topics[index], note = el("details", undefined, "notes-source"), heading = el("summary", topic.title || `分段笔记 ${index + 1}`);
      const openKey = JSON.stringify([prefix, index, topic.title, topic.start]);
      note.id = `${prefix}-topic-${index}`; note.open = state.opened.has(openKey);
      const actions = el("div", undefined, "notes-source-actions");
      if (seek) actions.append(seek(topic.start));
      if (compare) actions.append(button("课件 · 原话 · 笔记 ↗", () => compare(index)));
      if (topic.chapter) actions.append(el("span", topic.chapter, "notes-count"));
      note.append(heading, actions, markdown(topic.detail || ""));
      note.addEventListener("toggle", () => {
        if (!note.isConnected) return;
        if (note.open) state.opened.add(openKey); else state.opened.delete(openKey);
      });
      return note;
    }
    function renderSearch() {
      const indices = matchingTopics(topics, state.query);
      count.textContent = state.query.trim() ? `找到 ${indices.length} / ${topics.filter(Boolean).length} 段笔记` : `全部 ${indices.length} 段笔记 · 按课堂记录顺序`;
      results.replaceChildren(...indices.map(index => topicNode(index, "find")));
      if (!indices.length) results.append(el("p", topics.length ? "没有找到匹配内容，试试更短的词或英文名称。" : "当前还没有分段笔记。", "notes-hint"));
    }
    function select(selectedKey, focus = false) {
      state.selected = selectedKey;
      const index = groups.findIndex(group => group.key === selectedKey), group = groups[index];
      for (const [choiceKey, choice] of choices) {
        choice.setAttribute("aria-current", choiceKey === selectedKey ? "true" : "false");
      }
      article.replaceChildren();
      if (!group) {
        article.append(markdown(summary.overview || "当前还没有可阅读的主题，笔记生成后会显示在这里。")); return;
      }
      const heading = el("h3", group.title); heading.tabIndex = -1;
      article.append(el("p", `${group.kind === "theme" ? "主题" : group.kind === "chapter" ? "章节" : "笔记"} ${index + 1} / ${groups.length}`, "notes-position"), heading);
      if (group.detail) article.append(markdown(group.detail));
      else article.append(el("p", group.kind === "ungrouped" ? "这些笔记尚未形成主题概览，可展开阅读原文。" : "按原笔记的章节归在一起，展开查看具体讲述。", "notes-hint"));
      if (group.indices.length) {
        const sourceList = el("div", undefined, "notes-source-list");
        sourceList.append(...group.indices.map(topicIndex => topicNode(topicIndex, "read")));
        if (group.detail) {
          const sources = el("details", undefined, "notes-sources"); sources.open = state.sources.has(group.key);
          sources.append(el("summary", `展开本主题的原笔记 · ${group.indices.length} 段`), sourceList);
          sources.addEventListener("toggle", () => {
            if (!sources.isConnected) return;
            if (sources.open) state.sources.add(group.key); else state.sources.delete(group.key);
          });
          article.append(sources);
        } else article.append(sourceList);
      } else article.append(el("p", "此主题没有关联分段，可通过“查找分段笔记”回查本课记录。", "notes-hint"));
      if (groups.length > 1) {
        const navigation = el("nav", undefined, "notes-pagination"); navigation.setAttribute("aria-label", "切换学习主题");
        const previous = button("← 上一个主题", () => select(groups[index - 1].key, true));
        const next = button("下一个主题 →", () => select(groups[index + 1].key, true));
        previous.disabled = index === 0; next.disabled = index === groups.length - 1;
        navigation.append(previous, next); article.append(navigation);
      }
      if (focus) { heading.focus({preventScroll: true}); heading.scrollIntoView({block: "nearest", behavior: "instant"}); }
    }
    function switchMode(mode) {
      state.mode = mode; reading.hidden = mode !== "read"; finder.hidden = mode !== "find";
      readButton.setAttribute("aria-pressed", String(mode === "read")); findButton.setAttribute("aria-pressed", String(mode === "find"));
      if (mode === "find") { renderSearch(); input.focus({preventScroll: true}); }
    }
    select(state.selected);
    // Refreshes retain the reader's place without moving keyboard focus.
    reading.hidden = state.mode !== "read"; finder.hidden = state.mode !== "find";
    readButton.setAttribute("aria-pressed", String(state.mode === "read")); findButton.setAttribute("aria-pressed", String(state.mode === "find"));
    if (state.mode === "find") renderSearch();
  }
  globalThis.LectureNotes = {sections, matchingTopics, mount};
  if (typeof module !== "undefined") module.exports.notes = globalThis.LectureNotes;
})();
