globalThis.SchoolAPI = {
  async context(tabId) {
    let tab;
    try {tab=await chrome.tabs.get(tabId);}
    catch {throw new Error("课程页面已关闭或重新打开，请重新选择学校播放页并读取课时目录");}
    const parsed = ScutSubtitleCore.parseCourseUrl(tab.url||"");
    if (!parsed?.courseId) throw new Error("请先打开包含 course_id 的课程播放页面");
    return {...parsed,tabId,url:tab.url};
  },
  async resolveContext(context) {
    // A tab ID is temporary. Preserve the school entry and course when rebinding.
    const expected=ScutSubtitleCore.parseCourseUrl(context?.url||"");
    if(!expected?.courseId||expected.courseId!==context.courseId||expected.origin!==context.origin)
      throw new Error("课程关联信息无效，请重新读取课时目录");
    const matches=tab=>{const parsed=ScutSubtitleCore.parseCourseUrl(tab?.url||"");return parsed?.origin===expected.origin&&parsed.courseId===expected.courseId&&parsed.tenantCode===expected.tenantCode;};
    let tab;
    try {tab=await chrome.tabs.get(context.tabId);} catch { /* Look for a reopened page of this course. */ }
    if(!matches(tab)) {
      const tabs=await chrome.tabs.query({url:expected.origin+"/livingroom*"});
      const candidates=tabs.filter(matches);
      tab=candidates.find(t=>ScutSubtitleCore.parseCourseUrl(t.url).subId===expected.subId)||candidates.find(t=>t.active)||candidates[0];
    }
    if(!tab)throw new Error("这门课的学校播放页已关闭或切换。请打开同一门课的播放页后重试导入，无需重新勾选课时");
    return {...context,...expected,tabId:tab.id};
  },
  async get(context, kind, subId=context.subId) {
    const api=ScutSubtitleCore.createApi(context.origin);
    const url=kind==="catalogue"?api.catalogue(context.courseId):kind==="subtitle"?api.subtitle(subId):api.subInfo(context.courseId,subId);
    let current=await this.resolveContext(context);
    // Execute only a fixed GET endpoint on the already logged-in school origin. No cookies are exported.
    const execute=tabId=>chrome.scripting.executeScript({target:{tabId},world:"MAIN",
      func:async(url,origin,kind,courseId,tenantCode)=>{
        const target=new URL(url);
        const page=new URL(location.href);
        if(location.origin!==origin||target.origin!==origin||!target.pathname.startsWith("/courseapi/")||page.searchParams.get("course_id")!==courseId||(page.searchParams.get("tenant_code")||"21")!==tenantCode) return {error:"课程页面已切换，请在同一门课的播放页重试"};
        try {
          const response=await fetch(url,{credentials:"include",signal:AbortSignal.timeout(15000)});
          if(!response.ok) return {error:`学校接口 HTTP ${response.status}，请检查登录状态`};
          const data=await response.json();
          // The school uses a business error code for a replay whose subtitles have not been uploaded.
          if(kind==="subtitle"&&String(data.code)==="10002"&&data.msg==="未查询到语音数据"&&Number(data.total)===0&&Array.isArray(data.list)&&data.list.length===0) return {data:{code:0,list:[]}};
          if(data.code!==undefined&&![0,200,"0","200"].includes(data.code)) return {error:"学校接口未授权或数据暂不可用，请在当前入口重新登录"};
          return {data};
        } catch {return {error:"学校接口请求失败，请检查登录或校园网络"};}
      },args:[url,current.origin,kind,current.courseId,current.tenantCode]});
    let results;
    try {results=await execute(current.tabId);}
    catch(error){
      if(!/No tab with id|Frame with ID .* was removed|No frame with id/i.test(error.message||""))throw error;
      current=await this.resolveContext(context);
      try {results=await execute(current.tabId);}catch{throw new Error("学校播放页正在关闭或切换，请保持同一门课的播放页打开后重试导入");}
    }
    const result=results?.[0]?.result;
    if(!result||result.error) throw new Error(result?.error||"课程页未响应");
    return result.data;
  },
  async inspect(tabId,{includeCatalogue=true}={}) {
    const context=await this.context(tabId);
    const info=(await this.get(context,"info"))?.data||{};
    const media=ScutStudy.mediaSources(info,context.origin);
    const cat=includeCatalogue?await this.get(context,"catalogue").then(ScutStudy.catalogue).catch(()=>[]):[];
    return {context,lesson:ScutStudy.lesson(info,context),status:String(info.sub_status),sources:media,catalogue:cat};
  }
};
