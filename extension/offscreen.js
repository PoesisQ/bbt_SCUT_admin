let connection=null;
const recorders=new Map();
const dbPromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open("scut-audio",1);
  request.onupgradeneeded=()=>{request.result.createObjectStore("chunks",{keyPath:"id"});request.result.createObjectStore("meta",{keyPath:"id"});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
async function db(store,mode,action){
  const database=await dbPromise;
  return new Promise((resolve,reject)=>{const tx=database.transaction(store,mode),request=action(tx.objectStore(store));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
async function api(path,options={}){if(!connection?.token)throw new Error("本地服务连接尚未恢复");return AssistantClient.fetchWithToken(connection.token,path,options);}
function select(message={}){
  if(message.sid)return recorders.get(message.sid)||null;
  if(message.tabId!=null)return [...recorders.values()].find(r=>r.capture.tabId===message.tabId)||null;
  return recorders.values().next().value||null;
}
async function chunksFor(sid){return (await db("chunks","readonly",s=>s.getAll())).filter(chunk=>!sid||chunk.sid===sid);}
async function state(message={}){
  const recorder=select(message),pending=await chunksFor(recorder?.capture.sid||message.sid);
  return {recording:!!recorder?.media,stopping:!!recorder?.stopping,sid:recorder?.capture.sid||message.sid||null,
    tabId:recorder?.capture.tabId||message.tabId||null,pending:pending.length,error:recorder?.lastError||"",
    recordings:[...recorders.values()].map(r=>({sid:r.capture.sid,tabId:r.capture.tabId,recording:!!r.media,stopping:r.stopping}))};
}
function meta(recorder){return {id:`active:${recorder.capture.sid}`,...recorder.capture,offset:recorder.offset,last_seq:recorder.lastSeq,stopped:recorder.stopping,warning:recorder.stoppedWarning};}
async function start(message){
  const sid=message.capture.sid;
  if(recorders.has(sid)||[...recorders.values()].some(r=>r.capture.tabId===message.capture.tabId))throw new Error("这个课程标签页已经在录音");
  if((await chunksFor(sid)).length)throw new Error("这节课还有未上传音频，请先恢复上传");
  connection=message.connection;
  const recorder={capture:{...message.capture},offset:message.offset,lastSeq:-1,sequence:0,writing:Promise.resolve(),uploading:false,
    stopping:false,flushResolve:null,lastError:"",stoppedWarning:"",lastSession:message.session,media:null,audio:null,worklet:null};
  recorders.set(sid,recorder);await db("meta","readwrite",s=>s.put(meta(recorder)));
  try{
    recorder.media=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:"tab",chromeMediaSourceId:message.streamId}},video:false});
    recorder.audio=new AudioContext({sampleRate:16000});await recorder.audio.resume();
    if(recorder.audio.sampleRate!==16000)throw new Error("浏览器不支持 16kHz 音频上下文，请升级浏览器");
    const source=recorder.audio.createMediaStreamSource(recorder.media);source.connect(recorder.audio.destination);
    await recorder.audio.audioWorklet.addModule("pcm-worklet.js");
    recorder.worklet=new AudioWorkletNode(recorder.audio,"scut-pcm",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    if(recorder.capture.time_basis==="video"){
      const clock=await chrome.runtime.sendMessage({type:"PLAYER_CLOCK",tabId:recorder.capture.tabId});
      if(!clock?.ok||!clock.data||clock.data.paused||clock.data.rate!==1)throw new Error("请保持回放正在以 1 倍速播放");
      recorder.offset=clock.data.time;
    }
    const silent=recorder.audio.createGain();silent.gain.value=0;source.connect(recorder.worklet);recorder.worklet.connect(silent);silent.connect(recorder.audio.destination);
    recorder.worklet.port.onmessage=event=>{
      if(event.data.flushed){recorder.flushResolve?.();return;}
      const {pcm,start}=event.data,seq=recorder.sequence++;
      recorder.writing=recorder.writing.then(async()=>{
        await db("chunks","readwrite",s=>s.put({id:`${sid}:${String(seq).padStart(7,"0")}`,sid,seq,start:recorder.offset+start,wav:ScutStudy.wav(pcm)}));
        recorder.lastSeq=seq;await db("meta","readwrite",s=>s.put(meta(recorder)));
        if((await chunksFor(sid)).length>120&&!recorder.stopping)void stop(recorder,"本地连接长时间中断，录制已暂停；音频已暂存在浏览器，请恢复上传");
        void drain(recorder);
      }).catch(error=>{recorder.lastError="无法将音频写入浏览器缓存："+error.message;void stop(recorder,recorder.lastError);});
    };
    recorder.media.getAudioTracks()[0].addEventListener("ended",()=>{if(!recorder.stopping)void stop(recorder,"浏览器结束了音频捕获，正在保存剩余内容");});
    return state({sid});
  }catch(error){
    recorder.media?.getTracks().forEach(track=>track.stop());await recorder.audio?.close();recorders.delete(sid);
    await db("meta","readwrite",s=>s.delete(`active:${sid}`));throw error;
  }
}
async function stop(recorder,warning=""){
  if(!recorder||recorder.stopping)return state({sid:recorder?.capture.sid});
  recorder.stopping=true;recorder.stoppedWarning=warning;
  if(recorder.worklet&&recorder.audio?.state==="running")await new Promise(resolve=>{recorder.flushResolve=resolve;recorder.worklet.port.postMessage("flush");setTimeout(resolve,2000);});
  recorder.media?.getTracks().forEach(track=>track.stop());recorder.media=null;await recorder.audio?.close();recorder.audio=null;recorder.worklet=null;
  await recorder.writing;await db("meta","readwrite",s=>s.put(meta(recorder)));await drain(recorder);return state({sid:recorder.capture.sid});
}
async function drain(recorder){
  if(!recorder||recorder.uploading||!connection)return;recorder.uploading=true;
  try{
    for(const chunk of await chunksFor(recorder.capture.sid)){
      await api(`/api/sessions/${chunk.sid}/chunks?seq=${chunk.seq}&start=${chunk.start}`,{method:"POST",body:chunk.wav,raw:true});
      await db("chunks","readwrite",s=>s.delete(chunk.id));recorder.lastError="";
    }
    if(recorder.stopping&&!(await chunksFor(recorder.capture.sid)).length){
      const finalSession=await api(`/api/sessions/${recorder.capture.sid}/stop`,{method:"POST",body:{last_seq:recorder.lastSeq,warning:recorder.stoppedWarning}});
      await db("meta","readwrite",s=>s.delete(`active:${recorder.capture.sid}`));recorders.delete(recorder.capture.sid);
      await chrome.runtime.sendMessage({type:"RECORDER_FINISHED",session:finalSession});
    }
  }catch(error){recorder.lastError=error.message;}finally{recorder.uploading=false;}
}
async function recover(message){
  connection=message.connection;
  for(const item of await db("meta","readonly",s=>s.getAll())){
    if(!item.sid||recorders.has(item.sid))continue;
    const recorder={capture:{sid:item.sid,tabId:item.tabId,url:item.url,time_basis:item.time_basis},offset:item.offset||0,
      lastSeq:item.last_seq??-1,sequence:(item.last_seq??-1)+1,writing:Promise.resolve(),uploading:false,stopping:true,flushResolve:null,lastError:"",
      stoppedWarning:item.warning||"录制曾中断，已恢复上传浏览器缓存的音频",lastSession:null,media:null,audio:null,worklet:null};
    recorders.set(item.sid,recorder);
    if(item.id==="active"){await db("meta","readwrite",s=>s.delete("active"));await db("meta","readwrite",s=>s.put(meta(recorder)));}
    void drain(recorder);
  }
  for(const recorder of recorders.values())void drain(recorder);return state(message);
}
setInterval(()=>{for(const recorder of recorders.values())void drain(recorder);},4000);
setInterval(()=>{for(const recorder of recorders.values())void (async()=>{
  try{recorder.lastSession=await api(`/api/sessions/${recorder.capture.sid}`);await chrome.runtime.sendMessage({type:"RECORDER_UPDATE",session:recorder.lastSession,recorder:await state({sid:recorder.capture.sid})});}
  catch(error){recorder.lastError=error.message;if(recorder.lastSession)await chrome.runtime.sendMessage({type:"RECORDER_UPDATE",session:recorder.lastSession,recorder:await state({sid:recorder.capture.sid})}).catch(()=>{});}
})();},1500);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.target!=="offscreen"||sender.id!==chrome.runtime.id)return false;
  const action=message.type==="START"?()=>start(message):message.type==="STOP"?()=>stop(select(message),message.warning):message.type==="RECOVER"?()=>recover(message):()=>state(message);
  action().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));return true;
});
