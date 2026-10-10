const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness(){
  const context={indexedDB:{open:()=>({})},setInterval(){},chrome:{runtime:{onMessage:{addListener(){}}}},Promise,Map};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'offscreen.js'),'utf8'),context);
  context.db=async()=>[{id:'older:0',sid:'older'},{id:'older:1',sid:'older'}];
  vm.runInContext(`recorders.set('older',{capture:{sid:'older',tabId:7},media:null,stopping:true,lastError:''})`,context);
  return context;
}
test('another lesson upload backlog cannot disable a new course tab',async()=>{
  const h=harness(),state=await vm.runInContext('state({tabId:8})',h);
  assert.equal(state.recording,false);assert.equal(state.sid,null);assert.equal(state.pending,0);
});
test('the originating lesson still reports its own upload backlog',async()=>{
  const h=harness(),state=await vm.runInContext('state({tabId:7})',h);
  assert.equal(state.pending,2);assert.equal(state.sid,'older');
});
