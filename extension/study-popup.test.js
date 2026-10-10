const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
async function settle(){for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}
function harness({schoolFailsOnce=false,missingToken=false,recorderFailsOnce=false}={}){
  const nodes=new Map(),timers=[];let now=10000,inspections=0,states=0,launches=0,paired=!missingToken;
  function element(id){if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',checked:false,hidden:false,disabled:true,dataset:{},parentElement:{dataset:{}},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},replaceChildren(){}});return nodes.get(id);}
  const tab={id:7,url:'https://video.jw.scut.edu.cn/livingroom?course_id=1&sub_id=2'};
  const inspection={status:'1',context:{url:tab.url},lesson:{course_id:'1',sub_id:'2',course_title:'Test Course',title:'Test Lesson'}};
  const context={URLSearchParams,Option:function(text,value){this.text=text;this.value=value;},Date:class extends Date{static now(){return now;}},
    location:{search:''},document:{getElementById:element,body:{dataset:{},classList:{toggle(){}}}},
    PopupState:require('./popup-state.js'),SessionView:{analysisEnabled:()=>true,paint(){}},
    setInterval(fn){timers.push(fn);},
    chrome:{runtime:{id:'a'.repeat(32)},tabs:{get:async()=>tab,query:async()=>[tab]},storage:{local:{get:async defaults=>defaults,set:async()=>{}}}},
    AssistantClient:{async api(route){if(!paired){const e=Error('连接口令不匹配');e.status=401;throw e;}if(route==='/api/settings')return {deepseek_configured:true};if(route==='/api/imports')return [];throw Error('unexpected '+route);},
      async send(type){if(type==='INSPECT'){inspections++;if(schoolFailsOnce&&inspections===1)throw Error('学校接口暂时不可用');return inspection;}if(type==='RECORDER_STATE'){states++;if(recorderFailsOnce&&states===1)throw Error('音频后台暂时无响应');return {recording:false,pending:0};}throw Error('unexpected '+type);},
      async startLocalService(){launches++;paired=true;return {connected:true};}}
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'study-popup.js'),'utf8'),context);
  return {element,async ready(){await settle();},async tick(){now+=6000;for(const fn of timers)fn();await settle();},counts:()=>({inspections,states,launches})};
}
test('failed initial school inspection is retried and the real start control recovers',async()=>{
  const h=harness({schoolFailsOnce:true});await h.ready();assert.equal(h.element('start').disabled,true);
  await h.tick();assert.equal(h.counts().inspections,2);assert.equal(h.element('start').disabled,false);assert.equal(h.element('course').textContent,'Test Course');
});
test('opening an unpaired panel restores the connection through one native launch',async()=>{
  const h=harness({missingToken:true});await h.ready();assert.equal(h.counts().launches,1);assert.equal(h.element('start').disabled,false);assert.equal(h.element('connection').textContent,'本地已连接');
});
test('transient recorder status failure has a reason and recovers on the next poll',async()=>{
  const h=harness({recorderFailsOnce:true});await h.ready();assert.equal(h.element('start').disabled,true);assert.match(h.element('action-hint').textContent,/录音状态/);
  await h.tick();assert.equal(h.element('start').disabled,false);
});
