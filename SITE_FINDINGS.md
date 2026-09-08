# 百步梯学堂接口研究与实现依据

观察日期：2026-09-08。使用用户已有 Edge 登录，只读取页面、公开前端代码和学校 GET 接口；未调用笔记保存、弹幕、作业提交、签到或平台配置接口。

## 实际观察

1. 课程播放路径 `/livingroom?course_id=...&sub_id=...&tenant_code=21`。同一课程页面列出日期顺序的多个课时，包含回放、直播、未开始等状态。
2. 正在直播的播放器为 `<video id="cmc_player_video" src="blob:...">`；blob 地址仅对浏览器的 MediaSource 有效，不能交给 FFmpeg 当网络 URL。
3. 课时详情接口 `GET /courseapi/v3/portal-home-setting/get-sub-info?course_id=&sub_id=` 返回 `data`。本次直播观测：`course_type=multi`、`sub_type=course_live`、`sub_status=1`。
4. 直播详情的 `data.live_url.output` 有教师视频与音轨的 `flv`、`flv_audio`、`m3u8`、`m3u8_audio` 等字段，含签名参数。`output_student` 是另一机位，不应默认拿来识别。`content.trans_socket_url` 在该直播为空，证实不能依赖学校同步字幕。
5. 已结束的一节回放：`sub_status=6`、`is_m3u8=no`。教师视频来自 `data.content.save_playback.contents`；`data.playurl` 是以数字作键的 URL 对象；`data.video_list` 中 `type=3` 为教师机位、`type=4` 为学生机位。普通回放 MP4 支持 HTTP Range。
6. 本次真实回放视频约 553 MB、9257 秒；成功提取 30:00–30:30 音频并用本地 GPU 转写，内容涉及操作系统的进程和 Unix 时间。转写样本仅用于接入验证。
7. 当天直播结束后页面变为“回放生成中”；未把它当作已有视频处理。

原仓库已使用的接口继续保留：

| GET 接口 | 用途 |
| --- | --- |
| `/courseapi/v2/course/catalogue?course_id=` | 同课程目录；原实现读取 `result.data` |
| `/courseapi/v3/web-socket/search-trans-result?sub_id=&format=json` | 学校已上传字幕 |
| `/courseapi/v3/multi-search/get-course-teacher-others?course_id=` | 课程名称等信息 |

单独把目录接口作为浏览器地址打开曾遇到客户端拦截，普通课程页面内目录仍显示。新扩展使用同源页面内 GET；目录的实际扩展运行结果需要加载扩展后验证，不能由静态解析测试代替。

## 方案

直播主路径使用 `tabCapture`，避免依赖学校签名时效、WebVPN 重写或不断变化的流地址。只读 `webRequest` 观察播放器已请求的媒体 URL 作为诊断补充，不监听请求头、不取 Cookie、不修改请求。

回放路径优先学校字幕，其次正常视频源；本地服务负责下载、解码和排队。HLS 的每个嵌套资源都经域名验证，下载后再用禁止网络协议的 FFmpeg 解码，避免解析器自动访问任意地址。

原版 popup 的 Blob 下载 URL 改为延迟释放，避免 Edge 创建下载 ID 后还没消费数据时地址已失效。新增长任务放到 offscreen 和本地队列；不把持续录音放在随时关闭的 popup 里。

## 未证明或明确限制

- 当前代码对 Edge/Chrome 采用相同的 MV3 音频 API，要求 116+ 并做运行时能力检查。自动回归不等价于已经在用户配置文件里加载扩展并完成实机录音；以实际联调记录为准。
- 只口头分析，未做 PPT OCR/二维码视觉检测。只在屏幕出现的要求无法由音频推断。
- 未提供 DeepSeek Key 时，只有请求结构与响应校验的模拟测试，不声称已真实调用 DeepSeek。
- 不绕过学校身份认证，不处理 DRM；加密或特殊 HLS 走用户正常播放的标签页捕获。
- 直播从捕获时刻计时，回放从视频时间零点计时，不能未经对齐直接混用。

接口和源地址可能变化。所有来源筛选、状态映射、排序与音频格式逻辑集中在 `extension/study-core.js`，便于后续维护。
