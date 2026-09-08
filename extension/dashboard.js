const A=AssistantClient,L=CourseLibrary,$=id=>document.getElementById(id),isExtension=!!globalThis.chrome?.runtime?.id;
let sessions=[],imports=[],selected=null,detail=null,catalogue=[],catalogueCourse="",loading=false,detailStamp=0,listStamp="",course="",filter="lessons",configured=false;
const params=new URLSearchParams(location.search);
if(/^[a-f0-9]{32}$/.test(params.get("session")||""))selected=params.get("session");
if(/^\d+$/.test(params.get("course")||""))course=params.get("course");
const labels={queued:"等待本地处理",recording:"正在录音",stopping:"正在保存字幕",downloading:"下载音轨",transcribing:"本地转写",processing:"处理字幕",analyzing:"整理笔记",complete:"字幕已保存",failed:"字幕处理失败",cancelled:"已停止任务",interrupted:"录制中断"};
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function clock(sec){const n=Math.max(0,Math.floor(sec||0));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,"0")).join(":");}
function status(text,error=false){$("status").textContent=text;$("status").className="notice"+(error?" error":"");AssistantUI.toast(text);if($("import-dialog").open)$("batch-status").textContent=text;}
function seek(sec){if(detail.time_basis==="capture")return node("span",clock(sec),"muted");const url=new URL(detail.page_url);url.searchParams.set("note_play",Math.floor(sec));const a=node("a",clock(sec)+" ↗");a.href=url.href;a.target="_blank";a.rel="noopener noreferrer";a.title="从此处打开学校回放";return a;}
async function act(button,fn){button.disabled=true;try{await fn();}catch(e){status(e.message,true);}finally{button.disabled=false;if(detail)renderAction();}}
function matches(value){return !$("search").value.trim()||JSON.stringify(value).toLowerCase().includes($("search").value.trim().toLowerCase());}
function navigate(id=null){
  selected=id;detail=null;detailStamp=0;
  const url=new URL(location.href);
  if(id)url.searchParams.set("session",id);else url.searchParams.delete("session");
  if(course)url.searchParams.set("course",course);else url.searchParams.delete("course");
  history.replaceState(null,"",url);
  $("browse").hidden=!!id;$("detail").hidden=!id;
  if(id){$("detail-title").textContent="正在读取笔记…";void refreshDetail();}else renderLibrary();
  window.scrollTo({top:0,behavior:"instant"});
}
function showView(view){for(const item of document.querySelectorAll("[data-view]")){const on=item.dataset.view===view;item.classList.toggle("active",on);item.setAttribute("aria-selected",String(on));$("view-"+item.dataset.view).hidden=!on;}}
function openLesson(id,view="summary"){navigate(id);showView(view);}
function courseButton(id,title,count,notes){const b=node("button",undefined,"course-choice"+(course===id?" active":""));b.append(node("strong",title),node("small",count+" 份记录 · "+notes+" 份笔记"));b.setAttribute("aria-pressed",String(course===id));b.onclick=()=>{course=id;navigate();};return b;}
function renderLibrary(){
  const records=[...sessions,...L.importRows(imports)];
  const groups=L.groups(records),chosen=groups.find(g=>g.id===course),all=chosen?.lessons||records;
  const rail=$("course-list");rail.replaceChildren(courseButton("","全部课程",records.length,sessions.filter(L.hasNotes).length));
  for(const g of groups)rail.append(courseButton(g.id,g.title,g.lessons.length,g.ready));
  $("course-title").textContent=chosen?.title||"全部课程";
  const pending=all.filter(L.pending).length;
  $("course-meta").textContent=all.length+" 份课堂记录 · "+all.filter(L.hasNotes).length+" 份完整笔记"+(pending?" · "+pending+" 份待整理":"");
  document.querySelector('[data-filter="pending"]').textContent="待整理"+(pending?" "+pending:"");
  const cloud=$("topic-cloud");cloud.replaceChildren();
  if(filter==="lessons"&&chosen){for(const t of chosen.topics.slice(0,12)){const b=node("button",t,"topic-chip");b.onclick=()=>{$("search").value=t;renderLibrary();};cloud.append(b);}}
  const target=$("lesson-grid");target.replaceChildren();
  if(filter==="events"){
    const events=(chosen?[chosen]:groups).flatMap(g=>g.events.map(e=>({...e,course:g.title}))).filter(matches).sort((a,b)=>a.category.localeCompare(b.category)||a.start-b.start);
    for(const e of events){const card=node("article",undefined,"library-event");
      card.append(node("small",e.label+" · "+e.course+" · "+e.lesson),node("p",e.message),node("small","原文："+e.evidence));
      const b=node("button","查看本课事项 ↗");b.onclick=()=>openLesson(e.sid,"events");card.append(b);target.append(card);
    }
  }else{
    const rows=all.filter(s=>(filter!=="pending"||L.pending(s))&&matches([s.course_title,s.title,s.summary,s.important_events])).sort((a,b)=>b.start_at-a.start_at||b.created_at-a.created_at);
    for(const s of rows){
      if(s.isImport){const card=node("article",undefined,"note-card import-card");card.append(node("div",s.course_title,"note-meta"),node("h3",s.title),node("span",s.status==="failed"?"导入未完成":"正在读取学校数据","note-state pending"),node("p",s.error||"尚未交给本地处理。请保持浏览器、学校课时标签页和本地服务运行。"));
        const link=node("a",s.status==="failed"?"返回本节课重新导入 ↗":"打开学校课时 ↗","text-button");link.href=s.page_url;link.target="_blank";link.rel="noopener noreferrer";card.append(link);target.append(card);continue;}
      const card=node("button",undefined,"note-card"),titles=L.titles(s);
      const state=L.busy(s)?"整理中 "+(s.analysis_progress||""):s.analysis_status==="failed"?"笔记待续":L.hasNotes(s)?"笔记就绪":labels[s.status]||s.status;
      card.append(node("div",s.course_title+" · "+s.title,"note-meta"),node("h3",s.summary?.headline||titles.slice(0,2).join(" · ")||s.title));
      card.append(node("p",(s.summary?.abstract||s.summary?.overview||(s.analysis_status==="failed"?"字幕已保存，可以从中断处继续生成笔记。":s.segment_count?"已有字幕。生成笔记后，这里会显示本课知识点与内容概览。":s.progress||"等待课程字幕。")).slice(0,180)));
      const footer=node("footer");footer.append(node("span",state,"note-state"+(s.analysis_status==="failed"?" failed":L.hasNotes(s)?"":" pending")),node("span",s.event_count+" 条事项 · 查看 →"));card.append(footer);card.onclick=()=>openLesson(s.id);target.append(card);
    }
  }
  if(!target.children.length){const empty=node("div",undefined,"library-empty");empty.append(node("h3",sessions.length?(filter==="events"?"暂无匹配的重要事项":filter==="pending"?"没有待整理的记录":"没有匹配的内容"):"还没有课堂记录"),node("p",sessions.length?"可以切换课程或清除搜索条件。":"在学校页面开始课堂字幕，或导入已结束的课程回放。"));target.append(empty);}
  $("browse").hidden=!!selected;$("detail").hidden=!selected;
}
function renderAction(){
  const action=L.action({...detail,segment_count:detail.segments.length},configured);
  $("reanalyze").textContent=action.label;$("reanalyze").hidden=!!action.hidden;$("reanalyze").disabled=!!action.disabled;
  const audioBusy=detail.jobs.some(j=>["asr","media"].includes(j.lane)&&["pending","running"].includes(j.state));
  $("regenerate").hidden=!detail.summary;$("regenerate").disabled=L.busy(detail)||audioBusy||!detail.stopped;
  $("repair").hidden=detail.mode==="subtitle"||detail.status==="cancelled";$("repair").disabled=audioBusy||!detail.stopped;
  $("retry").hidden=!detail.jobs.some(j=>j.lane!=="analysis"&&j.state==="failed")||detail.status==="cancelled";
  $("attach").hidden=!isExtension||detail.time_basis==="capture";$("cancel").hidden=!audioBusy;
}
function renderDetail(){
  if(!detail)return;
  $("detail").hidden=false;$("browse").hidden=true;
  $("detail-course").textContent=detail.course_title+" · "+detail.title;$("detail-title").textContent=detail.summary?.headline||detail.title;
  $("detail-meta").textContent=(labels[detail.status]||detail.status)+" · "+detail.segments.length+" 条字幕 · "+(detail.time_basis==="capture"?"时间从本次录音开始":"时间对应原视频");
  const warning=[detail.error,detail.analysis_status==="failed"?detail.warning:"",detail.status==="interrupted"?detail.warning:""].filter(Boolean);
  $("detail-warning").textContent=[...new Set(warning)].join("\n");$("detail-warning").hidden=!warning.length;
  const busy=L.busy(detail),partial=!!detail.summary?.partial;
  $("analysis-progress").hidden=!busy&&!partial;
  $("progress-text").textContent=detail.analysis_stage==="events"&&busy?"通读全文，合并同一事项的任务、时间与要求":(busy?(detail.analysis_stage==="outline"?"生成整课概览":"正在整理"):"已保存部分笔记")+" · "+(detail.analysis_done||0)+" / "+(detail.analysis_total||"?")+" 段";
  $("progress-model").textContent=detail.analysis_model||"";
  $("progress-bar").max=detail.analysis_total||1;$("progress-bar").value=detail.analysis_done||0;
  const summary=$("view-summary");summary.replaceChildren();
  if(detail.summary){
    const topics=detail.summary.topics||[];
    if(detail.summary.abstract)summary.append(node("p",detail.summary.abstract,"lesson-abstract"));
    summary.append(node("p",topics.length+" 条分段笔记"+(partial?" · 后续内容仍在整理":"")+" · 点击时间定位回放","overview-intro"));
    const list=node("div",undefined,"topic-notes");
    for(const [index,t] of topics.entries()){const card=node("details",undefined,"topic-note"),top=node("header");card.id="topic-"+index;
      top.append(seek(t.start));if(t.chapter)top.append(node("span",t.chapter,"chapter-tag"));
      card.append(node("summary",t.title),top,node("p",t.detail));list.append(card);
    }
    if(!topics.length)list.append(node("p",detail.summary.overview||"本段未提取到独立知识点。","overview-intro"));
    const all=node("details",undefined,"all-notes");all.open=!detail.summary.groups?.length;all.append(node("summary","全部分段笔记 · "+topics.length),list);
    if(detail.summary.groups?.length){const groups=node("div",undefined,"theme-grid");for(const g of detail.summary.groups){const card=node("article",undefined,"theme-card");card.append(node("h3",g.title),node("p",g.detail));const refs=node("div",undefined,"theme-refs");for(const index of g.topic_indices||[]){if(!topics[index])continue;const link=node("button",topics[index].title);link.onclick=()=>{all.open=true;const target=list.children[index];target.open=true;target.scrollIntoView({block:"center",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});};refs.append(link);}card.append(refs);groups.append(card);}summary.append(groups);}
    summary.append(all);
  }else{
    const empty=node("div",undefined,"library-empty"),action=L.action({...detail,segment_count:detail.segments.length},configured);
    empty.append(node("h3",busy?"正在阅读本课字幕":detail.analysis_status==="failed"?"笔记生成中断":"本课笔记尚未生成"),
      node("p",busy?"第一段完成后会自动显示，页面可以关闭。":!configured?"在设置中保存一次 DeepSeek Key，之后无需重复填写。":detail.analysis_status==="failed"?"上方显示了具体原因。点击“继续生成笔记”会复用已经完成的部分。":"点击上方“生成本课笔记”，整理知识点、作业和课堂要求。"));
    if(action.disabled&&!busy)empty.append(node("small",action.label));
    summary.append(empty);
  }
  const events=$("view-events");events.replaceChildren();
  const confirmed=detail.events.filter(e=>e.source==="deepseek");
  events.append(node("p",detail.events_version?"已结合全文整理。同一事项的补充说明合并显示，点击出处可核对原话。":"这是旧版或课堂中的即时分析。点击“整理完整事项”，结合全文重新核对作业与要求。","overview-intro"));
  for(const e of confirmed){const card=node("article",undefined,"topic-note event-note"),top=node("header");top.append(node("strong",e.label),seek(e.start));card.append(top,node("h3",e.message));
    const facts=node("dl",undefined,"event-facts");
    for(const [key,label] of [["action","任务"],["deadline","时间"],["submission","提交方式"],["requirements","具体要求"],["grading","评分"]]){
      const value=e.details?.[key];if(value){facts.append(node("dt",label),node("dd",value));}
    }card.append(facts);
    const source=node("details",undefined,"event-source");source.append(node("summary","查看原文与上下文"));
    const ids=new Set(e.segment_ids),positions=detail.segments.map((s,i)=>ids.has(s.id)?i:-1).filter(i=>i>=0),included=new Set(positions.flatMap(i=>Array.from({length:7},(_,n)=>i+n-3).filter(n=>n>=0&&n<detail.segments.length)));
    if(!positions.length)for(const q of e.evidence_quotes||[e.evidence])source.append(node("blockquote",q));
    else source.append(node("small","深色为引用句，浅色为前后文。"));
    for(const i of [...included].sort((a,b)=>a-b)){const s=detail.segments[i],line=node("div",undefined,"event-context"+(ids.has(s.id)?" cited":""));line.append(seek(s.start),node("span",SessionView.clean(s)));source.append(line);}
    card.append(source);events.append(card);
  }
  if(!confirmed.length)events.append(node("p",detail.events_version?"通读本课字幕后，未提取到明确的作业、测验或其他课堂事项。":"尚未整理出明确事项。关键词初筛记录可在下方展开查看。","library-empty"));
  const candidates=detail.rule_candidates||detail.events.filter(e=>e.source==="local_rule");
  if(candidates.length){const initial=node("details",undefined,"rule-candidates");initial.append(node("summary","关键词初筛 · "+candidates.length+" 处（不代表有任务）"));for(const e of candidates){const p=node("p");p.append(seek(e.start),document.createTextNode(" "+e.evidence));initial.append(p);}events.append(initial);}
  const transcript=$("view-transcript"),scroll=transcript.scrollTop;transcript.replaceChildren();
  for(const s of detail.segments){const el=node("div",undefined,"segment");el.append(seek(s.start),node("span",SessionView.clean(s)));transcript.append(el);}transcript.scrollTop=scroll;
  renderAction();
}
async function refreshDetail(){if(!selected)return;const id=selected;try{const value=await A.api("/api/sessions/"+id);if(id!==selected)return;if(value.updated_at!==detailStamp){detail=value;detailStamp=value.updated_at;renderDetail();}}catch(e){status(e.message,true);}}
async function refresh(){
  if(loading)return;loading=true;
  try{
    const result=await Promise.all([A.api("/api/sessions"),A.api("/api/settings"),A.api("/api/imports")]);
    sessions=result[0];configured=result[1].deepseek_configured;imports=result[2];
    $("health").textContent="本地已连接";$("health").className="chip";
    const live=sessions.find(s=>s.mode==="live"&&!s.stopped&&s.status==="recording");
    $("current-class").hidden=!live;if(live)$("current-class-title").textContent=live.course_title+" · 正在后台录音";
    const stamp=JSON.stringify([sessions,imports]);
    if(stamp!==listStamp){listStamp=stamp;renderLibrary();}
    await refreshDetail();if(detail)renderAction();
    if(isExtension){const batch=await A.send("BATCH_STATE");$("stop-batch").hidden=!batch||batch.cancelled||!batch.items.some(i=>i.status==="pending");if(batch)$("batch-status").textContent=(batch.cancelled?"已停止继续导入 · ":"")+batch.items.filter(i=>i.status==="queued").length+"/"+batch.items.length+" 节已导入\n"+batch.items.filter(i=>i.status==="failed").map(i=>i.sub_id+"："+i.error).join("\n");}
  }catch(e){$("health").textContent="服务未连接";$("health").className="chip warn";status(e.message,true);}finally{loading=false;}
}
$("refresh").onclick=()=>{detailStamp=0;void refresh();};
$("search").oninput=()=>{if(selected)navigate();else renderLibrary();};
$("back-library").onclick=()=>{if(detail)course=detail.course_id;navigate();};
document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll("[data-filter]").forEach(x=>{x.classList.toggle("active",x===b);x.setAttribute("aria-pressed",String(x===b));});renderLibrary();});
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.querySelector(".tabs").addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;const buttons=[...document.querySelectorAll("[data-view]")],i=buttons.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const n=e.key==="Home"?0:e.key==="End"?buttons.length-1:(i+(e.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;buttons[n].click();buttons[n].focus();});
$("return-classroom").onclick=()=>{if(isExtension)void A.openClassroom(Number($("source-tab").value)||null).catch(e=>status(e.message,true));else location.href="classroom.html";};
$("open-import").onclick=()=>$("import-dialog").showModal();
$("close-import").onclick=()=>$("import-dialog").close();
$("repair").onclick=()=>act($("repair"),async()=>{const result=await A.api("/api/sessions/"+selected+"/repair",{method:"POST"});status("已安排 "+result.repair_count+" 段音频重新转写，旧字幕已备份。");detailStamp=0;await refresh();});
$("export").onclick=()=>act($("export"),()=>A.download(selected));
async function analyze(restart=false){if(!configured){location.href="options.html#intelligence";return;}await A.api("/api/sessions/"+selected+"/analyze"+(restart?"?restart=true":""),{method:"POST"});detailStamp=0;await refresh();}
$("reanalyze").onclick=()=>act($("reanalyze"),()=>analyze());
$("regenerate").onclick=()=>act($("regenerate"),()=>analyze(true));
for(const name of ["retry","cancel"])$(name).onclick=()=>act($(name),async()=>{await A.api("/api/sessions/"+selected+"/"+name,{method:"POST"});detailStamp=0;await refresh();});
$("attach").onclick=()=>act($("attach"),async()=>{const tabs=await chrome.tabs.query({url:["https://video.jw.scut.edu.cn/livingroom*","https://video-jw-443.webvpn.scut.edu.cn/livingroom*"]});const tab=tabs.find(t=>{const u=new URL(t.url);return u.searchParams.get("course_id")===detail.course_id&&u.searchParams.get("sub_id")===detail.sub_id;});if(!tab)throw new Error("请先在浏览器中打开这节课的播放页");await A.send("ATTACH_REPLAY",{tabId:tab.id,sid:selected});status("字幕已显示，将跟随原视频播放位置。");});
$("load-catalogue").onclick=()=>act($("load-catalogue"),async()=>{
  const data=await A.send("INSPECT",{tabId:Number($("source-tab").value)});catalogue=data.catalogue;catalogueCourse=data.lesson.course_title;$("batch-hint").textContent=catalogueCourse;$("catalogue").replaceChildren();
  for(const item of catalogue){const label=node("label",undefined,"lesson-check"),box=document.createElement("input");box.type="checkbox";box.value=item.sub_id;box.checked=!["1","2","3","5","9"].includes(item.status);box.disabled=!box.checked;label.append(box,node("span",item.title),node("small",box.disabled?"未就绪":"可处理"));$("catalogue").append(label);}
  if(!catalogue.length)throw new Error("未取得课程目录；请检查学校接口或重新打开课程页面");
});
$("select-ready").onclick=()=>$("catalogue").querySelectorAll("input:not(:disabled)").forEach(x=>x.checked=true);$("select-none").onclick=()=>$("catalogue").querySelectorAll("input").forEach(x=>x.checked=false);
$("start-batch").onclick=()=>act($("start-batch"),async()=>{const subIds=[...$("catalogue").querySelectorAll("input:checked")].map(i=>i.value);await A.send("START_BATCH",{tabId:Number($("source-tab").value),subIds,lessons:catalogue.map(l=>({...l,course_title:catalogueCourse})),analysis:$("batch-analysis").checked,forceAsr:$("force-asr").checked});status("导入请求已保存，正在读取学校数据。进度和失败原因会保留在待整理中。");await refresh();});
$("stop-batch").onclick=()=>act($("stop-batch"),async()=>{await A.send("STOP_BATCH");status("已停止继续导入。已入队的本地课时可逐个取消。");});
(async()=>{
  const token=new URLSearchParams(location.hash.slice(1)).get("token");if(token){await A.setConnection(token);history.replaceState(null,"",location.pathname+location.search);}
  if(isExtension){const tabs=await chrome.tabs.query({url:["https://video.jw.scut.edu.cn/livingroom*","https://video-jw-443.webvpn.scut.edu.cn/livingroom*"]});for(const t of tabs)$("source-tab").add(new Option(t.title,t.id));const initial=new URLSearchParams(location.search).get("tab");if(initial&&tabs.some(t=>String(t.id)===initial))$("source-tab").value=initial;}
  else {$("batch-controls").hidden=true;$("batch-unavailable").hidden=false;}
  await refresh();if(params.get("import")==="1")$("import-dialog").showModal();setInterval(()=>void refresh(),3000);
})();
