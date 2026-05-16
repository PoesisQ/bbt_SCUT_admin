# SCUT 华园视频字幕提取工具

从华南理工大学"华园视频"平台自动提取课程回放字幕，输出 JSON 和 SRT 双格式。

## 当前实现

### 工作原理

1. 使用 Playwright 启动浏览器，通过学校统一认证（扫码）登录
2. 导航至课程播放页面，拦截网络请求中的字幕 API 响应
3. 字幕接口 (`/courseapi/v3/web-socket/search-trans-result`) 返回明文 JSON，无需逆向加密
4. 自动解析多层嵌套结构，提取 `BeginSec`/`EndSec`/`Text` 字段
5. 同时保存原始 JSON 和标准 SRT 字幕文件

### 已验证的功能

- **扫码登录** — 打开浏览器窗口，扫码后自动保存登录状态（Cookie/Storage），后续无需重复登录
- **字幕抓取** — 通过 `sub_id` + `course_id` 精准获取指定课程的完整字幕
- **格式转换** — JSON 原始数据 + 标准 SRT 字幕文件（含时间轴）
- **登录状态持久化** — 基于 Playwright `storage_state` 机制

### 项目结构

```
├── main.py       # CLI 入口（login / courses / get）
├── browser.py    # Playwright 浏览器管理、网络拦截核心
├── subtitle.py   # JSON → SRT 格式转换与文件保存
├── config.py     # URL、超时等配置常量
├── auth.py       # 登录状态管理
├── pyproject.toml
├── data/         # 登录状态（git 忽略）
└── output/       # 字幕输出（git 忽略）
    ├── json/
    └── srt/
```

## 快速开始

```bash
# 安装依赖
uv sync
uv run playwright install chromium

# 扫码登录（浏览器弹出，扫码即可）
uv run python main.py login

# 获取字幕
uv run python main.py get 554146 --course-id 64762
```

输出文件位于 `output/json/` 和 `output/srt/`。

### 字幕数据示例

JSON 原始格式：
```json
{"BeginSec": 93, "Text": "刚刚呢我们正好讲完了我们的这个第一节的内容", "EndSec": 97}
```

SRT 输出：
```
7
00:01:33,000 --> 00:01:37,000
刚刚呢我们正好讲完了我们的这个第一节的内容
```

## 已知限制

- **必须传 `course_id`** — 页面没有 `course_id` 参数时不会触发字幕 API 请求，目前需手动指定
- **必须有头浏览器** — headless 模式下视频播放器不会完全初始化，字幕请求不会被触发
- **`courses` 命令未验证** — 课程列表页的 API 结构尚未调试确认

## 未来改进方向

### 短期

- **自动获取 `course_id`** — `courses` 命令列出课程时同时拿到 `course_id`，`get` 命令无需手动传
- **headless 模式支持** — 尝试直接构造字幕 API 请求（`/courseapi/v3/web-socket/search-trans-result?sub_id=xxx&format=json`），绕过播放页加载
- **登录状态过期检测** — 自动判断 Cookie 是否失效，提示重新登录

### 中期

- **字幕搜索** — 根据关键词搜索字幕内容，返回对应时间戳，快速定位到视频片段
- **批量导出** — 一键导出所有课程字幕（`get --all` 已搭建框架，需配合课程列表 API）
- **多格式输出** — 支持 VTT、纯文本等格式

### 长期

- **AI 摘要** — 基于字幕内容生成课堂摘要、知识点提取
- **Web UI** — 本地 Web 界面替代 CLI，更友好的交互体验
- **定时同步** — 自动检测新课程并抓取字幕
