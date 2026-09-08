importScripts("core.js","study-core.js","client.js","school-api.js");
const A=AssistantClient;
const ready=chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
chrome.runtime.onInstalled?.addListener(({reason})=>{
  if(reason==="install")void chrome.tabs.create({url:chrome.runtime.getURL("welcome.html")});
});
let creatingOffscreen, batchRunning=false, startingCapture=false;

async function offscreen() {
  if(!chrome.offscreen||!chrome.tabCapture?.getMediaStreamId) throw new Error("请升级到 Edge / Chrome 116 或以上版本");
  if(creatingOffscreen) return creatingOffscreen;
  const contexts=await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL("offscreen.html")]});
  if(contexts.length) return;
  creatingOffscreen=chrome.offscreen.createDocument({url:"offscreen.html",reasons:["USER_MEDIA"],justification:"持续捕获用户选择的课程标签页声音，并送到本机语音引擎"});
  try {await creatingOffscreen;} finally {creatingOffscreen=null;}
}

async function tellRecorder(type,data={}) {
  await offscreen();
  const result=await chrome.runtime.sendMessage({target:"offscreen",type,...data});
  if(!result?.ok) throw new Error(result?.error||"音频后台没有响应");
  return result.data;
}

async function activeCapture(){return (await chrome.storage.session.get("activeCapture")).activeCapture;}
async function recorderState(){
  const contexts=await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL("offscreen.html")]});
  if(!contexts.length)return {recording:false,pending:0,sid:null};
  const result=await chrome.runtime.sendMessage({target:"offscreen",type:"STATE"});
  if(!result?.ok)throw new Error(result?.error||"暂时无法读取录音状态");
  return result.data;
}
async function installOverlay(tabId){await chrome.scripting.executeScript({target:{tabId},files:["session-view.js","overlay.js"]});}

function schoolPage(url){try{return ["https://video.jw.scut.edu.cn","https://video-jw-443.webvpn.scut.edu.cn"].includes(new URL(url).origin);}catch{return false;}}
async function openAssistant(tab,automatic=false){
  // Current Chromium supports opening the action; older builds use the page entry.
  if(chrome.action.openPopup){try{await chrome.action.openPopup({windowId:tab.windowId});return true;}catch{ /* Keep the in-page fallback accessible. */ }}
  if(automatic)return false;
  const url=chrome.runtime.getURL("study-popup.html?tab="+tab.id);
  const saved=await chrome.storage.session.get("controlWindow");
  if(saved.controlWindow){try{const window=await chrome.windows.get(saved.controlWindow,{populate:true});
    const page=window.tabs?.find(t=>t.url===url);if(page){await chrome.windows.update(window.id,{focused:true,state:"normal"});return true;}
  }catch{ /* Previous control window was closed. */ }}
  const window=await chrome.windows.create({url,type:"popup",width:430,height:790,focused:true});
  await chrome.storage.session.set({controlWindow:window.id});return true;
}

async function startCapture(message) {
  if(startingCapture||await activeCapture()) throw new Error("已有课程正在录制或等待上传，请先结束当前录制");
  startingCapture=true;
  let session;
  try {
    const context=await SchoolAPI.context(message.tabId);
    const info=(await SchoolAPI.get(context,"info")).data;
    const metadata=ScutStudy.lesson(info,context);
    const state=(await chrome.scripting.executeScript({target:{tabId:message.tabId},func:()=>{
      const v=document.querySelector("video");return v?{currentTime:v.currentTime,paused:v.paused,rate:v.playbackRate}:null;
    }}))[0]?.result;
    if(!state||state.paused) throw new Error("请先在学校播放器开始播放声音，再开启实时字幕");
    if(metadata.time_basis==="video"&&state.rate!==1) throw new Error("边播边识别请使用 1 倍速；批量回放转写不受播放速度影响");
    await A.api("/api/health");
    await offscreen();
    let streamId;
    try{streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:message.tabId});}
    catch(error){
      if(/invoked|activeTab|permission/i.test(error.message||""))throw new Error("浏览器需要一次手动打开：请点击工具栏中的 SCUT 课堂助手图标，再点击“开始实时字幕”。自动打开面板不会代替录音授权。");
      throw error;
    }
    session=await A.api("/api/sessions",{method:"POST",body:{...metadata,mode:"live",analysis:!!message.analysis}});
    await installOverlay(message.tabId);
    const capture={sid:session.id,tabId:message.tabId,url:context.url,time_basis:metadata.time_basis};
    await chrome.storage.session.set({activeCapture:capture});
    await tellRecorder("START",{streamId,session,capture,offset:metadata.time_basis==="video"?state.currentTime:0,
      connection:await A.connection()});
    await chrome.action.setBadgeText({text:"REC"});
    await chrome.action.setBadgeBackgroundColor({color:"#dc5538"});
    return session;
  } catch(error) {
    if(session) await A.api(`/api/sessions/${session.id}/cancel`,{method:"POST"}).catch(()=>{});
    await chrome.storage.session.remove("activeCapture");
    throw error;
  } finally {startingCapture=false;}
}

