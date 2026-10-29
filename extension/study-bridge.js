/* Authenticated local jobs -> fixed school reads, using the existing replay pipeline. */
globalThis.ScutAgentBridge = (() => {
  let running=false;
  async function poll({client,processLesson,busy}) {
    if(running||busy())return;
    running=true;
    try {
      const jobs=await client.api("/api/study/browser/work",{timeout:3000});
      if(!Array.isArray(jobs)||!jobs.length)return;
      const saved=await chrome.storage.local.get("studyBridgeClient");
      const owner=saved.studyBridgeClient||crypto.randomUUID();
      if(!saved.studyBridgeClient)await chrome.storage.local.set({studyBridgeClient:owner});
      const tabs=await chrome.tabs.query({url:["https://video.jw.scut.edu.cn/livingroom*","https://video-jw-443.webvpn.scut.edu.cn/livingroom*"]});
      const post=(path,body)=>client.api("/api/study/browser/"+path,{method:"POST",body});
      for(const job of jobs.slice(0,3)) {
        let match;
        for(const tab of tabs.slice(0,12)) {
          try {const view=await SchoolAPI.inspect(tab.id,{includeCatalogue:false});if(view.lesson.course_title===job.course){match=view;break;}}catch{/* A closed or logged-out tab cannot be used. */}
        }
        if(!match)continue;
        let claim;
        try {claim=await post(job.id+"/claim",{client:owner});}catch{continue;}
        const catalogue=ScutStudy.catalogue(await SchoolAPI.get(match.context,"catalogue"));
        if(catalogue.length>1000)throw new Error("课程目录超过 1000 节，请分批选择课时");
        let current=await post(job.id+"/catalogue",{client:owner,course_id:match.context.courseId,course_title:match.lesson.course_title,page_url:match.context.url,items:catalogue});
        // Bounded work per alarm; every submitted item is checkpointed server-side.
        for(const item of current.items.filter(x=>x.status==="pending").slice(0,6)) {
          if(busy())break;
          try {
            claim=await post(job.id+"/claim",{client:owner});
            if(claim.status==="cancelled")break;
            let session;
            if(item.action==="analyze")session=await client.api(`/api/sessions/${item.sid}/analyze`,{method:"POST"});
            else if(item.action==="retry")session=await client.api(`/api/sessions/${item.sid}/retry`,{method:"POST"});
            else session=await processLesson(match.context,item.sub_id,true,false,job.id+"-"+item.sub_id,async()=>{});
            await post(job.id+"/result",{client:owner,sub_id:item.sub_id,status:"queued",sid:session.id||item.sid,error:""});
          } catch(error) {
            await post(job.id+"/result",{client:owner,sub_id:item.sub_id,status:"failed",error:String(error.message||error).slice(0,300)}).catch(()=>{});
          }
        }
      }
    } finally {running=false;}
  }
  return {poll};
})();
