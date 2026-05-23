const API_BASE = "https://video.jw.scut.edu.cn";
const API = {
  SUBTITLE: (subId) => `${API_BASE}/courseapi/v3/web-socket/search-trans-result?sub_id=${encodeURIComponent(subId)}&format=json`,
  SUB_INFO: (courseId, subId) => `${API_BASE}/courseapi/v3/portal-home-setting/get-sub-info?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}`,
  COURSE_TITLE: (courseId) => `${API_BASE}/courseapi/v3/multi-search/get-course-teacher-others?course_id=${encodeURIComponent(courseId)}&per_page=1`,
  CATALOGUE: (courseId) => `${API_BASE}/courseapi/v2/course/catalogue?course_id=${encodeURIComponent(courseId)}`,
};

// === URL parsing ===

function parseCourseUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "video.jw.scut.edu.cn") return null;
    const subId = u.searchParams.get("sub_id");
    if (!subId) return null;
    return { subId, courseId: u.searchParams.get("course_id") };
  } catch {
    return null;
  }
}

// === Filename sanitization ===

function sanitizeFilename(name) {
  const cleaned = name.replace(/[\/\\:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || "untitled";
}

// === API calls ===

async function fetchSubtitle(subId) {
  const resp = await fetch(API.SUBTITLE(subId), { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function fetchCourseInfo(courseId, subId) {
  const resp = await fetch(API.SUB_INFO(courseId, subId), { credentials: "include" });
  if (!resp.ok) return null;
  return (await resp.json())?.data || null;
}

async function fetchCourseTitle(courseId) {
  const resp = await fetch(API.COURSE_TITLE(courseId), { credentials: "include" });
  if (!resp.ok) return null;
  return (await resp.json())?.data?.[0]?.course_title || null;
}

async function fetchCatalogue(courseId) {
  const resp = await fetch(API.CATALOGUE(courseId), { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json())?.result?.data || [];
}

// === JSON parsing ===

function extractSubtitleItems(body) {
  if (Array.isArray(body)) {
    if (body.length > 0 && typeof body[0] === "object" && "BeginSec" in body[0]) return body;
    for (const item of body) {
      if (item && typeof item === "object") {
        const inner = extractSubtitleItems(item);
        if (inner.length > 0) return inner;
      }
    }
    return [];
  }
  if (body && typeof body === "object") {
    for (const key of ["all_content", "data", "result", "list", "rows"]) {
      const value = body[key];
      if (Array.isArray(value) && value.length > 0) {
        const inner = extractSubtitleItems(value);
        if (inner.length > 0) return inner;
      }
    }
  }
  return [];
}

// === Format conversion ===

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function toSrt(items) {
  let idx = 0;
  return items
    .filter((item) => item.Text?.trim())
    .map((item) => {
      idx++;
      const start = formatTime(item.BeginSec);
      const end = formatTime(item.EndSec || item.BeginSec + 5);
      return `${idx}\n${start} --> ${end}\n${item.Text.trim()}`;
    })
    .join("\n\n");
}

function toTxt(items) {
  return items
    .filter((item) => item.Text?.trim())
    .map((item) => item.Text.trim())
    .join("\n");
}

// === Download ===

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false }, () => URL.revokeObjectURL(url));
}

async function downloadZip(files, zipName) {
  const zip = new JSZip();
  for (const { name, content } of files) {
    zip.file(name, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: zipName, saveAs: false }, () => URL.revokeObjectURL(url));
}

// === UI helpers ===

function showStatus(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `status ${type}`;
}

// === Main ===

document.addEventListener("DOMContentLoaded", async () => {
  const mainEl = document.getElementById("main");
  const errorEl = document.getElementById("error-page");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const parsed = parseCourseUrl(tab.url);

  if (!parsed) {
    errorEl.classList.remove("hidden");
    return;
  }

  const { subId, courseId } = parsed;
  mainEl.classList.remove("hidden");

  let courseTitle = null;
  let catalogue = [];

  // === Load course info (single tab) ===
  if (courseId) {
    const [info, title] = await Promise.all([
      fetchCourseInfo(courseId, subId),
      fetchCourseTitle(courseId),
    ]);
    courseTitle = title;
    if (title) document.getElementById("course-name").textContent = title;
    if (info) {
      document.getElementById("lecturer-name").textContent = info.lecturer_name || "-";
      document.getElementById("sub-title").textContent = info.sub_title || "-";
      document.getElementById("course-subtitle").textContent =
        `${info.lecturer_name || ""} · ${info.sub_title || subId}`;
    } else {
      document.getElementById("sub-title").textContent = subId;
      document.getElementById("course-subtitle").textContent = `sub_id: ${subId}`;
    }
  } else {
    document.getElementById("sub-title").textContent = subId;
    document.getElementById("course-subtitle").textContent = `sub_id: ${subId}`;
  }

  // === Tab switching ===
  document.querySelectorAll(".tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
      tabBtn.classList.add("active");
      document.getElementById(`tab-${tabBtn.dataset.tab}`).classList.add("active");
    });
  });

  // === Single lesson download ===
  document.getElementById("download-btn").addEventListener("click", async () => {
    const wantSrt = document.getElementById("fmt-srt").checked;
    const wantTxt = document.getElementById("fmt-txt").checked;
    const wantJson = document.getElementById("fmt-json").checked;
    if (!wantSrt && !wantTxt && !wantJson) {
      showStatus("status-single", "请至少选择一种格式", "error");
      return;
    }

    const btn = document.getElementById("download-btn");
    btn.disabled = true;
    showStatus("status-single", "正在获取字幕...", "loading");

    try {
      const raw = await fetchSubtitle(subId);
      const items = extractSubtitleItems(raw);
      if (items.length === 0) {
        showStatus("status-single", "该课时暂无字幕数据", "error");
        return;
      }
      if (wantSrt) downloadFile(toSrt(items), `subtitle_${subId}.srt`);
      if (wantTxt) downloadFile(toTxt(items), `subtitle_${subId}.txt`);
      if (wantJson) downloadFile(JSON.stringify(items, null, 2), `subtitle_${subId}.json`);
      showStatus("status-single", `已下载 ${items.length} 条字幕`, "success");
    } catch (err) {
      showStatus("status-single", err.message || "获取失败", "error");
    } finally {
      btn.disabled = false;
    }
  });

  // === Batch: load catalogue ===
  if (courseId) {
    try {
      catalogue = await fetchCatalogue(courseId);
    } catch {
      catalogue = [];
    }
  }

  const listEl = document.getElementById("lesson-list");
  const countEl = document.getElementById("lesson-count");

  if (catalogue.length === 0) {
    countEl.textContent = "未找到课程目录";
  } else {
    countEl.textContent = `已选 ${catalogue.length} / ${catalogue.length} 节`;

    catalogue.forEach((lesson) => {
      const item = document.createElement("div");
      item.className = "lesson-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "lesson-check";
      checkbox.dataset.subId = lesson.sub_id;
      checkbox.checked = true;

      const label = document.createElement("span");
      label.className = "lesson-title";
      label.textContent = lesson.title || lesson.sub_id;

      item.appendChild(checkbox);
      item.appendChild(label);
      listEl.appendChild(item);
    });

    const selectAll = document.getElementById("select-all");
    selectAll.addEventListener("change", () => {
      listEl.querySelectorAll(".lesson-check").forEach((c) => (c.checked = selectAll.checked));
      updateCount();
    });
    listEl.addEventListener("change", (e) => {
      if (e.target.classList.contains("lesson-check")) updateCount();
    });
  }

  function getSelectedLessons() {
    return Array.from(listEl.querySelectorAll(".lesson-check:checked")).map(
      (c) => c.dataset.subId
    );
  }

  function updateCount() {
    const total = catalogue.length;
    const selected = getSelectedLessons().length;
    countEl.textContent = `已选 ${selected} / ${total} 节`;
    document.getElementById("select-all").checked = selected === total;
  }

  // === Batch download ===
  document.getElementById("batch-download-btn").addEventListener("click", async () => {
    const selectedSubIds = getSelectedLessons();
    if (selectedSubIds.length === 0) {
      showStatus("status-batch", "请至少选择一节课", "error");
      return;
    }

    const wantSrt = document.getElementById("batch-fmt-srt").checked;
    const wantTxt = document.getElementById("batch-fmt-txt").checked;
    const wantJson = document.getElementById("batch-fmt-json").checked;
    if (!wantSrt && !wantTxt && !wantJson) {
      showStatus("status-batch", "请至少选择一种格式", "error");
      return;
    }

    const btn = document.getElementById("batch-download-btn");
    btn.disabled = true;
    const progressBar = document.getElementById("batch-progress-bar");
    const progressFill = document.getElementById("batch-progress-fill");
    progressBar.classList.remove("hidden");
    showStatus("status-batch", `正在获取 0/${selectedSubIds.length}...`, "loading");

    const files = [];
    const failed = [];
    let successLessons = 0;

    for (let i = 0; i < selectedSubIds.length; i++) {
      const sid = selectedSubIds[i];
      const lesson = catalogue.find((l) => l.sub_id === sid);
      const label = sanitizeFilename(lesson?.title || sid);
      const prefix = `${String(i + 1).padStart(2, "0")}_${label}_${sid}`;

      try {
        const raw = await fetchSubtitle(sid);
        const items = extractSubtitleItems(raw);
        if (items.length > 0) {
          if (wantSrt) files.push({ name: `${prefix}.srt`, content: toSrt(items) });
          if (wantTxt) files.push({ name: `${prefix}.txt`, content: toTxt(items) });
          if (wantJson) files.push({ name: `${prefix}.json`, content: JSON.stringify(items, null, 2) });
          successLessons++;
        } else {
          failed.push(label);
          console.warn(`[SCUT] 课时 "${label}" (${sid}) 无字幕数据`);
        }
      } catch (err) {
        failed.push(label);
        console.warn(`[SCUT] 课时 "${label}" (${sid}) 获取失败:`, err.message);
      }

      const pct = Math.round(((i + 1) / selectedSubIds.length) * 100);
      progressFill.style.width = `${pct}%`;
      showStatus("status-batch", `正在获取 ${i + 1}/${selectedSubIds.length}...`, "loading");
    }

    if (files.length > 0) {
      const zipName = sanitizeFilename(`${courseTitle || "subtitles"}.zip`);
      await downloadZip(files, zipName);
      const summary = `${successLessons} 节成功，${failed.length} 节失败，${files.length} 个文件`;
      const msg = failed.length > 0
        ? `完成：${summary}（失败：${failed.slice(0, 3).join("、")}${failed.length > 3 ? "..." : ""}）`
        : `完成：${summary}`;
      showStatus("status-batch", msg, "success");
    } else {
      showStatus("status-batch", "未能获取任何字幕数据", "error");
    }

    btn.disabled = false;
  });
});
