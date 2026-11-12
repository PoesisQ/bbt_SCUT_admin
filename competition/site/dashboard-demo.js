(() => {
  "use strict";

  const sample = BUXUE_LESSON;
  const corpus = BUXUE_CORPUS;
  const courseName = corpus.courses[sample.course];
  const courseNames = { [sample.course]: courseName, neuro: "神经科学" };
  const storageKey = "buxue.course-notes.v1";
  const localPreview = ["127.0.0.1", "localhost"].includes(location.hostname);
  let imported = new Map();
  const evidence = new Map(BuxueRetrieval.buildIndex(corpus).chunks.map(item => [item.id, item]));
  const topics = sample.topics.map(topic => ({ ...topic, source: evidence.get(topic.evidence) }));
  const notices = BuxueRetrieval.courseNotices(corpus, sample.course,
    ["assignment_due", "assignment_requirements", "exam_time", "exam_scope"]);
  const $ = id => document.getElementById(id);
  const tabs = [...document.querySelectorAll("[data-view]")];
  let chosenCourse = "";
  let filter = "lessons";
  let selectedTime;
  let map;
  let mapReady;

  function node(tag, text, classes) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (classes) element.className = classes;
    return element;
  }

  function button(text, action, classes) {
    const element = node("button", text, classes);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  }

  function matches(parts, query) {
    const text = parts.join(" ").toLowerCase();
    return query.trim().toLowerCase().split(/\s+/).every(word => text.includes(word));
  }

  function clock(seconds) {
    return [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
  }

  function indexNotes(bundle) {
    if (bundle?.version !== 1 || !Array.isArray(bundle.lessons) || !bundle.lessons.length) {
      throw new Error("预设课程笔记暂不可用，请刷新后重试。");
    }
    const source = bundle.source === "sample" ? "原创示例" : "本机笔记";
    const records = new Map();
    for (const lesson of bundle.lessons) {
      const summary = lesson?.summary;
      if (!/^neuro-(?:[a-f\d]{16}|sample-[a-z]+)$/.test(lesson?.id) || typeof lesson.title !== "string" || !lesson.title.trim()
          || !Array.isArray(summary?.topics) || !summary.topics.length
          || summary.topics.some(topic => typeof topic?.title !== "string" || typeof topic.detail !== "string")) {
        throw new Error("预设课程笔记格式不完整，暂时无法导入。");
      }
      const groups = Array.isArray(summary.groups) ? summary.groups.filter(group => typeof group?.title === "string") : [];
      const sections = Array.isArray(summary.sections) ? summary.sections.filter(section => typeof section?.overview === "string") : [];
      const searchText = [courseNames.neuro, lesson.title, summary.headline, summary.abstract, summary.overview,
        ...groups.flatMap(group => [group.title, group.detail]), ...sections.map(section => section.overview),
        ...summary.topics.flatMap(topic => [topic.title, topic.chapter, topic.detail])].join(" ").toLowerCase();
      records.set(lesson.id, { id: lesson.id, title: lesson.title, course: "neuro", source,
        summary: { ...summary, groups, sections }, searchText });
    }
    return records;
  }

  async function readPresetNotes() {
    if (localPreview) {
      try {
        const response = await fetch("local-course-notes", { cache: "no-store" });
        if (response.ok && response.headers.get("content-type")?.startsWith("application/json")) {
          const bundle = await response.json();
          if (bundle?.lessons?.length) return bundle;
        }
      } catch { /* A static preview can still import the original examples. */ }
    }
    return globalThis.BUXUE_NEURO_SAMPLE;
  }

  async function importNotes() {
    const control = $("import-course-notes");
    const result = $("import-result");
    control.disabled = true;
    result.hidden = false;
    result.textContent = "正在读取课程笔记并建立搜索索引…";
    try {
      const bundle = await readPresetNotes();
      const firstImport = !imported.size;
      imported = indexNotes(bundle);
      try { sessionStorage.setItem(storageKey, JSON.stringify(bundle)); } catch { /* Keep the current view usable. */ }
      const records = [...imported.values()];
      const topics = records.reduce((count, lesson) => count + lesson.summary.topics.length, 0);
      const themes = records.reduce((count, lesson) => count + lesson.summary.groups.length, 0);
      result.textContent = `已导入 ${records.length} 节课 · ${records[0].source} · ${themes} 个主题 · ${topics} 段笔记可搜索`;
      if (firstImport && !$("browse").hidden) {
        $("search").value = "";
        setFilter("lessons");
        openLibrary("");
      } else {
        renderRoute();
      }
    } catch (error) {
      result.textContent = error.message;
    } finally {
      control.disabled = false;
    }
  }

  function sourceLabel(source) {
    return `${source.title} · ${BuxueRetrieval.locatorText(source)}`;
  }

  function noticeCard(item, fromList) {
    const card = node("article", undefined, "library-event");
    const category = item.notice.startsWith("assignment_") ? "assignment" : "quiz";
    card.dataset.category = category;
    card.append(node("span", category === "assignment" ? "作业" : "测验考试", "event-badge"),
      node("h3", BuxueRetrieval.NOTICE_LABELS[item.notice]), node("p", item.text),
      node("small", `模拟教师通知 · ${sourceLabel(item)}`));
    if (item.id === "timing_due_current:0") {
      const previous = evidence.get("timing_due_original:0");
      const history = node("details", undefined, "event-source");
      history.append(node("summary", "查看改期前的通知"), node("blockquote", previous.text),
        node("small", `${sourceLabel(previous)} · 已被改期通知替代`));
      card.append(history);
    }
    if (fromList) card.append(button("查看课时 →", () => openLesson(sample.id, "events")));
    return card;
  }

  function countLabel(course) {
    const count = (course === sample.course ? 0 : imported.size) + (course === "neuro" ? 0 : 1);
    return `${count} 节课 · ${count} 份笔记`;
  }

  function lessonCard(lesson) {
    const isSample = lesson.id === sample.id;
    const card = button(undefined, () => openLesson(lesson.id, isSample ? "summary" : ""),
      isSample ? "note-card records-sample" : "note-card records-import");
    const footer = node("footer");
    footer.append(node("span", "笔记已就绪", "note-state"),
      node("span", isSample ? `${topics.length} 条字幕 · 查看课时 →` : `${lesson.summary.topics.length} 段笔记 · 查看课时 →`));
    const label = isSample ? courseName : `${courseNames[lesson.course]} · ${lesson.source}`;
    card.append(node("span", label, "note-meta"), node("h3", lesson.title));
    const description = isSample ? lesson.description : lesson.summary.headline;
    if (description) card.append(node("p", description));
    card.append(footer);
    return card;
  }

  function renderLibrary() {
    $("course-title").textContent = courseNames[chosenCourse] || "全部课程";
    $("course-meta").textContent = countLabel(chosenCourse);
    const courses = imported.size ? ["", sample.course, "neuro"] : ["", sample.course];
    $("course-list").replaceChildren(...courses.map(code => {
      const choice = button(undefined, () => openLibrary(code),
        `course-choice${code === chosenCourse ? " active" : ""}`);
      choice.append(node("strong", courseNames[code] || "全部课程"), node("small", countLabel(code)));
      choice.setAttribute("aria-pressed", String(code === chosenCourse));
      return choice;
    }));
    const query = $("search").value;
    const grid = $("lesson-grid");
    grid.replaceChildren();
    if (filter === "events") {
      const visibleNotices = !chosenCourse || chosenCourse === sample.course ? notices : [];
      for (const item of visibleNotices) {
        if (matches([courseName, sample.title, item.title, item.text, BuxueRetrieval.NOTICE_LABELS[item.notice]], query)) {
          grid.append(noticeCard(item, true));
        }
      }
    } else {
      for (const lesson of [sample, ...imported.values()]) {
        if (chosenCourse && lesson.course !== chosenCourse) continue;
        const terms = lesson.id === sample.id
          ? [courseName, sample.title, sample.description, ...topics.flatMap(topic => [topic.title, topic.source.text, topic.quote]),
            ...notices.map(item => item.text)]
          : [lesson.searchText];
        if (matches(terms, query)) grid.append(lessonCard(lesson));
      }
    }
    if (!grid.children.length) {
      const empty = node("div", undefined, "library-empty");
      const noCourseNotices = filter === "events" && chosenCourse === "neuro";
      empty.append(node("h3", noCourseNotices ? "本次导入的是课程笔记" : "没有匹配的内容"));
      if (!noCourseNotices) empty.append(node("p", "可以清除搜索条件再试。"));
      grid.append(empty);
    }
  }

  function renderImportedNotes(lesson) {
    const target = $("import-detail");
    const { summary } = lesson;
    const text = value => node("p", value, "records-paragraph");
    const stamp = seconds => clock(Math.floor(seconds));
    target.replaceChildren();
    if (summary.abstract) target.append(node("p", summary.abstract, "lesson-abstract"));
    if (summary.overview || summary.sections.length) {
      const overview = node("details", undefined, "topic-note records-note-overview");
      overview.append(node("summary", "查看整课和分段概览"));
      if (summary.overview) overview.append(text(summary.overview));
      for (const section of summary.sections) {
        if (Number.isFinite(section.start) && Number.isFinite(section.end)) {
          overview.append(node("h3", `${stamp(section.start)}–${stamp(section.end)}`));
        }
        overview.append(text(section.overview));
      }
      target.append(overview);
    }
    LectureNotes.mount(target, lesson, {
      seek: lesson.source === "本机笔记"
        ? seconds => node("span", Number.isFinite(seconds) ? stamp(seconds) : "", "notes-count") : undefined,
      markdown: text
    });
  }

  function renderCompare(index) {
    const topic = topics[index];
    const columns = $("compare-content");
    const original = node("article", undefined, "topic-note");
    original.append(node("h3", "课件原文"), node("small", sourceLabel(topic.source)), node("p", topic.source.text));
    if (topic.source.illustration) {
      const figure = node("figure", undefined, "records-waveform");
      const image = node("img");
      image.src = "data/" + encodeURIComponent(topic.source.illustration);
      image.alt = topic.source.illustration_alt;
      figure.append(image, node("figcaption", "原创教学波形", "muted"));
      original.append(figure);
    }
    const lecture = node("article", undefined, "topic-note");
    lecture.append(node("h3", "模拟课堂讲述"), node("p", topic.quote),
      button(`${clock(topic.start)}–${clock(topic.end)} · 查看字幕`, () => openTranscript(topic.start)));
    const note = node("article", undefined, "topic-note");
    note.append(node("h3", "分段笔记"), node("p", topic.title),
      button("返回主题笔记", () => selectTab("summary")));
    columns.replaceChildren(original, lecture, note);
  }

  function renderTranscript() {
    const query = $("transcript-search").value;
    const transcript = $("transcript");
    transcript.replaceChildren();
    for (const topic of topics) {
      if (!matches([topic.title, topic.quote, clock(topic.start)], query)) continue;
      const segment = node("div", undefined, "segment");
      segment.id = `segment-${topic.start}`;
      segment.tabIndex = -1;
      segment.classList.toggle("selected-segment", selectedTime === topic.start);
      segment.append(node("span", `${clock(topic.start)}–${clock(topic.end)}`, "muted"), node("span", topic.quote));
      transcript.append(segment);
    }
    if (!transcript.children.length) transcript.append(node("p", "没有匹配的字幕。", "muted"));
  }

  function openTranscript(start) {
    selectedTime = start;
    $("transcript-search").value = "";
    renderTranscript();
    selectTab("transcript");
    const target = $(`segment-${start}`);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
  }

  async function showMap() {
    if (!map) {
      map = SCUTMarkmap.Markmap.create($("lesson-map"), { duration: 0, autoFit: false, maxWidth: 200 });
      mapReady = map.setData({
        content: "松针-27 时序实验",
        children: sample.themes.map(theme => ({ content: theme.title,
          children: theme.topic_indices.map(index => ({ content: topics[index].title, children: [] })) }))
      });
    }
    await mapReady;
    if (!$("view-mindmap").hidden) await map.fit();
  }

  function selectTab(view) {
    const validView = tabs.some(tab => tab.dataset.view === view) ? view : "summary";
    for (const tab of tabs) {
      const active = tab.dataset.view === validView;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute("aria-controls")).hidden = !active;
    }
    if (validView === "mindmap") void showMap();
    history.replaceState(null, "", BuxueLinks.url("dashboard.html", { course: chosenCourse, session: sample.id, tab: validView }));
  }

  function renderRoute() {
    const params = new URLSearchParams(location.search);
    const id = params.get("session");
    const lesson = id === sample.id ? sample : imported.get(id);
    const course = params.get("course");
    chosenCourse = course === sample.course || (course === "neuro" && imported.size) ? course : "";
    $("detail").hidden = !lesson;
    $("browse").hidden = Boolean(lesson);
    renderLibrary();
    if (!lesson) return;
    const isSample = lesson.id === sample.id;
    $("detail-course").textContent = courseNames[lesson.course];
    $("detail-title").textContent = lesson.title;
    $("detail-meta").textContent = isSample
      ? `原创示例课时 · ${topics.length} 条字幕 · ${sample.themes.length} 个主题`
      : `${lesson.source} · ${lesson.summary.groups.length} 个主题 · ${lesson.summary.topics.length} 段原笔记`;
    $("sample-actions").hidden = !isSample;
    $("sample-detail").hidden = !isSample;
    $("import-detail").hidden = isSample;
    if (isSample) {
      selectTab(params.get("tab"));
    } else {
      renderImportedNotes(lesson);
    }
  }

  function openLesson(id, tab) {
    history.pushState(null, "", BuxueLinks.url("dashboard.html", { course: chosenCourse, session: id, tab }));
    renderRoute();
    $("detail-title").focus();
  }

  function openLibrary(course = chosenCourse) {
    const url = BuxueLinks.url("dashboard.html", { course });
    if (url !== location.href) history.pushState(null, "", url);
    renderRoute();
  }

  $("ask-lesson").href = BuxueLinks.url("index.html", { course: sample.course, question: sample.question });
  $("view-summary").append(node("p", sample.description, "lesson-abstract"));
  const notes = {
    id: sample.id,
    summary: {
      topics: topics.map(topic => ({ title: topic.title, detail: topic.source.text, start: topic.start,
        chapter: BuxueRetrieval.locatorText(topic.source) })),
      groups: sample.themes.map(theme => ({ ...theme,
        detail: theme.topic_indices.map(index => topics[index].source.text).join("\n\n") }))
    }
  };
  LectureNotes.mount($("view-summary"), notes, {
    seek: seconds => button(clock(seconds), () => openTranscript(seconds)),
    compare: index => { $("compare-topic").value = String(index); renderCompare(index); selectTab("compare"); },
    markdown: text => node("p", text, "records-paragraph")
  });
  $("compare-topic").append(...topics.map((topic, index) => {
    const option = node("option", topic.title);
    option.value = String(index);
    return option;
  }));
  $("compare-topic").addEventListener("change", event => renderCompare(Number(event.target.value)));
  $("view-events").append(...notices.map(item => noticeCard(item, false)));
  $("transcript-search").addEventListener("input", renderTranscript);
  $("fit-map").addEventListener("click", () => { void showMap(); });
  $("search").addEventListener("input", () => openLibrary());
  $("back-library").addEventListener("click", () => openLibrary());
  $("import-help").textContent = localPreview
    ? "一键导入神经科学课时，优先读取本机已分析的笔记。"
    : "一键导入神经科学示例课时，打开主题和分段笔记。";
  $("import-course-notes").addEventListener("click", importNotes);
  $("toggle-courses").addEventListener("click", event => {
    const rail = $("course-rail");
    rail.hidden = !rail.hidden;
    $("library-layout").classList.toggle("courses-hidden", rail.hidden);
    event.target.setAttribute("aria-expanded", String(!rail.hidden));
    event.target.textContent = rail.hidden ? "展开我的课程" : "收起我的课程";
  });
  const filters = [...document.querySelectorAll("[data-filter]")];
  function setFilter(next) {
    filter = next;
    for (const item of filters) {
      item.classList.toggle("active", item.dataset.filter === filter);
      item.setAttribute("aria-pressed", String(item.dataset.filter === filter));
    }
  }
  for (const option of filters) option.addEventListener("click", () => {
    setFilter(option.dataset.filter);
    renderLibrary();
  });
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => selectTab(tab.dataset.view));
    tab.addEventListener("keydown", event => {
      const movement = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length,
        Home: 0, End: tabs.length - 1 };
      if (!(event.key in movement)) return;
      event.preventDefault();
      const next = tabs[movement[event.key]];
      selectTab(next.dataset.view);
      next.focus();
    });
  }
  window.addEventListener("popstate", renderRoute);
  renderCompare(0);
  renderTranscript();
  try {
    const cached = sessionStorage.getItem(storageKey);
    if (cached) imported = indexNotes(JSON.parse(cached));
  } catch { /* An unavailable cache leaves the original sample ready to use. */ }
  renderRoute();
})();
