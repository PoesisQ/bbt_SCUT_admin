# 课程补学助手 · 线上版

[打开线上演示](https://scut-buxue-2026.app.workbuddy.host/?sharecode=YRGCACKBQL)。网页使用原创讲义、模拟课程通知和课堂记录，无需登录或 API Key。可以查讲义和考试、作业通知，按出处查看原文、做练习和看复习建议。「课堂记录」可打开松针-27 示例课，查看模拟字幕、波形、改期历史和思维导图，也可导出演示笔记。

## 本地预览

在仓库根目录执行：

```powershell
python scripts/preview_competition_site.py
```

打开 `http://127.0.0.1:8766/`。用另一个终端执行 `node competition/site/selfcheck.js` 检查固定检索、引文和课程通知用例。

在「课堂记录 → 全部课程」点击「导入课程笔记」，预览服务会以只读方式读取桌面版已分析的神经科学课时。网页载入整课概览、主题及分段笔记，并建立正文搜索索引。当前标签页可以刷新后继续查看。默认读取已安装桌面版的数据库，也可用 `--database` 指定本机数据库路径。

静态网页上的「导入课程笔记」会直接导入 10 节内置的原创神经科学示例课时。导入结果和课时详情标明笔记来源。部署静态网站时仅上传 `competition/site/`，私有笔记由本机预览服务提供。

原创示例的模型与实验背景参考 [Neuronal Dynamics](https://neuronaldynamics.epfl.ch/online/Ch1.S3.html)、[Hodgkin 与 Huxley 的膜电流模型](https://pubmed.ncbi.nlm.nih.gov/12991237/)、[Bi 与 Poo 的突触配对实验](https://www.jneurosci.org/content/18/24/10464)、[Newsome 等人的运动知觉实验](https://www.nature.com/articles/341052a0)、[Hafting 等人的空间发放记录](https://www.nature.com/articles/nature03721)和 [Hopfield 的联想记忆模型](https://pmc.ncbi.nlm.nih.gov/articles/PMC346238/)。

学习对话的「附件」可以选择本机文件或使用 `Chapter 25 Capacitance.pptx` 示例。输入「讲解一下」会按实际课件的页序讲解电容、串并联、电场能量和电介质，并标出出处。原 PPT 留在本机。

| 文件 | 用途 |
| --- | --- |
| `index.html`、`app.js`、`retrieval.js` | 学习对话、资料检索、练习和复习建议 |
| `dashboard.html`、`dashboard-demo.js` | 课堂记录、导图和演示笔记导出 |
| `data/` | 原创合成语料、示例课堂记录及预计算向量 |
| `embeddings.js`、`semantic-worker.js` | 在浏览器中编码问题，用语义相似度补充关键词检索 |

更新 `workbuddy/demo/corpus.json` 后，在仓库根目录执行：

```powershell
Copy-Item workbuddy/demo/corpus.json competition/site/data/corpus.json
node competition/site/build-corpus.js
python competition/site/build-vectors.py
node competition/site/selfcheck.js
```

重建向量需要下述资源、Playwright 和 Edge。发布时使用干净检出，按需补齐语义检索资源，以 `competition/site/` 为静态目录、`index.html` 为入口。

## 可选：启用本地预览的浏览器语义检索

已托管的线上版会按需加载模型。Git 只保留代码、配置和预计算向量；克隆后可直接用关键词检索。需要预览或部署语义检索时，在仓库根目录下载这两个版本固定的文件：

```powershell
curl.exe --fail --location --create-dirs --output competition/site/models/bge-small-zh-v1.5/onnx/model_int8.onnx https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/75c43b0/onnx/model_int8.onnx
curl.exe --fail --location --output competition/site/vendor/transformers/ort-wasm-simd-threaded.jsep.wasm https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort-wasm-simd-threaded.jsep.wasm
```

| 文件 | SHA-256 |
| --- | --- |
| `model_int8.onnx` | `b9837c19ce154ff0726d398ee77abbc03a7faf0476c6f93016c84e531be7ebb5` |
| `ort-wasm-simd-threaded.jsep.wasm` | `c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39` |

资源约 46 MB，首次加载需要下载。Worker 在浏览器里编码问题，仍按课程、来源版本和可用状态筛选证据。资源缺失或加载失败时回退到关键词检索。模型和运行库的许可证位于 `models/` 和 `vendor/`。

## 与桌面版、专家团的关系

网页使用随站点分发的示例资料回答问题。录音、学校课程同步和个人资料入库由桌面版提供。[WorkBuddy 专家团](../../workbuddy/expert-team/README.md)和[本机 MCP](../../workbuddy/README.md)在客户端另行接入。

在「资料与安排 → 模型设置」可以选择用自己的模型改写本轮讲解。Key 仅存在当前标签页的内存，刷新即清除；相关证据和 Key 仅发往填写的兼容接口。接口不可用或引文校验失败时显示基于示例证据的答复。

固定自检包含 12 条检索、5 条引文、4 条自然问句和 7 条课程通知用例。客户端专家团调度、资料库回写和跨账号分享另行验证；网页演示不需要这些能力。
