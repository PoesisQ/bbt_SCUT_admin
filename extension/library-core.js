(function(root){
  "use strict";
  const busy = s => ["queued","running"].includes(s.analysis_status);
  const titles = s => [...new Set((s.summary?.topics || []).map(t=>t.title).filter(Boolean))];
  const hasNotes = s => !!s.summary && !s.summary.partial && s.analysis_status === "complete";
  const needsNotes = s => s.status !== "cancelled" && !!s.segment_count && !hasNotes(s);
  const pending = s => s.isImport ? ["pending","failed"].includes(s.status) : needsNotes(s)||["queued","downloading","transcribing","processing","failed"].includes(s.status);
  function lessons(records){
    const map=new Map();
    for(const s of records){const key=s.course_id+":"+s.sub_id;if(!map.has(key))map.set(key,[]);map.get(key).push(s);}
    return [...map.values()].map(versions=>{
      const span=Math.max(0,...versions.filter(s=>s.time_basis!=="capture").map(s=>s.coverage_seconds||0));
      const comprehensive=s=>s.time_basis!=="capture"&&(s.coverage_seconds||0)>=span*.95;
      const ranked=[...versions].sort((a,b)=>Number(!b.isImport)-Number(!a.isImport)||Number(comprehensive(b))-Number(comprehensive(a))||Number(hasNotes(b))-Number(hasNotes(a))||(b.coverage_seconds||0)-(a.coverage_seconds||0)||b.created_at-a.created_at);
      const events=new Map();for(const s of versions)for(const e of s.important_events||[]){const key=[s.time_basis==="capture"?s.id:"video",e.start,e.category,e.message].join("|");if(!events.has(key))events.set(key,{...e,sid:s.id});}
      const main=ranked[0];return {...main,important_events:[...events.values()],versions:ranked,lesson_pending:versions.some(pending),record_count:versions.filter(s=>!s.isImport).length};
    });
  }
  function importRows(imports){
    const latest=new Map();
    for(const item of [...imports].sort((a,b)=>b.created_at-a.created_at)){
      const key=item.course_id+":"+item.sub_id;
      if(!latest.has(key))latest.set(key,item);
    }
    return [...latest.values()].filter(i=>["pending","failed"].includes(i.status)).map(i=>({...i,isImport:true,segment_count:0,event_count:0}));
  }
  function groups(sessions){
    const result = new Map();
    for(const s of sessions){
      const key = s.course_id || s.course_title || "unknown";
      if(!result.has(key))result.set(key,{id:key,title:s.course_title||"未命名课程",lessons:[]});
      result.get(key).lessons.push(s);
    }
    return [...result.values()].map(g=>({...g,topics:[...new Set(g.lessons.flatMap(s=>(s.versions||[s]).flatMap(v=>v.summary?.groups?.length?v.summary.groups.map(t=>t.title):titles(v))))],
      ready:g.lessons.filter(hasNotes).length,needs:g.lessons.filter(needsNotes).length,
      events:g.lessons.flatMap(s=>(s.important_events||[]).map(e=>({...e,sid:e.sid||s.id,lesson:s.title})))}));
  }
  function action(s,configured){
    if(s.status === "cancelled")return {label:"任务已取消",disabled:true};
    if(!s.stopped || ["queued","downloading","transcribing","processing"].includes(s.status))return {label:"等待字幕处理完成",disabled:true};
    if(busy(s))return {label:`正在整理 ${s.analysis_progress || ""}`.trim(),disabled:true};
    if(!configured)return {label:"设置分析 Key",settings:true};
    if(!s.segment_count)return {label:"暂无可分析字幕",disabled:true};
    if(hasNotes(s)&&!s.events_version)return {label:"整理完整事项"};
    if(hasNotes(s))return {label:"笔记已就绪",hidden:true};
    return {label:s.analysis_status === "failed" || s.summary?.partial ? "继续生成笔记" : "生成本课笔记"};
  }
  const api={groups,lessons,titles,hasNotes,needsNotes,pending,importRows,busy,action};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  root.CourseLibrary=api;
})(globalThis);