async function processLesson(context, subId, analysis, forceAsr, requestId) {
  const info=(await SchoolAPI.get(context,"info",subId)).data||{};
  if(!ScutStudy.replayEligible({status:info.sub_status})) throw new Error("课时仍在直播、未开始或回放尚未就绪");
  const pageUrl=new URL(context.url);pageUrl.searchParams.set("sub_id",subId);
  const metadata=ScutStudy.lesson(info,{...context,subId,url:pageUrl.href});
  let items=[];
  if(!forceAsr) items=ScutSubtitleCore.extractSubtitleItems(await SchoolAPI.get(context,"subtitle",subId)).filter(s=>typeof s.Text==="string"&&Number.isFinite(Number(s.BeginSec)));
  const sources=ScutStudy.mediaSources(info,context.origin).filter(s=>s.kind==="replay");
  if(!items.length&&!sources.length) throw new Error("此课时尚无字幕和可用回放源，可在播放页尝试实时识别");
  const session=await A.api("/api/sessions",{method:"POST",body:{...metadata,request_id:requestId,mode:items.length?"subtitle":"replay",analysis,
    ...(items.length?{}:{source_url:sources[0].url})}});
  if(items.length&&!session.stopped) {
    try {await A.api(`/api/sessions/${session.id}/subtitles`,{method:"POST",body:{items:items.map(s=>({BeginSec:Number(s.BeginSec),EndSec:s.EndSec==null?Number(s.BeginSec)+5:Number(s.EndSec),Text:s.Text}))}});}
    catch(error){await A.api(`/api/sessions/${session.id}/cancel`,{method:"POST"}).catch(()=>{});throw error;}
  }
  return session;
}

async function runBatch() {
  if(batchRunning) return;
  batchRunning=true;
  try {
    for(;;) {
      const {batch}=await chrome.storage.local.get("batch");
      if(!batch||batch.cancelled) break;
      const item=batch.items.find(i=>i.status==="pending");
      if(!item) break;
      try {
        const session=await processLesson(batch.context,item.sub_id,batch.analysis,batch.forceAsr,`${batch.id}-${item.sub_id}`);
        item.status="queued";item.sid=session.id;
      } catch(e){item.status="failed";item.error=e.message;}
      // Re-read cancellation before committing so a stop click is never overwritten.
      const latest=(await chrome.storage.local.get("batch")).batch;
      if(latest?.id!==batch.id) break;
      batch.cancelled=!!latest.cancelled;
      await chrome.storage.local.set({batch});
    }
  } finally {batchRunning=false;}
}

