const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");

function harness({paused=false,recorderError=false,subtitle={code:10002,msg:"未查询到语音数据",total:0,list:[]},infoError=false,journalError=false}={}) {
  const local={token:"unit-test-token"},session={},requests=[],recorder=[],listeners=[],contexts=[],documents=[];
  const id="a".repeat(32),sid="b".repeat(32),base=`chrome-extension://${id}/`;
  const event=()=>{const handlers=[];return {addListener(fn){handlers.push(fn);},async emit(...args){for(const fn of handlers)await fn(...args);}};};
  function storage(values){return {async get(key){if(typeof key==="string")return {[key]:values[key]};return {...key,...values};},async set(value){Object.assign(values,value);},async remove(key){delete values[key];},async setAccessLevel(){}};}
  const chrome={
    storage:{local:storage(local),session:storage(session)},
    runtime:{id,getURL:file=>base+file,getContexts:async()=>contexts,onStartup:event(),
      onMessage:{addListener(fn){listeners.push(fn);}},async sendMessage(m){recorder.push(m);return recorderError&&m.type==="START"?{ok:false,error:"capture denied"}:{ok:true,data:{pending:0}};}},
    tabs:{async get(tabId){return {id:tabId,active:true,windowId:1,url:"https://video.jw.scut.edu.cn/livingroom?course_id=81526&sub_id=686882"};},async sendMessage(){},onRemoved:event(),onUpdated:event()},
    windows:{async get(){return {focused:true};}},
    scripting:{async executeScript(options){if(options.files)return [];
      if(!options.args)return [{result:{currentTime:120,paused,rate:1}}];
      const url=options.args[0];let data;
      if(url.includes("catalogue"))data={result:{data:[{sub_id:"686882",sub_status:"6",start_at:1}]}};
      else if(url.includes("search-trans-result"))data=subtitle;
      else if(infoError)data={code:401};
      else data={code:0,data:{sub_status:"6",course_title:"测试课程",sub_title:"测试课时",content:{save_playback:{contents:"https://video.jw.scut.edu.cn/play/a.mp4"}}}};
      // Execute the actual isolated school GET function, so business codes exercise the real boundary.
      const page={URL,AbortSignal,location:{origin:"https://video.jw.scut.edu.cn"},fetch:async()=>({ok:true,json:async()=>data})};
      vm.createContext(page);page.args=options.args;
      return [{result:await vm.runInContext(`(${options.func.toString()})(...args)`,page)}];}},
    offscreen:{async createDocument(data){documents.push(data);contexts.push({});}},tabCapture:{async getMediaStreamId(){return "test-stream-id";}},
    action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},
    alarms:{async create(){},onAlarm:event()},webRequest:{onBeforeRequest:event()},permissions:{async contains(){return false;}}
  };
  const context={chrome,URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout,crypto:require("node:crypto").webcrypto,
    async fetch(url,options){
      requests.push({url,...options});
      if(journalError&&url.endsWith("/api/imports"))throw Error("本地服务未连接");
      return {ok:true,async json(){return url.endsWith("/api/sessions")?{id:sid,...JSON.parse(options.body)}:{ok:true};}};
    }
  };
  vm.createContext(context);
  context.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,file),"utf8"),context);};
  vm.runInContext(fs.readFileSync(path.join(__dirname,"background.js"),"utf8"),context);
  async function send(message,{content=false,url}={}){return new Promise(resolve=>{const handled=listeners[0](message,{id,url:url||(content?"https://video.jw.scut.edu.cn/livingroom?course_id=81526&sub_id=686882":base+"study-popup.html"),...(content?{tab:{id:7,url:"https://video.jw.scut.edu.cn/livingroom?course_id=81526&sub_id=686882"}}:{})},resolve);if(!handled)resolve(null);});}
  return {send,requests,session,local,recorder,context,sid,documents};
}
test("school content scripts cannot start capture or retrieve the local pairing token",async()=>{
  const h=harness();assert.equal(await h.send({type:"GET_CONNECTION"},{content:true}),null);
  assert.equal(await h.send({type:"START_CAPTURE",tabId:7},{content:true}),null);assert.equal(h.requests.length,0);
});

