(function(root){
  "use strict";
  const busy = s => ["queued","running"].includes(s.analysis_status);
  const titles = s => [...new Set((s.summary?.topics || []).map(t=>t.title).filter(Boolean))];
  const hasNotes = s => !!s.summary && !s.summary.partial && s.analysis_status === "complete";
  const needsNotes = s => s.status !== "cancelled" && !!s.segment_count && !hasNotes(s);
  function groups(sessions){
    const result = new Map();
    for(const s of sessions){
      const key = s.course_id || s.course_title || "unknown";
      if(!result.has(key))result.set(key,{id:key,title:s.course_title||"未命名课程",lessons:[]});
      result.get(key).lessons.push(s);
    }
    return [...result.values()].map(g=>({...g,topics:[...new Set(g.lessons.flatMap(s=>s.summary?.groups?.length?s.summary.groups.map(t=>t.title):titles(s)))],
      ready:g.lessons.filter(hasNotes).length,needs:g.lessons.filter(needsNotes).length,
      events:g.lessons.flatMap(s=>(s.important_events||[]).map(e=>({...e,sid:s.id,lesson:s.title})))}));
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
  const api={groups,titles,hasNotes,needsNotes,busy,action};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  root.CourseLibrary=api;
})(globalThis);
