(() => {
const A=AssistantClient,V=SessionView,$=id=>document.getElementById(id);
let tab,inspection,connected=false,reading=false,editing=false,configured=false,activeSession=null,preferences={analysisDefault:true},acting=new Set();
function show(text,error=false){$("message").textContent=text;$("message").className="notice"+(error?" error":"");}
if(!globalThis.chrome?.runtime?.id||new URLSearchParams(location.search).get("preview")==="1"){
  document.body.classList.add("demo");document.title="扩展外观预览 · SCUT 课堂助手";
  $("connection").textContent="外观预览";$("course").textContent="你的下一节课";$("lesson").textContent="连续字幕、当前模型与课堂重点，展开后一直可见。";$("source").textContent="此处为界面示意，不会捕获声音。";
  for(const id of ["start","stop","process","recover","analysis","legacy"])$(id).disabled=true;
  $("analysis").checked=true;$("dashboard").onclick=()=>location.href="dashboard.html";$("options").onclick=()=>location.href="options.html";
  $("expand-room").onclick=()=>location.href="classroom.html";$("recorder").textContent="预览不会启动录音";return;
}
async function action(id,fn){acting.add(id);$(id).disabled=true;try{await fn();}catch(e){show(e.message,true);}finally{acting.delete(id);$(id).disabled=false;await recorder();}}
async function recorder(){
  if(reading)return;reading=true;
  try{const state=await A.send("RECORDER_STATE");const running=!!state?.recording;
    document.body.classList.toggle("is-recording",running);
    $("expand-room").textContent=running?"返回正在录音的课堂 ↗":"打开课堂实况 ↗";
    $("expand-room").classList.toggle("primary",running);
    $("lifecycle-note").textContent=running?"录音在后台继续。点这里查看，不会重启。":"关闭窗口不结束录音；再次点击扩展即可回来。";
    $("start").hidden=running;$("stop").hidden=!running;
    $("expand-room").hidden=!running&&!state?.sid;
    if(state?.sid){activeSession=await A.api("/api/sessions/"+state.sid);if(!editing)$("analysis").checked=V.analysisEnabled(preferences,activeSession);$("course").textContent=activeSession.course_title;$("lesson").textContent=activeSession.title;
      $("live-context").hidden=!activeSession.segments.length;V.paint($("live-sentences"),activeSession.segments.slice(-4),true);
      if(running)$("source").textContent="后台正在录音 · 打开面板不会重启课堂";
    }else {activeSession=null;$("live-context").hidden=true;if(!editing)$("analysis").checked=V.analysisEnabled(preferences,null);}
    $("recorder").textContent=state?.error||(running?"正在听课 · 待上传 "+(state.pending||0)+" 段":state?.pending?"正在补传 "+state.pending+" 段":"当前没有录音 · 历史字幕在课程笔记中");
    if(!acting.has("stop"))$("stop").disabled=!running;
    if(!acting.has("start"))$("start").disabled=!connected||!inspection||running||!!state?.pending;
    $("analysis").disabled=!configured||editing;
  }catch(e){$("recorder").textContent=e.message;}finally{reading=false;}
}
$("options").onclick=()=>chrome.runtime.openOptionsPage();
$("legacy").onclick=()=>location.href="popup.html";
$("dashboard").onclick=()=>A.openDashboard(null,tab?.id);
$("session-detail").onclick=()=>A.openDashboard(activeSession?.id,tab?.id);
$("expand-room").onclick=()=>action("expand-room",()=>A.openClassroom(tab?.id));
$("analysis").onchange=async()=>{editing=true;const wanted=$("analysis").checked;
  try{if(activeSession)await A.api("/api/sessions/"+activeSession.id+"/analysis-preference",{method:"POST",body:{enabled:wanted}});
    preferences.analysisDefault=wanted;await chrome.storage.local.set({analysisDefault:wanted});
    show(wanted?"智能分析已开启，并记住下次的选择。":"后续智能分析已关闭，字幕照常保存。");
  }catch(e){$("analysis").checked=!wanted;show(e.message,true);}finally{editing=false;await recorder();}
};
$("start").onclick=()=>action("start",async()=>{await A.send("START_CAPTURE",{tabId:tab.id,analysis:configured&&$("analysis").checked});show("已开始录音。点“返回正在录音的课堂”查看连续字幕。");});
$("stop").onclick=()=>action("stop",async()=>{const s=await A.send("STOP_CAPTURE");show(s.pending?"正在补传 "+s.pending+" 段音频，请保持本地服务运行。":"录音已结束，剩余字幕和总结会继续保存。");});
$("recover").onclick=()=>action("recover",async()=>{const s=await A.send("RECOVER_UPLOADS");show(s.error||"待上传音频："+s.pending+" 段",!!s.error);});
$("auto-open").onchange=async e=>{await chrome.storage.local.set({autoOpenAssistant:e.target.checked});};
$("process").onclick=()=>action("process",async()=>{if(!inspection)throw new Error("未找到课时信息");await A.send("START_BATCH",{tabId:tab.id,subIds:[inspection.lesson.sub_id],analysis:configured&&$("analysis").checked,forceAsr:false});show("本节课已加入队列，可在课程笔记查看。");});
(async()=>{preferences=await chrome.storage.local.get({analysisDefault:true,autoOpenAssistant:true});$("analysis").checked=V.analysisEnabled(preferences,null);$("auto-open").checked=preferences.autoOpenAssistant;
  const sourceTab=Number(new URLSearchParams(location.search).get("tab"));
  if(sourceTab>0)tab=await chrome.tabs.get(sourceTab);else [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  try{inspection=await A.send("INSPECT",{tabId:tab.id});$("course").textContent=inspection.lesson.course_title;$("lesson").textContent=inspection.lesson.title;$("source").textContent=inspection.status==="1"?"直播中 · 自动识别中英文课堂":inspection.status==="6"?"回放已就绪":"回放可能尚未就绪";}catch(e){$("course").textContent="请打开课程播放页面";$("lesson").textContent=e.message;$("start").disabled=true;$("process").disabled=true;}
  try{const h=await A.api("/api/health");connected=true;configured=h.deepseek_configured;$("connection").textContent="本地已连接";$("connection").className="chip";if(!configured)show("智能分析默认开启；配置 Key 后生效。现在仍可使用本地字幕。");}catch(e){$("connection").textContent="待连接";show("请启动本地服务，在偏好设置中粘贴连接口令。",true);}
  $("process").disabled=!connected||!inspection||["1","2","3","5","9"].includes(String(inspection.status));
  await recorder();setInterval(()=>void recorder(),1500);
})();
})();