test("automatic school entry stays in-page even after repeated ready messages, and respects opt-out",async()=>{
  const h=harness();let opens=0;h.context.chrome.action.openPopup=async()=>{opens++;};
  const result=await h.send({type:"PAGE_ASSISTANT_READY"},{content:true});
  assert.equal(result.ok,true,result.error);assert.equal(result.data.popupOpened,false);assert.equal(result.data.expandOnLoad,true);assert.equal(opens,0);
  for(let i=0;i<20;i++)await h.send({type:"PAGE_ASSISTANT_READY"},{content:true});assert.equal(opens,0);
  await h.send({type:"SET_SITE_ENTRY_PREF",enabled:false},{content:true});
  assert.equal((await h.send({type:"PAGE_ASSISTANT_READY"},{content:true})).data.autoOpen,false);
  assert.equal(h.documents.length,0);assert.equal(h.recorder.length,0);
  assert.equal(await h.send({type:"OPEN_NOTEBOOK"},{content:true,url:"https://evil.example"}),null);
});

test("older browsers and inactive tabs retain a page entry without stealing focus",async()=>{
  const h=harness();let result=await h.send({type:"PAGE_ASSISTANT_READY"},{content:true});
  assert.equal(result.ok,true,result.error);assert.equal(result.data.popupOpened,false);
  h.context.chrome.action.openPopup=async()=>{throw Error("must not open");};
  h.context.chrome.tabs.get=async id=>({id,windowId:2,active:false});
  result=await h.send({type:"PAGE_ASSISTANT_READY"},{content:true});
  assert.equal(result.data.popupOpened,false);assert.equal(result.data.expandOnLoad,false);assert.equal(h.recorder.length,0);
});
test("capture lifetime is in offscreen and persistent session storage, independent of the popup",async()=>{
  const h=harness();const result=await h.send({type:"START_CAPTURE",tabId:7,analysis:false});
  assert.equal(result.ok,true,result.error);assert.equal(h.session.activeCapture.sid,h.sid);
  assert.equal(h.recorder.at(-1).type,"START");assert.equal(h.recorder.at(-1).streamId,"test-stream-id");
  assert.equal(h.requests.filter(r=>r.url.endsWith("/api/sessions")).length,1);
  const second=await h.send({type:"START_CAPTURE",tabId:7});assert.equal(second.ok,false);
});

test('opening an idle control panel only reads status and never creates an audio background',async()=>{
  const h=harness();
  for(let n=0;n<3;n++){const result=await h.send({type:'RECORDER_STATE'});assert.equal(result.ok,true);assert.equal(result.data.recording,false);}
  assert.equal(h.documents.length,0);assert.equal(h.recorder.length,0);assert.equal(h.requests.length,0);
});

test('reopening panels and closing a classroom window preserve the original capture',async()=>{
  const h=harness();await h.send({type:'START_CAPTURE',tabId:7,analysis:true});
  const original=h.session.activeCapture.sid;
  await h.send({type:'RECORDER_STATE'});await h.send({type:'RECORDER_STATE'});
  await h.context.chrome.tabs.onRemoved.emit(88);
  assert.equal(h.session.activeCapture.sid,original);
  assert.equal(h.recorder.filter(m=>m.type==='START').length,1);
  assert.equal(h.recorder.filter(m=>m.type==='STOP').length,0);
  assert.equal(h.documents.length,1);
  // Closing the actual source course tab is different: that must flush and stop.
  await h.context.chrome.tabs.onRemoved.emit(7);
  assert.equal(h.recorder.filter(m=>m.type==='STOP').length,1);
});
test("paused playback cannot create a misleading recording and failed capture is cancelled",async()=>{
  const paused=harness({paused:true});assert.equal((await paused.send({type:"START_CAPTURE",tabId:7})).ok,false);assert.equal(paused.requests.length,0);
  const failed=harness({recorderError:true});assert.equal((await failed.send({type:"START_CAPTURE",tabId:7})).ok,false);
  assert.ok(failed.requests.some(r=>r.url.endsWith("/cancel")));assert.equal(failed.session.activeCapture,undefined);
});

