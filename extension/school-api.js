globalThis.SchoolAPI = {
  async context(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const parsed = ScutSubtitleCore.parseCourseUrl(tab.url||"");
    if (!parsed?.courseId) throw new Error("请先打开包含 course_id 的课程播放页面");
    return {...parsed,tabId,url:tab.url};
  },
  async get(context, kind, subId=context.subId) {
    const api=ScutSubtitleCore.createApi(context.origin);
    const url=kind==="catalogue"?api.catalogue(context.courseId):kind==="subtitle"?api.subtitle(subId):api.subInfo(context.courseId,subId);
    const current=await this.context(context.tabId);
    if(current.origin!==context.origin||current.courseId!==context.courseId) throw new Error("课程标签页已切换，请重新打开课堂助手");
    // Execute only a fixed GET endpoint on the already logged-in school origin. No cookies are exported.
    const results=await chrome.scripting.executeScript({target:{tabId:context.tabId},world:"MAIN",
      func:async(url,origin,kind)=>{
        const target=new URL(url);
        if(location.origin!==origin||target.origin!==origin||!target.pathname.startsWith("/courseapi/")) return {error:"课程页面来源不匹配"};
        try {
          const response=await fetch(url,{credentials:"include",signal:AbortSignal.timeout(15000)});
          if(!response.ok) return {error:`学校接口 HTTP ${response.status}，请检查登录状态`};
          const data=await response.json();
          // The school uses a business error code for a replay whose subtitles have not been uploaded.
          if(kind==="subtitle"&&String(data.code)==="10002"&&data.msg==="未查询到语音数据"&&Number(data.total)===0&&Array.isArray(data.list)&&data.list.length===0) return {data:{code:0,list:[]}};
          if(data.code!==undefined&&![0,200,"0","200"].includes(data.code)) return {error:"学校接口未授权或数据暂不可用，请在当前入口重新登录"};
          return {data};
        } catch {return {error:"学校接口请求失败，请检查登录或校园网络"};}
      },args:[url,context.origin,kind]});
    const result=results?.[0]?.result;
    if(!result||result.error) throw new Error(result?.error||"课程页未响应");
    return result.data;
  },
  async inspect(tabId) {
    const context=await this.context(tabId);
    const info=(await this.get(context,"info"))?.data||{};
    const media=ScutStudy.mediaSources(info,context.origin);
    const cat=await this.get(context,"catalogue").then(ScutStudy.catalogue).catch(()=>[]);
    return {context,lesson:ScutStudy.lesson(info,context),status:String(info.sub_status),sources:media,catalogue:cat};
  }
};
