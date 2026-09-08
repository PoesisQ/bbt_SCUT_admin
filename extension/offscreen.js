let recording=null, connection=null, media=null, audio=null, worklet=null, sequence=0;
let writing=Promise.resolve(), uploading=false, stopping=false, flushResolve=null, lastError="";
let stoppedWarning="", lastSession=null;
const dbPromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open("scut-audio",1);
  request.onupgradeneeded=()=>{request.result.createObjectStore("chunks",{keyPath:"id"});request.result.createObjectStore("meta",{keyPath:"id"});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
async function db(store,mode,action) {
  const database=await dbPromise;
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(store,mode);const request=action(tx.objectStore(store));
    tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function api(path,options={}) {return AssistantClient.fetchWithToken(connection.token,path,options);}
async function state(){return {recording:!!media,stopping,sid:recording?.sid,pending:(await db("chunks","readonly",s=>s.getAll())).length,error:lastError};}
async function start(message) {
  if(media||recording||(await db("chunks","readonly",s=>s.getAll())).length) throw new Error("存在未完成录制或未上传音频，请先恢复上传");
  connection=message.connection;recording={...message.capture,offset:message.offset,last_seq:-1};sequence=0;stopping=false;lastError="";
  await db("meta","readwrite",s=>s.put({id:"active",...recording}));
  try {
    media=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:"tab",chromeMediaSourceId:message.streamId}},video:false});
    audio=new AudioContext({sampleRate:16000});await audio.resume();
    if(audio.sampleRate!==16000) throw new Error("浏览器不支持 16kHz 音频上下文，请升级浏览器");
    const source=audio.createMediaStreamSource(media);
    source.connect(audio.destination); // tabCapture otherwise silences the original tab.
    await audio.audioWorklet.addModule("pcm-worklet.js");
    worklet=new AudioWorkletNode(audio,"scut-pcm",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    if(recording.time_basis==="video") {
      const clock=await chrome.runtime.sendMessage({type:"PLAYER_CLOCK",tabId:recording.tabId});
      if(!clock?.ok||!clock.data||clock.data.paused||clock.data.rate!==1)throw new Error("请保持回放正在以 1 倍速播放");
      recording.offset=clock.data.time;
    }
    const silent=audio.createGain();silent.gain.value=0;source.connect(worklet);worklet.connect(silent);silent.connect(audio.destination);
    worklet.port.onmessage=event=>{
      if(event.data.flushed){flushResolve?.();return;}
      const {pcm,start}=event.data;const seq=sequence++;const snapshot={...recording};
      writing=writing.then(async()=>{
        await db("chunks","readwrite",s=>s.put({id:`${snapshot.sid}:${String(seq).padStart(7,"0")}`,sid:snapshot.sid,seq,start:snapshot.offset+start,wav:ScutStudy.wav(pcm)}));
        recording.last_seq=seq;
        await db("meta","readwrite",s=>s.put({id:"active",...recording}));
        const count=(await db("chunks","readonly",s=>s.getAll())).length;
        if(count>120&&!stopping) void stop("本地连接长时间中断，录制已暂停；音频已暂存在浏览器，请恢复上传");
        void drain();
      }).catch(e=>{lastError="无法将音频写入浏览器缓存："+e.message;void stop(lastError);});
    };
    media.getAudioTracks()[0].addEventListener("ended",()=>void stop("浏览器结束了音频捕获，正在保存剩余内容"));
    lastSession=message.session;
    return state();
  } catch(error) {
    media?.getTracks().forEach(t=>t.stop());await audio?.close();media=null;audio=null;recording=null;
    await db("meta","readwrite",s=>s.delete("active"));throw error;
  }
}
async function stop(warning="") {
  if(stopping) return state();
  if(!recording) return state();
  stopping=true;stoppedWarning=warning;
  if(worklet&&audio?.state==="running") {
    await new Promise(resolve=>{flushResolve=resolve;worklet.port.postMessage("flush");setTimeout(resolve,2000);});
  }
  media?.getTracks().forEach(t=>t.stop());media=null;
  await audio?.close();audio=null;worklet=null;
  await writing;
  await db("meta","readwrite",s=>s.put({id:"active",...recording,stopped:true,warning}));
  await drain();return state();
}
async function drain() {
  if(uploading||!connection) return;
  uploading=true;
  try {
    const chunks=await db("chunks","readonly",s=>s.getAll());
    for(const chunk of chunks) {
      await api(`/api/sessions/${chunk.sid}/chunks?seq=${chunk.seq}&start=${chunk.start}`,{method:"POST",body:chunk.wav,raw:true});
      await db("chunks","readwrite",s=>s.delete(chunk.id));
      lastError="";
    }
    if(stopping&&recording&&!(await db("chunks","readonly",s=>s.getAll())).length) {
      const finalSession=await api(`/api/sessions/${recording.sid}/stop`,{method:"POST",body:{last_seq:recording.last_seq,warning:stoppedWarning}});
      await db("meta","readwrite",s=>s.delete("active"));
      await chrome.runtime.sendMessage({type:"RECORDER_FINISHED",session:finalSession});
      recording=null;stopping=false;
    }
  } catch(e){lastError=e.message;} finally {uploading=false;}
}
async function recover(message) {
  connection=message.connection;
  if(media) {await drain();return state();}
  const saved=await db("meta","readonly",s=>s.get("active"));
  if(saved){recording=saved;stopping=true;stoppedWarning=saved.warning||"录制曾中断，已恢复上传浏览器缓存的音频";}
  await drain();return state();
}
setInterval(()=>void drain(),4000);
setInterval(async()=>{
  if(!recording||!connection) return;
  try {
    lastSession=await api(`/api/sessions/${recording.sid}`);
    await chrome.runtime.sendMessage({type:"RECORDER_UPDATE",session:lastSession,recorder:await state()});
  } catch(e){lastError=e.message;if(lastSession)await chrome.runtime.sendMessage({type:"RECORDER_UPDATE",session:lastSession,recorder:await state()}).catch(()=>{});}
},1500);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.target!=="offscreen"||sender.id!==chrome.runtime.id) return false;
  const action=message.type==="START"?()=>start(message):message.type==="STOP"?()=>stop(message.warning):message.type==="RECOVER"?()=>recover(message):state;
  action().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));return true;
});
