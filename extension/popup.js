const API_BASE = "https://video.jw.scut.edu.cn";

// === URL parsing ===

function parseCourseUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("video.jw.scut.edu.cn")) return null;
    const params = u.searchParams;
    const subId = params.get("sub_id");
    if (!subId) return null;
    return {
      subId,
      courseId: params.get("course_id"),
    };
  } catch {
    return null;
  }
}

// === API calls ===

async function fetchSubtitle(subId) {
  const resp = await fetch(
    `${API_BASE}/courseapi/v3/web-socket/search-trans-result?sub_id=${encodeURIComponent(subId)}&format=json`,
    { credentials: "include" }
  );
  if (!resp.ok) throw new Error(`字幕接口请求失败：HTTP ${resp.status}`);
  return resp.json();
}

async function fetchCourseInfo(courseId, subId) {
  const resp = await fetch(
    `${API_BASE}/courseapi/v3/portal-home-setting/get-sub-info?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}`,
    { credentials: "include" }
  );
  if (!resp.ok) return null;
  const body = await resp.json();
  return body?.data || null;
}

async function fetchCourseTitle(courseId) {
  const resp = await fetch(
    `${API_BASE}/courseapi/v3/multi-search/get-course-teacher-others?course_id=${encodeURIComponent(courseId)}&per_page=1`,
    { credentials: "include" }
  );
  if (!resp.ok) return null;
  const body = await resp.json();
  return body?.data?.[0]?.course_title || null;
}

// === JSON parsing (recursive, same logic as CLI) ===

function extractSubtitleItems(body) {
  if (Array.isArray(body)) {
    if (body.length > 0 && typeof body[0] === "object" && "BeginSec" in body[0]) {
      return body;
    }
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
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    URL.revokeObjectURL(url);
  });
}

// === UI helpers ===

function showStatus(text, type) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = `status ${type}`;
}

function hideStatus() {
  document.getElementById("status").className = "status hidden";
}

// === Main ===

document.addEventListener("DOMContentLoaded", async () => {
  const mainEl = document.getElementById("main");
  const errorEl = document.getElementById("error-page");

  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const parsed = parseCourseUrl(tab.url);

  if (!parsed) {
    errorEl.classList.remove("hidden");
    return;
  }

  const { subId, courseId } = parsed;

  mainEl.classList.remove("hidden");

  // Fetch course info
  if (courseId) {
    const [info, title] = await Promise.all([
      fetchCourseInfo(courseId, subId),
      fetchCourseTitle(courseId),
    ]);
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

  // Download button
  document.getElementById("download-btn").addEventListener("click", async () => {
    const wantSrt = document.getElementById("fmt-srt").checked;
    const wantTxt = document.getElementById("fmt-txt").checked;
    const wantJson = document.getElementById("fmt-json").checked;

    if (!wantSrt && !wantTxt && !wantJson) {
      showStatus("请至少选择一种格式", "error");
      return;
    }

    const btn = document.getElementById("download-btn");
    btn.disabled = true;
    showStatus("正在获取字幕...", "loading");

    try {
      const raw = await fetchSubtitle(subId);
      const items = extractSubtitleItems(raw);

      if (items.length === 0) {
        showStatus("该课程暂无字幕数据", "error");
        return;
      }

      if (wantSrt) downloadFile(toSrt(items), `subtitle_${subId}.srt`);
      if (wantTxt) downloadFile(toTxt(items), `subtitle_${subId}.txt`);
      if (wantJson) downloadFile(JSON.stringify(items, null, 2), `subtitle_${subId}.json`);

      showStatus(`已下载 ${items.length} 条字幕`, "success");
    } catch (err) {
      showStatus(err.message || "获取失败", "error");
    } finally {
      btn.disabled = false;
    }
  });
});
