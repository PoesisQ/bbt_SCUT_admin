const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness(){
 const nodes=[],requests=[];let tick;
 function element(tag){const children=new Map();const n={tag,hidden:false,attributes:{},textContent:'',append(){},attachShadow(){return element('shadow');},setAttribute(k,v){this.attributes[k]=v;},querySelector(k){if(!children.has(k))children.set(k,element(k));return children.get(k);},querySelectorAll(){return [];}};nodes.push(n);return n;}
 const context={URL,URLSearchParams,location:{href:'https://video.jw.scut.edu.cn/livingroom?course_id=1&sub_id=1'},document:{createElement:element,documentElement:element('html')},setInterval(fn){tick=fn;},chrome:{runtime:{sendMessage(m){return new Promise(resolve=>requests.push({m,resolve}));}}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'site-entry.js'),'utf8'),context);
 const panel=nodes.find(n=>n.tag==='section'),dock=nodes.find(n=>n.className==='dock');
 const answer=(i,course='课程')=>requests[i].resolve({ok:true,data:{course,connected:true,autoOpen:true,expandOnLoad:true,recording:false}});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 return {context,panel,dock,requests,answer,flush,tick:()=>tick()};
}
test('the entry stays hidden until ready and manual collapse survives course navigation',async()=>{
 const h=harness();assert.equal(h.panel.hidden,true);assert.equal(h.dock.hidden,true);
 h.answer(0);await h.flush();assert.equal(h.panel.hidden,false);
 h.panel.querySelector('.close').onclick();assert.equal(h.panel.hidden,true);
 h.context.location.href='https://video.jw.scut.edu.cn/livingroom?course_id=1&sub_id=2';h.tick();h.answer(1);await h.flush();
 assert.equal(h.panel.hidden,true);assert.equal(h.dock.hidden,false);
 h.dock.onclick();assert.equal(h.panel.hidden,false);
});
test('hash and unrelated query updates do not retrigger automatic entry',async()=>{
 const h=harness();h.answer(0);await h.flush();
 for(let i=0;i<20;i++){h.context.location.href='https://video.jw.scut.edu.cn/livingroom?course_id=1&sub_id=1&time='+i+'#'+i;h.tick();}
 await h.flush();assert.equal(h.requests.length,1);
});
test('a late response cannot reopen a manually collapsed entry or replace a newer course',async()=>{
 const h=harness();h.panel.querySelector('.close').onclick();h.answer(0);await h.flush();assert.equal(h.panel.hidden,true);
 h.context.location.href='https://video.jw.scut.edu.cn/livingroom?course_id=1&sub_id=2';h.tick();
 h.context.location.href='https://video.jw.scut.edu.cn/livingroom?course_id=1&sub_id=3';h.tick();
 h.answer(2,'最新课程');await h.flush();h.answer(1,'旧课程');await h.flush();
 assert.equal(h.panel.querySelector('h3').textContent,'最新课程');assert.equal(h.panel.hidden,true);
});
