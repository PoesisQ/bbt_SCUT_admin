/* School-page entry. No credentials, media capture, or model requests live here. */
(() => {
  if(globalThis.__scutSiteEntry)return;
  globalThis.__scutSiteEntry=true;
  const host=document.createElement("div");host.id="scut-assistant-entry";
  const shadow=host.attachShadow({mode:"closed"});
  const style=document.createElement("style");
  style.textContent=":host{all:initial;position:fixed;right:24px;top:100px;z-index:2147483645;font-family:system-ui,'Microsoft YaHei',sans-serif;color:#283346}*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #aec6f3;outline-offset:3px}.panel{width:310px;background:#fafbfff5;backdrop-filter:blur(24px);border:1px solid #e5e8ef;border-radius:22px;padding:22px;box-shadow:0 16px 60px #192b4626;animation:appear .3s ease}.top{display:flex;align-items:center;justify-content:space-between;gap:12px}.top strong{font-size:15px}.close{border:0;background:#e9edf4;border-radius:50%;width:28px;height:28px;color:#79859a}h3{font-size:22px;line-height:1.4;margin:24px 0 8px}p{font-size:13px;line-height:1.8;color:#7d8799;margin:0 0 16px}.buttons{display:grid;gap:8px}.buttons button{padding:12px;border:1px solid #dfe5f0;background:white;border-radius:11px;font-size:13px;color:#4a5e7f}.buttons .primary{background:#5379b9;color:white;border-color:transparent}.pref{font-size:11px;color:#8a93a2;display:flex;gap:6px;align-items:center;margin-top:18px}.dock{border:1px solid #e1e5ed;border-radius:100px;background:#fbfcfff5;color:#3c506f;padding:13px 18px;box-shadow:0 6px 28px #1a2a4422;font-size:13px}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#739aca;margin-right:9px}[hidden]{display:none!important}@keyframes appear{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.panel{animation:none}}@media(max-width:500px){:host{right:12px;top:80px}.panel{width:min(310px,calc(100vw - 24px))}}";
  const panel=document.createElement("section");panel.className="panel";panel.hidden=true;panel.setAttribute("aria-label","SCUT 课堂助手");
  panel.innerHTML='<div class="top"><strong>SCUT 课堂助手</strong><button class="close" aria-label="收起助手">−</button></div><h3></h3><p class="description"></p><div class="buttons"><button class="primary" data-action="OPEN_ASSISTANT">打开课堂控制</button><button data-action="OPEN_NOTEBOOK">课程笔记与回放导入 ↗</button><button data-action="OPEN_CLASSROOM" class="live" hidden>返回正在录音的课堂 ↗</button></div><label class="pref"><input type="checkbox" checked>进入学校网站时自动展开</label>';
  const dock=document.createElement("button");dock.className="dock";dock.innerHTML='<span class="dot"></span>课堂助手';dock.hidden=true;dock.setAttribute("aria-expanded","false");
  shadow.append(style,panel,dock);document.documentElement.append(host);
  let userExpanded=null;
  function expanded(value){panel.hidden=!value;dock.hidden=value;dock.setAttribute("aria-expanded",String(value));}
  panel.querySelector(".close").onclick=()=>{userExpanded=false;expanded(false);};dock.onclick=()=>{userExpanded=true;expanded(true);};
  async function send(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw new Error(r?.error||"扩展已更新，请刷新学校页面");return r.data;}
  for(const b of panel.querySelectorAll("[data-action]"))b.onclick=async()=>{b.disabled=true;try{await send(b.dataset.action);}catch(e){panel.querySelector(".description").textContent=e.message;}finally{b.disabled=false;}};
  panel.querySelector("input").onchange=async e=>{try{await send("SET_SITE_ENTRY_PREF",{enabled:e.target.checked});}catch(error){panel.querySelector(".description").textContent=error.message;}};
  let lastURL="";
  function route(){const url=new URL(location.href);return url.origin+url.pathname+"?"+new URLSearchParams({course_id:url.searchParams.get("course_id")||"",sub_id:url.searchParams.get("sub_id")||""});}
  async function update(){
    const current=route();if(current===lastURL)return;lastURL=current;
    try{const state=await send("PAGE_ASSISTANT_READY");
      if(route()!==current)return;
      panel.querySelector("h3").textContent=state.course||"开始一节课";
      panel.querySelector(".description").textContent=state.recording?"录音在后台继续。关掉查看窗口后，可以从这里返回。":state.connected?"播放课程后，打开课堂控制开始字幕；课后可在课程笔记中整理回放。":"先启动本地服务，再打开课堂控制完成连接。";
      panel.querySelector(".live").hidden=!state.recording;
      panel.querySelector("input").checked=state.autoOpen;
      expanded(userExpanded??state.expandOnLoad??false);
    }catch(e){if(route()!==current)return;panel.querySelector("h3").textContent="课堂助手";panel.querySelector(".description").textContent=e.message;expanded(userExpanded??false);}
  }
  void update();setInterval(()=>void update(),1200);
})();
