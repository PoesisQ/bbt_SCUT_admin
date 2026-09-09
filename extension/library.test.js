const test=require("node:test"),assert=require("node:assert/strict"),L=require("./library-core.js");
const lesson={id:"a",course_id:"1",course_title:"课程",stopped:true,status:"complete",segment_count:1418,analysis_status:"failed",warning:"输出截断",summary:null};

test("school subtitles, local ASR and capture clips share one lesson card",()=>{
  const rows=L.lessons([{...lesson,sub_id:"2",id:"a",coverage_seconds:100},{...lesson,sub_id:"2",id:"b",coverage_seconds:200},{...lesson,sub_id:"3",id:"c"}]);
  assert.equal(rows.length,2);assert.equal(rows[0].id,"b");assert.equal(rows[0].record_count,2);assert.equal(rows[0].versions.length,2);
});

test("grouping preserves event links from every source and prefers full lecture coverage",()=>{
  const partial={...lesson,id:"p",sub_id:"2",time_basis:"video",coverage_seconds:30,analysis_status:"complete",summary:{headline:"局部片段"},important_events:[{start:1,category:"assignment",message:"作业要求"}]};
  const full={...lesson,id:"f",sub_id:"2",time_basis:"video",coverage_seconds:9000,important_events:[{start:5,category:"schedule",message:"下周安排"}]};
  const rows=L.lessons([partial,full]);assert.equal(rows[0].id,"f");
  const events=L.groups(rows)[0].events;assert.equal(events.length,2);assert.equal(events.find(e=>e.category==="assignment").sid,"p");
});

test("failed and pending imports appear without subtitles and survive unrelated batches",()=>{
  const imports=[{course_id:"1",sub_id:"10",status:"failed",created_at:1},{course_id:"1",sub_id:"11",status:"pending",created_at:2}];
  let rows=L.importRows(imports);assert.equal(rows.length,2);assert.ok(rows.every(L.pending));assert.equal(L.groups(rows)[0].lessons.length,2);
  rows=L.importRows([...imports,{course_id:"1",sub_id:"10",status:"queued",created_at:3}]);
  assert.equal(rows.length,1);assert.equal(rows[0].sub_id,"11");
  assert.equal(L.pending({...lesson,status:"downloading",segment_count:0}),true);
});
test("a failed replay with a saved key offers resume instead of configuring key",()=>{
  assert.equal(L.action(lesson,true).label,"继续生成笔记");
  assert.equal(L.action(lesson,false).settings,true);
  assert.equal(L.needsNotes(lesson),true);
});
test("completed audio and incomplete notes have independent states",()=>{
  const partial={...lesson,summary:{partial:true,topics:[]},analysis_status:"running",analysis_progress:"3/21"};
  assert.equal(L.hasNotes(partial),false);assert.equal(L.action(partial,true).disabled,true);
  const done={...partial,analysis_status:"complete",summary:{partial:false,topics:[]}};
  assert.equal(L.action(done,true).label,"整理完整事项");assert.equal(L.action({...done,events_version:1},true).hidden,true);assert.equal(L.needsNotes(done),false);
});
test("course overview groups actual topics and preserves event provenance",()=>{
  const s={...lesson,analysis_status:"complete",summary:{topics:[{title:"进程同步"},{title:"进程同步"}]},important_events:[{category:"assignment",message:"周五提交"}]};
  const grouped=L.groups([s,{...s,id:"b",course_id:"2",course_title:"第二门课"}]);
  assert.equal(grouped.length,2);assert.deepEqual(grouped[0].topics,["进程同步"]);
  assert.equal(grouped[0].events[0].sid,"a");assert.equal(grouped[0].ready,1);
});