async function broadcastUpdate(message) {
  const capture=await activeCapture();
  const session=message.session;
  if(capture&&capture.sid===session.id) {
    await chrome.tabs.sendMessage(capture.tabId,{type:"SCUT_UPDATE",session,recorder:message.recorder}).catch(()=>{});
    const {desktopAlerts}=await A.connection();
    if(desktopAlerts&&chrome.notifications&&await chrome.permissions.contains({permissions:["notifications"]})) {
      const {notified={}}=await chrome.storage.session.get("notified");
      for(const e of session.events.slice(-20)) {
        const eventKey=`${session.id}:${e.id}`;
        if(notified[eventKey]||e.priority!=="urgent") continue;
        notified[eventKey]=true;
        await chrome.notifications.create(eventKey,{type:"basic",iconUrl:"icons/assistant-128.png",title:`${e.label} · ${session.course_title}`,message:e.evidence.slice(0,150),priority:2});
      }
      await chrome.storage.session.set({notified});
    }
  }
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.target==="offscreen") return false;
  if(sender.id!==chrome.runtime.id) return false;
  const trusted=sender.url?.startsWith(chrome.runtime.getURL(""));
  const contentAllowed=["OVERLAY_READY","PLAYER_CHANGED","SET_OVERLAY_PREFS","OPEN_CLASSROOM","PAGE_ASSISTANT_READY","SET_SITE_ENTRY_PREF","OPEN_ASSISTANT","OPEN_NOTEBOOK"];
  if(!trusted&&(!schoolPage(sender.url)||!contentAllowed.includes(message.type))) return false;
  (async()=>{
    await ready;
    switch(message.type) {
      case "PAGE_ASSISTANT_READY": {
        const {autoOpenAssistant=true}=await chrome.storage.local.get("autoOpenAssistant");
        const capture=await activeCapture();
        let connected=false,course="";
        try{const sessions=await A.api("/api/sessions");connected=true;const id=new URL(sender.tab.url).searchParams.get("course_id");course=sessions.find(s=>s.course_id===id)?.course_title||"";}catch{ /* Entry remains usable before pairing. */ }
        let popupOpened=false;
        const tab=await chrome.tabs.get(sender.tab.id),key="auto-open-"+tab.windowId;
        const previous=(await chrome.storage.session.get(key))[key]||0;
        const window=await chrome.windows.get(tab.windowId);
        if(autoOpenAssistant&&tab.active&&window.focused&&Date.now()-previous>45000){
          await chrome.storage.session.set({[key]:Date.now()});popupOpened=await openAssistant(tab,true);
        }
        return {autoOpen:autoOpenAssistant,popupOpened,connected,course,recording:!!capture};
      }
      case "SET_SITE_ENTRY_PREF":
        if(typeof message.enabled!=="boolean")throw new Error("无效显示偏好");
        await chrome.storage.local.set({autoOpenAssistant:message.enabled});return true;
      case "OPEN_ASSISTANT": return openAssistant(await chrome.tabs.get(sender.tab.id));
      case "OPEN_NOTEBOOK": {
        const params=new URLSearchParams({tab:String(sender.tab.id)}),id=new URL(sender.tab.url).searchParams.get("course_id");
        if(/^\d+$/.test(id||""))params.set("course",id);
        await chrome.tabs.create({url:chrome.runtime.getURL("dashboard.html?"+params)});return true;
      }
      case "INSPECT": {
        const result=await SchoolAPI.inspect(message.tabId);
        const key=`media-${message.tabId}`;const observed=(await chrome.storage.session.get(key))[key]||[];
        for(const url of observed)if(!result.sources.some(s=>s.url===url))result.sources.push({url,label:"播放器实际请求",kind:result.status==="1"?"live":"replay",format:new URL(url).pathname.split(".").pop()});
        return result;
      }
      case "START_CAPTURE": return startCapture(message);
      case "STOP_CAPTURE": return tellRecorder("STOP",{warning:message.warning||""});
      case "RECORDER_STATE": return recorderState();
      case "RECOVER_UPLOADS": return tellRecorder("RECOVER",{connection:await A.connection()});
      case "RECORDER_UPDATE": await broadcastUpdate(message); return true;
      case "RECORDER_FINISHED":
        {const capture=await activeCapture();if(capture&&message.session)await chrome.tabs.sendMessage(capture.tabId,{type:"SCUT_UPDATE",session:message.session,finished:true}).catch(()=>{});}
        await chrome.storage.session.remove("activeCapture");await chrome.action.setBadgeText({text:""});return true;
      case "GET_CONNECTION": return A.connection();
      case "PLAYER_CLOCK": {
        await SchoolAPI.context(message.tabId);
        return (await chrome.scripting.executeScript({target:{tabId:message.tabId},func:()=>{
          const v=document.querySelector("video");return v?{time:v.currentTime,paused:v.paused,rate:v.playbackRate}:null;
        }}))[0]?.result;
      }
      case "OVERLAY_READY": {
        const capture=await activeCapture();
        const {overlayPrefs:prefs={mode:"compact",fontSize:22}}=await chrome.storage.local.get("overlayPrefs");
        return {prefs,...(capture?.tabId===sender.tab?.id?{capture}:{})};
      }
      case "SET_OVERLAY_PREFS": {
        if(!["compact","context","minimized"].includes(message.mode)||!Number.isFinite(message.fontSize)||message.fontSize<16||message.fontSize>36)throw new Error("无效字幕显示设置");
        await chrome.storage.local.set({overlayPrefs:{mode:message.mode,fontSize:message.fontSize}});return true;
      }
      case "OPEN_CLASSROOM": await A.openClassroom(sender.tab?.id||message.tabId);return true;
      case "PLAYER_CHANGED": {
        const capture=await activeCapture();
        if(capture?.tabId===sender.tab?.id&&capture.time_basis==="video")
          await tellRecorder("STOP",{warning:"回放暂停、跳转或变速，录制已结束以保持字幕时间轴准确；继续播放后可重新开启"});
        return true;
      }
      case "START_BATCH": {
        const previous=(await chrome.storage.local.get("batch")).batch;
        if(previous&&!previous.cancelled&&previous.items.some(i=>i.status==="pending")) throw new Error("上一批课程仍在导入，请等待或停止后再试");
        const context=await SchoolAPI.context(message.tabId);
        const ids=[...new Set(message.subIds||[])].filter(x=>/^\d+$/.test(x)).slice(0,200);
        if(!ids.length) throw new Error("请选择要处理的课时");
        const batch={id:crypto.randomUUID(),context,analysis:!!message.analysis,forceAsr:!!message.forceAsr,items:ids.map(sub_id=>({sub_id,status:"pending"})),cancelled:false};
        await chrome.storage.local.set({batch});
        await chrome.alarms.create("batch",{periodInMinutes:0.5});
        void runBatch();return batch;
      }
      case "BATCH_STATE": return (await chrome.storage.local.get("batch")).batch||null;
      case "STOP_BATCH": {
        const {batch}=await chrome.storage.local.get("batch");
        if(batch){batch.cancelled=true;await chrome.storage.local.set({batch});}return true;
      }
      case "ATTACH_REPLAY": {
        const session=await A.api(`/api/sessions/${message.sid}`);
        if(session.time_basis==="capture") throw new Error("这份直播字幕从开始捕获时计时，无法直接与后上传的完整回放对齐");
        const context=await SchoolAPI.context(message.tabId);
        if(context.subId!==session.sub_id||context.courseId!==session.course_id) throw new Error("请打开此分析对应的课时再显示字幕");
        await installOverlay(message.tabId);
        await chrome.tabs.sendMessage(message.tabId,{type:"SCUT_REPLAY",session});return true;
      }
      default: throw new Error("未知扩展操作");
    }
  })().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==="batch") void runBatch();});
