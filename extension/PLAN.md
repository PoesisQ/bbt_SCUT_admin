# Chrome 插件实现计划

## 背景

将 CLI 工具的字幕提取功能集成到 Chrome 插件中。用户已在课程页面登录，浏览器持有 Cookie，无需任何认证逻辑。

## 核心流程

```
用户在课程播放页点击插件图标
  → Popup 读取当前标签页 URL
  → 解析 sub_id / course_id / tenant_code
  → 用户选择格式（SRT / TXT / JSON）
  → fetch 字幕 API（显式携带浏览器 Cookie）
  → 递归解析字幕 JSON → 生成文件 → 触发下载
```

## 文件结构

```
extension/
├── manifest.json     # Manifest V3，声明权限和弹窗
├── popup.html        # 弹窗 UI
├── popup.js          # 核心逻辑：URL 解析、API 调用、格式转换、文件下载
└── icons/
    ├── 16.png
    ├── 48.png
    └── 128.png
```

## manifest.json 关键配置

```json
{
  "manifest_version": 3,
  "name": "SCUT 字幕下载",
  "permissions": ["activeTab", "downloads"],
  "host_permissions": ["https://video.jw.scut.edu.cn/*"],
  "action": {
    "default_popup": "popup.html"
  }
}
```

- `activeTab`：读取当前标签页 URL
- `downloads`：触发文件下载
- `host_permissions`：允许 fetch 华园视频域名下的 API

## popup.html 界面

简洁弹窗，约 300px 宽：

```
┌─────────────────────────────┐
│  SCUT 课程字幕下载            │
├─────────────────────────────┤
│  课程：计算机组成原理          │
│  sub_id: 554146             │
│                             │
│  格式选择：                   │
│  ☑ SRT (字幕文件)            │
│  ☑ TXT (纯文本)              │
│  ☐ JSON (字幕数组)           │
│                             │
│  [下载字幕]                   │
│                             │
│  状态：就绪                   │
└─────────────────────────────┘
```

## popup.js 逻辑

### 1. URL 解析
```javascript
// 从 activeTab URL 中提取 course_id、sub_id 和 tenant_code
const url = new URL(tab.url);
const params = new URLSearchParams(url.search);
const subId = params.get("sub_id");
const courseId = params.get("course_id");
const tenantCode = params.get("tenant_code") || "21";
```

### 2. 调用字幕 API

先用 DevTools 或现有 CLI 拦截结果确认真实的 `search-trans-result` 请求 URL、HTTP 方法和参数。不要在实现时直接假设只有 `sub_id` 和 `format=json` 两个参数；当前 CLI 是通过进入播放页拦截真实接口响应，不是手工构造接口。

确认真实接口后，popup 里用 `fetch` 请求该接口，并显式携带 Cookie：

```javascript
const resp = await fetch(
  `https://video.jw.scut.edu.cn/courseapi/v3/web-socket/search-trans-result?sub_id=${encodeURIComponent(subId)}&tenant_code=${encodeURIComponent(tenantCode)}`,
  {
    credentials: "include",
  }
);

if (!resp.ok) {
  throw new Error(`字幕接口请求失败：HTTP ${resp.status}`);
}

const data = await resp.json();
```

说明：

- 插件无需自己实现登录；用户已在 Chrome 当前会话登录华园视频。
- `credentials: "include"` 必须保留，避免从 `chrome-extension://` 发起跨源请求时 Cookie 未随请求发送。
- `host_permissions` 必须覆盖 `https://video.jw.scut.edu.cn/*`，否则 popup 无法直接请求华园视频接口。

### 3. 解析 JSON（复用 CLI 的逻辑）
```javascript
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
```

JSON 下载内容与当前 CLI 行为保持一致：保存提取后的字幕数组，而不是完整 API 原始响应。后续如果需要调试完整响应，可以单独增加“原始 JSON”选项。

### 4. 格式转换

**SRT：**
```javascript
function toSrt(items) {
  return items
    .filter(item => item.Text?.trim())
    .map((item, i) => {
      const start = formatTime(item.BeginSec);
      const end = formatTime(item.EndSec || item.BeginSec + 5);
      return `${i + 1}\n${start} --> ${end}\n${item.Text.trim()}`;
    })
    .join("\n\n");
}
```

**TXT：**
```javascript
function toTxt(items) {
  return items
    .filter(item => item.Text?.trim())
    .map(item => item.Text.trim())
    .join("\n");
}
```

### 5. 触发下载
```javascript
const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
const url = URL.createObjectURL(blob);
chrome.downloads.download({ url, filename: `subtitle_${subId}.srt` });
```

## 状态处理

- **非课程页面**：显示"请先打开课程播放页面"
- **加载中**：按钮禁用 + "正在获取..."
- **成功**：显示"已下载 X 条字幕"
- **失败**：显示错误信息（网络错误、未登录、无字幕等）

## 技术要点

1. **无需 Content Script** — popup.js 直接通过 `chrome.tabs.query` 获取 URL
2. **无需 Background Worker** — 所有操作在 popup 中同步完成
3. **无需构建工具** — 纯原生 JS/HTML/CSS
4. **Cookie 显式携带** — fetch 跨源请求必须设置 `credentials: "include"`
5. **先确认真实接口** — 以 DevTools 或 CLI 拦截到的 `search-trans-result` 请求为准，避免硬编码不完整参数
6. **解析逻辑保持兼容** — 移植 CLI 的递归提取策略，不只处理单一 `list[0].all_content` 结构

## 安装测试

1. Chrome → `chrome://extensions/` → 开启开发者模式
2. 加载已解压的扩展程序 → 选择 `extension/` 目录
3. 打开课程页面 → 点击插件图标 → 选择格式 → 下载
4. 用一个 CLI 已成功抓取过的课程对比插件输出条数和 SRT/TXT 内容
5. 测试未登录状态，确认能显示登录或接口失败提示
6. 测试非课程页面，确认显示"请先打开课程播放页面"
7. 打开扩展控制台，确认没有 CSP、CORS、权限或 Cookie 相关错误
