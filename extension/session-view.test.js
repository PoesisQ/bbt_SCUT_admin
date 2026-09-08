const test=require('node:test'),assert=require('node:assert/strict');
require('./session-view.js');const V=globalThis.SessionView;
test('analysis defaults on but saved opt-out and actual running session take precedence',()=>{
  assert.equal(V.analysisEnabled({},null),true);
  assert.equal(V.analysisEnabled({analysisDefault:false},null),false);
  assert.equal(V.analysisEnabled({analysisDefault:false},{analysis:true}),true);
  assert.equal(V.analysisEnabled({analysisDefault:true},{analysis:false}),false);
});
test('old pathological transcripts cannot flood a newly opened classroom view',()=>{
  assert.equal(V.clean({text:'网络'.repeat(100)}),'此段识别异常，建议按当前语言重新转写。');
  assert.equal(V.clean({text:'对对对，我们再说一遍。'}),'对对对，我们再说一遍。');
  assert.equal(V.time(372),'00:06:12');
});
test('reopening the classroom restores the existing minimized window without starting capture',async()=>{
  require('./client.js');const saved={},created=[],updated=[];
  globalThis.chrome={runtime:{getURL:p=>'chrome-extension://unit/'+p},storage:{session:{get:async()=>saved,set:async v=>Object.assign(saved,v)}},windows:{
    create:async data=>{created.push(data);return {id:8,tabs:[{id:18}]};},
    get:async()=>({id:8,type:'popup',state:'minimized',tabs:[{id:18}]}),
    update:async(...args)=>updated.push(args)
  }};
  await AssistantClient.openClassroom(7);await AssistantClient.openClassroom(7);
  assert.equal(created.length,1);assert.equal(created[0].type,'popup');
  assert.deepEqual(updated,[[8,{focused:true,state:'normal'}]]);
  delete globalThis.chrome;
});

test('opening saved lesson details links the exact session without capture messages',async()=>{
  require('./client.js');const created=[];const sid='c'.repeat(32);
  globalThis.chrome={runtime:{id:'test',getURL:p=>'chrome-extension://unit/'+p},tabs:{create:async value=>created.push(value)}};
  await AssistantClient.openDashboard(sid,7);
  assert.equal(created[0].url,`chrome-extension://unit/dashboard.html?session=${sid}&tab=7`);
  assert.equal(AssistantClient.dashboardURL('../settings',0),'dashboard.html');
  delete globalThis.chrome;
});