chrome.runtime.onStartup.addListener(()=>void runBatch());
chrome.tabs.onRemoved.addListener(async tabId=>{
  const capture=await activeCapture();
  if(capture?.tabId===tabId) await tellRecorder("STOP",{warning:"课程标签页已关闭；正在保存剩余音频"}).catch(()=>{});
});
chrome.tabs.onUpdated.addListener(async(tabId,change)=>{
  if(!change.url) return;
  const capture=await activeCapture();
  if(capture?.tabId===tabId&&change.url!==capture.url) await tellRecorder("STOP",{warning:"课程页面已切换，已结束上一课时录制"}).catch(()=>{});
  await chrome.storage.session.remove(`media-${tabId}`);
});
// Observe only media URL metadata on the two authorized school hosts, never headers or cookies.
chrome.webRequest.onBeforeRequest.addListener(async details=>{
  if(details.tabId<0||! /\.(m3u8|mp4|flv)(?:\?|$)/i.test(details.url)) return;
  const key=`media-${details.tabId}`;const data=await chrome.storage.session.get(key);
  const urls=data[key]||[];if(!urls.includes(details.url))await chrome.storage.session.set({[key]:[...urls,details.url].slice(-12)});
},{urls:["https://video.jw.scut.edu.cn/*","https://video-jw-443.webvpn.scut.edu.cn/*"]});
