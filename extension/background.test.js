const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");

function harness({paused=false,recorderError=false}={}) {
  const local={token:"unit-test-token"},session={},requests=[],recorder=[],listeners=[],contexts=[],documents=[];
  const id="a".repeat(32),sid="b".repeat(32),base=`chrome-extension://${id}/`;
  const event=()=>{const handlers=[];return {addListener(fn){handlers.push(fn);},async emit(...args){for(const fn of handlers)await fn(...args);}};};
  function storage(values){return {async get(key){if(typeof key==="string")return {[key]:values[key]};return {...key,...values};},async set(value){Object.assign(values,value);},async remove(key){delete values[key];},async setAccessLevel(){}};}
  const chrome={
    storage:{local:storage(local),session:storage(session)},
    runtime:{id,getURL:file=>base+file,getContexts:async()=>contexts,onStartup:event(),
      onMessage:{addListener(fn){listeners.push(fn);}},async sendMessage(m){recorder.push(m);return recorderError&&m.type==="START"?{ok:false,error:"capture denied"}:{ok:true,data:{pending:0}};}},
    tabs:{async get(tabId){return {id:tabId,url:"https://video.jw.scut.edu.cn/livingroom?course_id=81526&sub_id=686882"};},async sendMessage(){},onRemoved:event(),onUpdated:event()},
    scripting:{async executeScript(options){if(options.files)return [];
      if(!options.args)return [{result:{currentTime:120,paused,rate:1}}];
      const url=options.args[0];let data;
      if(url.includes("catalogue"))data={result:{data:[{sub_id:"686882",sub_status:"6",start_at:1}]}};
      else if(url.includes("search-trans-result"))data={code:0,list:[]};
      else data={code:0,data:{sub_status:"6",course_title:"测试课程",sub_title:"测试课时",content:{save_playback:{contents:"https://video.jw.scut.edu.cn/play/a.mp4"}}}};
      return [{result:{data}}];}},
    offscreen:{async createDocument(data){documents.push(data);contexts.push({});}},tabCapture:{async getMediaStreamId(){return "test-stream-id";}},
    action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},
    alarms:{async create(){},onAlarm:event()},webRequest:{onBeforeRequest:event()},permissions:{async contains(){return false;}}
  };
  const context={chrome,URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout,crypto:require("node:crypto").webcrypto,
    async fetch(url,options){
      requests.push({url,...options});
      return {ok:true,async json(){return url.endsWith("/api/sessions")?{id:sid,...JSON.parse(options.body)}:{ok:true};}};
    }
  };
  vm.createContext(context);
  context.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,file),"utf8"),context);};
  vm.runInContext(fs.readFileSync(path.join(__dirname,"background.js"),"utf8"),context);
  async function send(message,{content=false}={}){return new Promise(resolve=>{const handled=listeners[0](message,{id,url:content?"https://video.jw.scut.edu.cn/livingroom?course_id=81526&sub_id=686882":base+"study-popup.html",...(content?{tab:{id:7}}:{})},resolve);if(!handled)resolve(null);});}
  return {send,requests,session,local,recorder,context,sid,documents};
}
test("school content scripts cannot start capture or retrieve the local pairing token",async()=>{
  const h=harness();assert.equal(await h.send({type:"GET_CONNECTION"},{content:true}),null);
  assert.equal(await h.send({type:"START_CAPTURE",tabId:7},{content:true}),null);assert.equal(h.requests.length,0);
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
test("batch import persists completed entries and passes replay source only to the local service",async()=>{
  const h=harness();const result=await h.send({type:"START_BATCH",tabId:7,subIds:["686882"],analysis:false,forceAsr:true});assert.equal(result.ok,true);
  for(let i=0;i<30&&h.local.batch.items[0].status==="pending";i++)await new Promise(r=>setTimeout(r,2));
  assert.equal(h.local.batch.items[0].status,"queued");
  const create=h.requests.find(r=>r.url.endsWith("/api/sessions"));const body=JSON.parse(create.body);
  assert.equal(body.mode,"replay");assert.equal(body.source_url,"https://video.jw.scut.edu.cn/play/a.mp4");
  assert.equal(body.sub_id,"686882");assert.ok(body.request_id);
});
