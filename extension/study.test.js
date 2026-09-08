const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const S=require("./study-core.js");
test("real school replay/live schema selects teacher audio and rejects executable URLs",()=>{
  const sources=S.mediaSources({live_url:{output:{m3u8:"https://video.jw.scut.edu.cn/live/a.m3u8?auth=x",m3u8_audio:"https://video.jw.scut.edu.cn/live/a_audio.m3u8"}},content:{save_playback:{contents:"https://video.jw.scut.edu.cn/play/a.mp4",other:"javascript:alert(1)"}},video_list:{0:{type:"4",preview_url:"https://video.jw.scut.edu.cn/student.mp4"}}},"https://video.jw.scut.edu.cn");
  assert.equal(sources[0].audio,true);assert.equal(sources.length,3);assert.equal(sources.filter(s=>s.kind==="replay").length,1);
});
test("catalogue is chronological and future/generating lessons are not replay jobs",()=>{
  const rows=S.catalogue({result:{data:[{sub_id:"2",sub_title:"second",start_at:"20",sub_status:2},{sub_id:"1",start_at:"10",sub_status:6},{sub_id:"../bad"}]}});
  assert.deepEqual(rows.map(s=>s.sub_id),["1","2"]);assert.ok(S.replayEligible(rows[0]));assert.ok(!S.replayEligible(rows[1]));assert.ok(!S.replayEligible({status:"3"}));
});
test("WAV output contains real independently decodable PCM headers and clipping",()=>{
  const buffer=S.wav(new Float32Array([-2,0,.5,2]));const data=new DataView(buffer);
  assert.equal(buffer.byteLength,52);assert.equal(data.getUint32(24,true),16000);assert.equal(data.getInt16(44,true),-32768);assert.equal(data.getInt16(50,true),32767);
});
test("audio worklet keeps overlap, handles arbitrary render blocks and flushes the final tail exactly once",()=>{
  let Processor;const messages=[];
  const context={sampleRate:16000,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(name,cls)=>Processor=cls};
  vm.runInNewContext(fs.readFileSync(require.resolve("./pcm-worklet.js"),"utf8"),context);
  const p=new Processor();
  for(let i=0;i<1250;i++)p.process([[new Float32Array(128).fill(.25)]]);
  p.port.onmessage({data:"flush"});
  const chunks=messages.filter(m=>m.pcm);assert.equal(chunks.length,2);assert.equal(chunks[0].pcm.length,128000);assert.equal(chunks[1].start,7);assert.equal(chunks[1].pcm.length,48000);
  p.port.onmessage({data:"flush"});assert.equal(messages.filter(m=>m.pcm).length,2);
});
