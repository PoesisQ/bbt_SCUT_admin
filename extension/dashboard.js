const A=AssistantClient,$=id=>document.getElementById(id),isExtension=!!globalThis.chrome?.runtime?.id;
let sessions=[],selected=null,detail=null,view="summary",catalogue=[],loading=false,detailStamp=0,listStamp="";
const requestedSession=new URLSearchParams(location.search).get("session");
if(/^[a-f0-9]{32}$/.test(requestedSession||""))selected=requestedSession;
let revealDetail=!!selected;
function selectLesson(id){selected=id;detailStamp=0;revealDetail=true;const url=new URL(location.href);url.searchParams.set('session',id);history.replaceState(null,'',url);renderTimeline();void refreshDetail();}
const labels={queued:"排队中",recording:"实时录制",stopping:"保存中",downloading:"下载音轨",transcribing:"本地转写",processing:"处理中",analyzing:"分析中",complete:"已完成",failed:"需要重试",cancelled:"已取消",interrupted:"录制中断"};
const analysisLabels={idle:"未开启",queued:"排队中",running:"进行中",complete:"已完成",failed:"需要重试"};
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function clock(sec){const n=Math.max(0,Math.floor(sec||0));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,"0")).join(":");}
function status(text,error=false){$("status").textContent=text;$("status").className="notice"+(error?" error":"");}
function seek(sec){if(detail.time_basis==="capture")return node("span",clock(sec),"muted");const url=new URL(detail.page_url);url.searchParams.set("note_play",Math.floor(sec));const a=node("a",clock(sec));a.href=url.href;a.target="_blank";a.rel="noopener noreferrer";return a;}
async function act(button,fn){button.disabled=true;try{await fn();}catch(e){status(e.message,true);}finally{button.disabled=false;}}
function renderTimeline(){
  const filter=$("course-filter").value,query=$("search").value.toLowerCase();
  const rows=sessions.filter(s=>(!filter||s.course_id===filter)&&(!query||JSON.stringify([s.title,s.course_title,s.summary]).toLowerCase().includes(query)))
    .sort((a,b)=>a.start_at-b.start_at||a.created_at-b.created_at);
  const target=$("timeline");target.replaceChildren();
  if(!rows.length){const empty=node("div",undefined,"card empty muted"),icon=node("span");icon.dataset.icon=sessions.length?"search":"book";empty.append(icon,node("h3",sessions.length?"没有匹配的课时":"你的第一节课，从这里开始。"),node("p",sessions.length?"试着换个关键词，或查看全部课程。":"从浏览器扩展开始实时字幕，或读取课程目录，批量整理回放。"));target.append(empty);AssistantUI.icons(empty);return;}
  for(const s of rows){const card=node("button",undefined,`card lesson-card${s.id===selected?" selected":""}`);
    const top=node("div",undefined,"row between");top.append(node("span",s.course_title,"eyebrow"),node("span",labels[s.status]||s.status,"chip"+(s.status==="failed"?" warn":"")));
    card.append(top,node("h3",s.title),node("small",`${s.segment_count} 条字幕 · ${s.event_count} 条提醒${s.mode==="live"?" · 现场记录":""}`));
    if(s.summary?.overview)card.append(node("p",s.summary.overview.slice(0,160)));else if(s.progress||s.error)card.append(node("p",s.error||s.progress,"muted"));
    card.setAttribute("aria-expanded",String(s.id===selected));card.setAttribute("aria-controls","detail");
    card.onclick=()=>selectLesson(s.id);target.append(card);
  }
}
function renderDetail(){
  if(!detail)return;$("detail").classList.remove("hidden");$("detail-course").textContent=detail.course_title;$("detail-title").textContent=detail.title;
  $("detail-meta").textContent=`${labels[detail.status]||detail.status} · ${detail.segments.length} 条字幕 · 分析：${analysisLabels[detail.analysis_status]||detail.analysis_status}${detail.time_basis==="capture"?" · 时间从本次捕获开始计算":" · 时间与原视频对应"}`;
  const warning=[detail.error,detail.warning,...detail.jobs.filter(j=>j.state==="failed").map(j=>j.error)].filter(Boolean);
  $("detail-warning").textContent=[...new Set(warning)].join("\n");$("detail-warning").classList.toggle("hidden",!warning.length);
  const summary=$("view-summary");summary.replaceChildren();
  if(detail.summary){summary.append(node("p",detail.summary.overview,"notice"));for(const t of detail.summary.topics){const el=node("div",undefined,"topic");el.append(seek(t.start),node("h3",t.title),node("small",t.chapter||"原文未明确教材章节"),node("p",t.detail));summary.append(el);}}
  else summary.append(node("p",detail.analysis_status==="running"?`正在分析 ${detail.analysis_progress||""}…`:"尚未生成主题概览。配置 Key 后点击“DeepSeek 分析”，可从已保存的字幕生成。","empty muted"));
  const events=$("view-events");events.replaceChildren();
  for(const e of detail.events){const el=node("article",undefined,"event");el.append(seek(e.start),node("strong",` ${e.label}`),node("p",e.message),node("p",`原文：${e.evidence}`),node("small",e.source==="deepseek"?`DeepSeek · 置信度 ${Math.round(e.confidence*100)}%` :"本地规则初筛 · 待核对"));events.append(el);}
  if(!detail.events.length)events.append(node("p","暂无命中的重要事项。","empty muted"));
  const transcript=$("view-transcript"),scroll=transcript.scrollTop;transcript.replaceChildren();
  for(const s of detail.segments){const el=node("div",undefined,"segment");el.append(seek(s.start),node("span",SessionView.clean(s)));transcript.append(el);}transcript.scrollTop=scroll;
  $("attach").hidden=!isExtension||detail.time_basis==="capture";$("cancel").hidden=["complete","cancelled","failed"].includes(detail.status);
  $("retry").hidden=!detail.jobs.some(j=>j.state==="failed");
}
async function refreshDetail(){if(!selected)return;const requested=selected;try{const value=await A.api(`/api/sessions/${requested}`);if(requested!==selected)return;if(value.updated_at!==detailStamp){detail=value;detailStamp=value.updated_at;renderDetail();}if(revealDetail){revealDetail=false;$('detail').scrollIntoView({block:'start'});}}catch(e){status(e.message,true);}}
async function refresh(){
  if(loading)return;loading=true;
  try {
    sessions=await A.api("/api/sessions");$("health").textContent="本地服务已连接";$("health").className="chip";
    const live=sessions.find(s=>s.mode==='live'&&!s.stopped&&s.status==='recording');
    $('current-class').hidden=!live;
    if(live)$('current-class-title').textContent=live.course_title+' · 正在后台录音';
    document.querySelector('.welcome-strip').hidden=sessions.length>0;
    $("total").textContent=sessions.length;$("event-total").textContent=sessions.reduce((s,v)=>s+v.event_count,0);
    $("pending-total").textContent=sessions.filter(s=>!["complete","failed","cancelled","interrupted"].includes(s.status)).length;
    const stamp=JSON.stringify(sessions);
    if(stamp!==listStamp){
      listStamp=stamp;
      const filter=$("course-filter"),previous=filter.value;filter.replaceChildren(new Option("全部课程",""));
      for(const [id,title] of new Map(sessions.map(s=>[s.course_id,s.course_title])))filter.add(new Option(title,id));filter.value=previous;
      renderTimeline();
    }
    await refreshDetail();
    if(isExtension){const batch=await A.send("BATCH_STATE");if(batch)$("batch-status").textContent=`${batch.cancelled?"已停止继续导入 · ":""}${batch.items.filter(i=>i.status==="queued").length}/${batch.items.length} 节已入队\n`+batch.items.filter(i=>i.status==="failed").map(i=>`${i.sub_id}：${i.error}`).join("\n");}
  }catch(e){$("health").textContent="待连接";$("health").className="chip warn";status(e.message,true);}finally{loading=false;}
}
$("refresh").onclick=()=>{detailStamp=0;void refresh();};$("course-filter").onchange=renderTimeline;$("search").oninput=renderTimeline;
$('return-classroom').onclick=()=>{if(isExtension)void A.openClassroom(Number($('source-tab').value)||null).catch(e=>status(e.message,true));else location.href='classroom.html';};
document.querySelectorAll("[data-view]").forEach(button=>button.onclick=()=>{view=button.dataset.view;for(const item of document.querySelectorAll("[data-view]")){item.classList.toggle("active",item===button);item.setAttribute("aria-selected",String(item===button));}for(const name of ["summary","events","transcript"])$("view-"+name).hidden=name!==view;});
document.querySelector(".tabs").addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;const buttons=[...document.querySelectorAll("[data-view]")],i=buttons.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const n=e.key==="Home"?0:e.key==="End"?buttons.length-1:(i+(e.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;buttons[n].click();buttons[n].focus();});
$("repair").onclick=()=>act($("repair"),async()=>{const result=await A.api(`/api/sessions/${selected}/repair`,{method:"POST"});status(`已加入 ${result.repair_count} 段音频重新转写，原始记录已备份，当前实时字幕优先。`);detailStamp=0;await refresh();});
$("export").onclick=()=>act($("export"),()=>A.download(selected));
for(const [id,path] of [["retry","retry"],["cancel","cancel"],["reanalyze","analyze"]])$(id).onclick=()=>act($(id),async()=>{await A.api(`/api/sessions/${selected}/${path}`,{method:"POST"});detailStamp=0;await refresh();});
$("attach").onclick=()=>act($("attach"),async()=>{const tabs=await chrome.tabs.query({url:["https://video.jw.scut.edu.cn/livingroom*","https://video-jw-443.webvpn.scut.edu.cn/livingroom*"]});const tab=tabs.find(t=>{const u=new URL(t.url);return u.searchParams.get("course_id")===detail.course_id&&u.searchParams.get("sub_id")===detail.sub_id;});if(!tab)throw new Error("请先在浏览器中打开这节课的播放页");await A.send("ATTACH_REPLAY",{tabId:tab.id,sid:selected});status("悬浮字幕已显示，将跟随原视频播放位置。");});
$("load-catalogue").onclick=()=>act($("load-catalogue"),async()=>{
  const data=await A.send("INSPECT",{tabId:Number($("source-tab").value)});catalogue=data.catalogue;$("batch-hint").textContent=data.lesson.course_title;$("catalogue").replaceChildren();
  for(const item of catalogue){const label=node("label",undefined,"lesson-check"),box=document.createElement("input");box.type="checkbox";box.value=item.sub_id;box.checked=!["1","2","3","5","9"].includes(item.status);box.disabled=!box.checked;label.append(box,node("span",item.title),node("small",box.disabled?"未就绪":"可处理"));$("catalogue").append(label);}
  if(!catalogue.length)throw new Error("未取得课程目录；请检查学校接口或重新打开课程页面");
});
$("select-ready").onclick=()=>$("catalogue").querySelectorAll("input:not(:disabled)").forEach(x=>x.checked=true);$("select-none").onclick=()=>$("catalogue").querySelectorAll("input").forEach(x=>x.checked=false);
$("start-batch").onclick=()=>act($("start-batch"),async()=>{const subIds=[...$("catalogue").querySelectorAll("input:checked")].map(i=>i.value);await A.send("START_BATCH",{tabId:Number($("source-tab").value),subIds,analysis:$("batch-analysis").checked,forceAsr:$("force-asr").checked});status("已开始导入所选课时；本地任务会按顺序处理。请保持该课程标签页打开至导入结束。");});
$("stop-batch").onclick=()=>act($("stop-batch"),async()=>{await A.send("STOP_BATCH");status("已停止继续导入。已入队的本地课时可逐个取消。");});
(async()=>{
  const token=new URLSearchParams(location.hash.slice(1)).get("token");if(token){await A.setConnection(token);history.replaceState(null,"",location.pathname+location.search);}
  if(isExtension){const tabs=await chrome.tabs.query({url:["https://video.jw.scut.edu.cn/livingroom*","https://video-jw-443.webvpn.scut.edu.cn/livingroom*"]});for(const t of tabs)$("source-tab").add(new Option(t.title,t.id));const initial=new URLSearchParams(location.search).get("tab");if(initial&&tabs.some(t=>String(t.id)===initial))$("source-tab").value=initial;}
  else {$("batch-controls").hidden=true;$("batch-unavailable").hidden=false;}
  await refresh();setInterval(()=>void refresh(),3000);
})();
