# SCUT 华园视频字幕提取工具

从华南理工大学"华园视频"平台自动提取课程回放字幕，输出 JSON、SRT、纯文本三种格式。

## 工作原理

1. 使用 Playwright 启动浏览器，通过学校统一认证（扫码）登录
2. 导航至课程播放页面，拦截网络请求中的字幕 API 响应
3. 字幕接口 (`/courseapi/v3/web-socket/search-trans-result`) 返回明文 JSON，无需逆向加密
4. 自动解析多层嵌套结构，提取 `BeginSec`/`EndSec`/`Text` 字段
5. 同时保存原始 JSON、标准 SRT 字幕文件、纯文本

## 快速开始

### 安装

```bash
uv sync
uv run playwright install chromium
```

### 使用

```bash
# 1. 扫码登录（浏览器弹出，扫码即可，只需一次）
uv run python main.py login

# 2. 获取字幕（直接粘贴课程链接）
uv run python main.py get "https://video.jw.scut.edu.cn/livingroom?course_id=64762&sub_id=554146&tenant_code=21"

# 交互式粘贴（不带参数运行）
uv run python main.py get
请粘贴课程链接（回车确认）：
> https://video.jw.scut.edu.cn/livingroom?course_id=64762&sub_id=554146&tenant_code=21
```

### 输出

每次抓取生成三个文件：

| 格式 | 路径 | 说明 |
|------|------|------|
| JSON | `output/json/<sub_id>.json` | API 返回的原始数据，含完整字段 |
| SRT | `output/srt/<sub_id>.srt` | 标准字幕格式，含时间轴，可直接用于视频播放器 |
| TXT | `output/txt/<sub_id>.txt` | 纯文本，无时间信息，便于阅读和搜索 |

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

纯文本输出：
```
嗯嗯好好好好好
感谢大家冒雨前来上课。
那今天是咱们最后一次课，啊然后因为今天咱们也是两节，所以今天呢想给大家
讲几个啊讲一下咱们的课程设就是课程报告撰写的问题，
```

## 项目结构

```
├── main.py       # CLI 入口（login / get）
├── browser.py    # Playwright 浏览器管理、网络拦截核心
├── subtitle.py   # JSON → SRT/TXT 格式转换与文件保存
├── config.py     # URL、超时等配置常量
├── auth.py       # 登录状态管理
├── pyproject.toml
├── data/         # 登录状态（git 忽略）
└── output/       # 字幕输出（git 忽略）
    ├── json/
    ├── srt/
    └── txt/
```

## 已知限制

- **必须传完整课程链接** — 需包含 `course_id` 和 `sub_id`，否则页面不会触发字幕请求
- **必须有头浏览器** — headless 模式下视频播放器不会完全初始化，字幕请求不会被触发

## 未来改进方向

- **headless 模式** — 直接构造字幕 API 请求绕过播放页加载
- **课程列表浏览** — 登录后交互式选择课程，无需手动粘贴链接
- **字幕搜索** — 根据关键词搜索字幕内容，返回时间戳定位视频片段
- **批量导出** — 一键导出所有课程字幕
- **AI 摘要** — 基于字幕生成课堂摘要、知识点提取
