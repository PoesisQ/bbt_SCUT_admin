const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
function harness(body,{http=200}={}){
  const context={URL,AbortSignal,ScutSubtitleCore:require("./core.js"),location:{origin:"https://video.jw.scut.edu.cn"},
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
