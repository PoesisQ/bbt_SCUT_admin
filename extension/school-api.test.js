const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
function harness(body,{http=200}={}){
  const context={URL,AbortSignal,ScutSubtitleCore:require("./core.js"),location:{origin:"https://video.jw.scut.edu.cn",href:"https://video.jw.scut.edu.cn/livingroom?course_id=123&sub_id=456"},
    fetch:async()=>({ok:http===200,status:http,json:async()=>body}),
    chrome:{tabs:{get:async()=>({url:"https://video.jw.scut.edu.cn/livingroom?course_id=123&sub_id=456"})},scripting:{executeScript:async options=>[{result:await options.func(...options.args)}]}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,"school-api.js"),"utf8"),context);
  return async(kind="subtitle")=>context.SchoolAPI.get(await context.SchoolAPI.context(1),kind);
}
const missing={code:10002,msg:"未查询到语音数据",total:0,list:[]};
test("unpublished school subtitles are an empty result, including string business codes",async()=>{
  for(const code of [10002,"10002"]){const result=await harness({...missing,code})();assert.equal(result.list.length,0);assert.equal(result.code,0);}
});
test("no-data exception is restricted to the subtitle endpoint and exact empty response",async()=>{
  await assert.rejects(harness(missing)("info"),/未授权/);
  await assert.rejects(harness(missing)("catalogue"),/未授权/);
  for(const body of [{...missing,msg:"未登录"},{...missing,list:[{}]},{...missing,total:1},{...missing,code:401}])await assert.rejects(harness(body)(),/未授权/);
  await assert.rejects(harness(missing,{http:403})(),/HTTP 403/);
});
test("published school subtitles remain intact",async()=>{
  const body={code:0,list:[{BeginSec:0,EndSec:3,Text:"有上下文的字幕"}]};assert.deepEqual(await harness(body)(),body);
});

function movingTabs(){
  const original={id:7,url:"https://video.jw.scut.edu.cn/livingroom?course_id=123&sub_id=456"},tabs=new Map([[7,original]]),executed=[],fetched=[];
  let beforeExecute=()=>{};
  const sandbox={URL,AbortSignal,ScutSubtitleCore:require("./core.js"),chrome:{tabs:{
    async get(id){if(!tabs.has(id))throw Error("No tab with id: "+id);return tabs.get(id);},async query(){return [...tabs.values()];}},
    scripting:{async executeScript(options){beforeExecute(options);executed.push(options.target.tabId);const tab=tabs.get(options.target.tabId);if(!tab)throw Error("No tab with id: "+options.target.tabId);
      const page={URL,AbortSignal,location:{origin:new URL(tab.url).origin,href:tab.url},fetch:async url=>{fetched.push(url);return {ok:true,json:async()=>({code:0,list:[]})};},args:options.args};
      vm.createContext(page);return [{result:await vm.runInContext(`(${options.func.toString()})(...args)`,page)}];}}}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,"school-api.js"),"utf8"),sandbox);
  return {api:sandbox.SchoolAPI,tabs,executed,fetched,original,before(fn){beforeExecute=fn;}};
}

test("reopened school tabs are rebound to the original course and subtitle ID",async()=>{
  const h=movingTabs(),saved=await h.api.context(7);h.tabs.delete(7);
  h.tabs.set(8,{id:8,active:true,url:h.original.url.replace("course_id=123","course_id=999")});
  h.tabs.set(9,{id:9,url:h.original.url.replace("video.jw.scut.edu.cn","video-jw-443.webvpn.scut.edu.cn")});
  h.tabs.set(10,{id:10,url:h.original.url+"&tenant_code=99"});
  h.tabs.set(11,{id:11,url:h.original.url.replace("sub_id=456","sub_id=789")});
  await h.api.get(saved,"subtitle");assert.deepEqual(h.executed,[11]);assert.match(h.fetched[0],/456/);
});

test("a course switch cannot silently import another course or school entry",async()=>{
  const h=movingTabs(),saved=await h.api.context(7);h.tabs.set(7,{id:7,url:h.original.url.replace("course_id=123","course_id=999")});
  h.tabs.set(8,{id:8,url:h.original.url.replace("video.jw.scut.edu.cn","video-jw-443.webvpn.scut.edu.cn")});
  await assert.rejects(h.api.get(saved,"subtitle"),/同一门课/);assert.equal(h.executed.length,0);
  h.tabs.clear();await assert.rejects(h.api.context(7),error=>!error.message.includes("No tab")&&error.message.includes("重新选择"));
});

test("a tab closed between validation and script execution gets one safe rebind",async()=>{
  const h=movingTabs(),saved=await h.api.context(7);let once=false;
  h.before(()=>{if(!once){once=true;h.tabs.delete(7);h.tabs.set(8,{...h.original,id:8});}});
  await h.api.get(saved,"subtitle");assert.deepEqual(h.executed,[7,8]);assert.equal(h.fetched.length,1);
});

test("navigation between validation and injection is rejected before a school request",async()=>{
  const h=movingTabs(),saved=await h.api.context(7);
  h.before(()=>h.tabs.set(7,{id:7,url:h.original.url.replace("course_id=123","course_id=999")}));
  await assert.rejects(h.api.get(saved,"subtitle"),/课程页面已切换/);assert.equal(h.fetched.length,0);
});
