(() => {
  "use strict";
  const host = document.querySelector("[data-workbuddy-entry]");
  if (!host) return;
  host.className = "workbuddy-entry";
  const content = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "在 WorkBuddy 学习";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.textContent = "正在检查本机连接…";
  content.append(title, message);
  const actions = document.createElement("div");
  actions.className = "workbuddy-entry-actions";
  host.append(content, actions);

  const details = {
    setup_needed: "准备一次连接器，即可查已导入的资料和复习进度。",
    paths_changed: "连接器指向另一套安装或资料目录。可切换到此学习助手。",
    skill_changed: "学习技能有更新。保存新版后，在 WorkBuddy 新建任务。",
    connector_conflict: "已有其他同名连接器。请在 WorkBuddy 检查 scut-study 的配置。",
    invalid_config: "WorkBuddy 的 MCP JSON 无法读取。请在连接器设置检查格式。",
    index_error: "课程索引无法读取。请先在网页学习台检查本地资料。",
    runtime_error: "本地连接器启动失败。请检查安装与资料目录。"
  };
  function addButton(label, click, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (primary) button.className = "primary";
    button.addEventListener("click", click);
    actions.append(button);
  }
  async function request(path = "", label = "正在检查…") {
    for (const button of actions.querySelectorAll("button")) button.disabled = true;
    message.textContent = label;
    try {
      const state = await AssistantClient.api("/api/desktop/workbuddy" + path,
        path ? {method: "POST", body: {}, timeout: 30000} : {timeout: 8000});
      if (state.opened) {
        message.textContent = "已打开 WorkBuddy。新建任务后输入 /scut-study，首次连接按客户端提示确认。";
        await AssistantClient.api("/api/desktop/welcomed", {method: "POST", body: {}}).catch(() => {});
      } else {
        render(state);
      }
    } catch (error) {
      message.textContent = error.message || "无法连接本机学习助手。";
      if (!actions.children.length) addButton("重新检查", () => request());
    } finally {
      for (const button of actions.querySelectorAll("button")) button.disabled = false;
    }
  }
  function render(state) {
    actions.replaceChildren();
    if (!state.installed) {
      message.textContent = "本机未检测到 WorkBuddy。安装后回来重新检查。";
      const link = document.createElement("a");
      link.href = "https://www.workbuddy.cn/";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "下载 WorkBuddy ↗";
      actions.append(link);
      addButton("重新检查", () => request());
      return;
    }
    if (state.state === "configured") {
      const sourceNote = state.has_sources ? "" : " 可先在网页学习台添加课件或同步课堂记录。";
      message.textContent = (state.probe?.ok
        ? "本地检查通过，版本 " + state.probe.version + "，" + state.probe.tools + " 个工具。"
        : state.probe?.message || "本机配置已准备。首次启用状态以 WorkBuddy 为准。") + sourceNote;
      addButton("在 WorkBuddy 继续学习", () => request("/open", "正在打开 WorkBuddy…"), true);
      addButton("检查本机连接", () => request("/check"));
      return;
    }
    message.textContent = state.probe?.message || details[state.state] || "请检查 WorkBuddy 连接。";
    if (["setup_needed", "paths_changed", "skill_changed", "runtime_error"].includes(state.state)) {
      addButton(state.state === "paths_changed" ? "切换到此资料目录" : "准备连接器",
        () => request("/setup", "正在准备并检查连接器…"), true);
    }
    addButton("重新检查", () => request());
  }
  void request();
})();
