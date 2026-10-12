const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function settle(){for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}
function harness(){
  const nodes=new Map(),sent=[],url='https://video.jw.scut.edu.cn/livingroom?course_id=123&sub_id=456';
  const tabs=new Map([[7,{id:7,title:'元宇宙',url}]]);
  function element(id=''){
    return {id,value:'',textContent:'',children:[],hidden:false,disabled:false,checked:false,open:false,dataset:{},classList:{toggle(){},add(){}},
      append(...values){this.children.push(...values);},replaceChildren(...values){this.children=values;},setAttribute(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},
      querySelectorAll(selector){const all=[];const visit=e=>{if(e.type==='checkbox'&&(selector==='input:checked'?e.checked:!e.disabled))all.push(e);for(const child of e.children||[])visit(child);};visit(this);return all;}};
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);};
  const event=()=>({handlers:[],addListener(fn){this.handlers.push(fn);},async emit(...args){for(const fn of this.handlers)await fn(...args);await settle();}});
  const events={onRemoved:event(),onUpdated:event(),onCreated:event()};let inspect;
  const context={URL,URLSearchParams,Option:function(text,value){this.textContent=text;this.value=String(value);},setInterval(){},
    location:{search:'',hash:'',href:'chrome-extension://'+'a'.repeat(32)+'/dashboard.html'},history:{replaceState(){}},window:{addEventListener(){},scrollTo(){}},
    document:{getElementById:node,querySelector:node,querySelectorAll:()=>[],createElement:()=>element()},
    CourseLibrary:require('./library-core.js'),AssistantUI:{toast(){}},
    chrome:{runtime:{id:'a'.repeat(32)},tabs:{...events,query:async()=>[...tabs.values()]}},
    AssistantClient:{async api(route){return route==='/api/settings'?{deepseek_configured:true}:[];},async send(type,message){
      sent.push({type,...message});if(type==='BATCH_STATE')return null;
      if(type==='INSPECT'){if(inspect)return inspect(message);const tab=tabs.get(message.tabId);return {context:{url:tab.url,tabId:tab.id,origin:new URL(tab.url).origin,courseId:new URL(tab.url).searchParams.get('course_id'),subId:'456',tenantCode:'21'},lesson:{course_title:tab.title},catalogue:[{sub_id:'456',title:'第一节',status:'6'}]};}
      return {};
    }}
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'dashboard.js'),'utf8'),context);
  return {node,tabs,sent,url,events,ready:settle,inspect(fn){inspect=fn;}};
}

test('import selector refreshes after a tab is reopened and the catalogue remains tied to its course',async()=>{
  const h=harness();await h.ready();h.node('open-import').onclick();await settle();
  h.tabs.delete(7);h.tabs.set(8,{id:8,title:'元宇宙',url:h.url});await h.events.onRemoved.emit(7);
  assert.equal(h.node('source-tab').value,'8');await h.node('load-catalogue').onclick();
  assert.equal(h.node('catalogue').querySelectorAll('input:checked').length,1);
  h.tabs.delete(8);h.tabs.set(9,{id:9,title:'元宇宙',url:h.url});await h.events.onCreated.emit(h.tabs.get(9));
  assert.equal(h.node('source-tab').value,'9');await h.node('start-batch').onclick();
  const request=h.sent.find(m=>m.type==='START_BATCH');assert.equal(request.context.courseId,'123');assert.equal(request.context.url,h.url);assert.deepEqual(Array.from(request.subIds),['456']);
});

test('navigating the source to another course requires an explicit choice and clears the old catalogue',async()=>{
  const h=harness();await h.ready();h.node('open-import').onclick();await settle();await h.node('load-catalogue').onclick();
  h.tabs.set(7,{id:7,title:'另一门课',url:h.url.replace('course_id=123','course_id=999')});await h.events.onUpdated.emit(7,{url:h.tabs.get(7).url});
  assert.equal(h.node('source-tab').value,'');assert.match(h.node('batch-hint').textContent,/同一门课/);
  h.node('source-tab').value='7';h.node('source-tab').onchange();assert.equal(h.node('catalogue').children.length,0);assert.equal(h.node('start-batch').disabled,true);
  await h.node('start-batch').onclick();assert.equal(h.sent.some(m=>m.type==='START_BATCH'),false);assert.equal(h.node('start-batch').disabled,true);
});

test('a late catalogue response cannot replace a newly selected course',async()=>{
  const h=harness();await h.ready();let resolve;h.inspect(()=>new Promise(r=>{resolve=r;}));
  const reading=h.node('load-catalogue').onclick();await settle();
  h.tabs.set(8,{id:8,title:'另一门课',url:h.url.replace('course_id=123','course_id=999')});
  h.node('source-tab').value='8';h.node('source-tab').onchange();
  resolve({context:{url:h.url,tabId:7,courseId:'123'},lesson:{course_title:'旧课程'},catalogue:[{sub_id:'456',status:'6'}]});await reading;
  assert.equal(h.node('catalogue').children.length,0);assert.equal(h.node('start-batch').disabled,true);assert.notEqual(h.node('batch-hint').textContent,'旧课程');
});
