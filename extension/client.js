/* Shared by trusted extension pages and the loopback dashboard. Never injected into the school page. */
globalThis.AssistantClient = {
  base: "http://127.0.0.1:8765",
  async connection() {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local.get({token:"", desktopAlerts:false});
    return {token: sessionStorage.getItem("scut-token") || ""};
  },
  async setConnection(token) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({token});
    else sessionStorage.setItem("scut-token",token);
  },
  async api(path, options={}) {
    const {token} = await this.connection();
    return this.fetchWithToken(token,path,options);
  },
  async fetchWithToken(token,path,{method="GET",body,raw=false,timeout=20000}={}) {
    let response;
    try {
      response = await fetch(this.base+path,{method,headers:{Authorization:`Bearer ${token}`,
        ...(body !== undefined ? {"Content-Type":raw?"audio/wav":"application/json"}:{})},
        body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
    } catch {
      throw new Error("无法连接本地服务，请运行 start-assistant.ps1，并检查连接口令");
    }
    if (!response.ok) {
      const result = await response.json().catch(()=>({}));
      throw new Error(typeof result.detail==="string"?result.detail:`本地服务 HTTP ${response.status}`);
    }
    return path.endsWith("/export") ? response.blob() : response.json();
  },
  async send(type, data={}) {
    const response = await chrome.runtime.sendMessage({type,...data});
    if (!response?.ok) throw new Error(response?.error || "扩展后台无响应，请重新加载扩展");
    return response.data;
  },
  async download(sid) {
    const blob=await this.api(`/api/sessions/${sid}/export`);
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`lesson-${sid.slice(0,8)}.zip`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  },
  dashboardURL(sid,tabId) {
    const params=new URLSearchParams();
    if(/^[a-f0-9]{32}$/.test(sid||""))params.set("session",sid);
    if(Number.isInteger(tabId)&&tabId>0)params.set("tab",tabId);
    return "dashboard.html"+(params.size?"?"+params:"");
  },
  async openDashboard(sid,tabId) {
    const url=this.dashboardURL(sid,tabId);
    if(globalThis.chrome?.runtime?.id)await chrome.tabs.create({url:chrome.runtime.getURL(url)});
    else location.href=url;
  },
  async openClassroom(tabId) {
    const url=chrome.runtime.getURL(`classroom.html?tab=${tabId||""}`);
    const saved=await chrome.storage.session.get(["classroomWindow","classroomTab"]);
    if(saved.classroomWindow){
      try{const existing=await chrome.windows.get(saved.classroomWindow,{populate:true});
        if(existing.type==="popup"&&existing.tabs?.some(t=>t.id===saved.classroomTab)){
          await chrome.windows.update(existing.id,{focused:true,...(existing.state==="minimized"?{state:"normal"}:{})});return;
        }
      }catch{ /* The previous window was closed; create one below. */ }
    }
    const created=await chrome.windows.create({url,type:"popup",width:510,height:820,focused:true});
    await chrome.storage.session.set({classroomWindow:created.id,classroomTab:created.tabs?.[0]?.id});
  }
};