test("capture permission after auto-open gives an actionable toolbar instruction without creating a session",async()=>{
  const h=harness();h.context.chrome.tabCapture.getMediaStreamId=async()=>{throw Error("Extension has not been invoked (activeTab permission)");};
  const result=await h.send({type:"START_CAPTURE",tabId:7});
  assert.equal(result.ok,false);assert.match(result.error,/工具栏/);
  assert.equal(h.requests.filter(r=>r.url.endsWith("/api/sessions")).length,0);
  assert.equal(h.recorder.filter(r=>r.type==="START").length,0);
});
test("batch import persists completed entries and passes replay source only to the local service",async()=>{
  const h=harness();const result=await h.send({type:"START_BATCH",tabId:7,subIds:["686882"],analysis:false,forceAsr:true});assert.equal(result.ok,true);
  for(let i=0;i<30&&h.local.batch.items[0].status==="pending";i++)await new Promise(r=>setTimeout(r,2));
  assert.equal(h.local.batch.items[0].status,"queued");
  const create=h.requests.find(r=>r.url.endsWith("/api/sessions"));const body=JSON.parse(create.body);
  assert.equal(body.mode,"replay");assert.equal(body.source_url,"https://video.jw.scut.edu.cn/play/a.mp4");
  assert.equal(body.sub_id,"686882");assert.ok(body.request_id);
});

test("only an explicit open action opens the browser popup",async()=>{
 const h=harness();let opens=0;h.context.chrome.action.openPopup=async()=>{opens++;};
 const result=await h.send({type:"OPEN_ASSISTANT"},{content:true});
 assert.equal(result.ok,true);assert.equal(opens,1);assert.equal(h.documents.length,0);
});

async function finishBatch(h){for(let i=0;i<80&&h.local.batch.items.some(i=>i.status==="pending");i++)await new Promise(r=>setTimeout(r,2));await new Promise(r=>setTimeout(r,5));}
test("unpublished subtitles fall back to local replay ASR with a durable hand-off",async()=>{
  const h=harness();const response=await h.send({type:"START_BATCH",tabId:7,subIds:["686882"],analysis:false});assert.equal(response.ok,true,response.error);
  await finishBatch(h);assert.equal(h.local.batch.items[0].status,"queued");
  assert.equal(JSON.parse(h.requests.find(r=>r.url.endsWith("/api/sessions")).body).mode,"replay");
  const journal=h.requests.filter(r=>r.url.endsWith("/api/imports")).map(r=>JSON.parse(r.body).items[0]);
  assert.equal(journal[0].status,"pending");assert.equal(journal.at(-1).status,"queued");assert.equal(journal.at(-1).sid,h.sid);assert.equal(journal.at(-1).title,"测试课时");
  assert.ok(h.requests.findIndex(r=>r.url.endsWith("/api/imports"))<h.requests.findIndex(r=>r.url.endsWith("/api/sessions")));
});
test("real school errors stay failed and visible when another batch starts",async()=>{
  const h=harness({infoError:true});await h.send({type:"START_BATCH",tabId:7,subIds:["686882"]});await finishBatch(h);
  const old=h.local.batch.id;assert.equal(h.local.batch.items[0].status,"failed");
  assert.equal(h.requests.filter(r=>r.url.endsWith("/api/sessions")).length,0);
  await h.send({type:"START_BATCH",tabId:7,subIds:["686842"]});await finishBatch(h);
  const saved=h.requests.filter(r=>r.url.endsWith("/api/imports")).flatMap(r=>JSON.parse(r.body).items);
  assert.ok(saved.some(i=>i.request_id===old+"-686882"&&i.status==="failed"&&i.error.includes("未授权")));
});
test("a failed local journal write never reports queue success",async()=>{
  const h=harness({journalError:true});const result=await h.send({type:"START_BATCH",tabId:7,subIds:["686882"]});
  assert.equal(result.ok,false);assert.equal(h.local.batch,undefined);assert.equal(h.requests.filter(r=>r.url.endsWith("/api/sessions")).length,0);
});

test("published subtitles are imported directly, without replay ASR",async()=>{
  const h=harness({subtitle:{code:0,list:[{BeginSec:1,EndSec:4,Text:"这一节介绍进程。"}]}});
  await h.send({type:"START_BATCH",tabId:7,subIds:["686882"]});await finishBatch(h);
  const body=JSON.parse(h.requests.find(r=>r.url.endsWith("/api/sessions")).body);
  assert.equal(body.mode,"subtitle");assert.equal(body.source_url,undefined);
  assert.equal(JSON.parse(h.requests.find(r=>r.url.endsWith("/subtitles")).body).items.length,1);
  assert.equal(h.local.batch.items[0].status,"queued");
});
