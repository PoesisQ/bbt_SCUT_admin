/* Runs on the audio rendering thread: constant memory, overlapping PCM windows. */
class ScutPCM extends AudioWorkletProcessor {
  constructor() {
    super();this.window=Math.round(sampleRate*8);this.overlap=Math.round(sampleRate);
    this.buffer=new Float32Array(this.window);this.used=0;this.total=0;this.lastSent=0;this.stopped=false;
    this.port.onmessage=e=>{if(e.data==="flush") {this.emit(true);this.stopped=true;this.port.postMessage({flushed:true});}};
  }
  emit(final=false) {
    if(this.total<=this.lastSent||!this.used) return;
    const pcm=this.buffer.slice(0,this.used);
    this.port.postMessage({pcm,start:(this.total-this.used)/sampleRate,rate:sampleRate},[pcm.buffer]);
    this.lastSent=this.total;
    if(!final) {this.buffer.copyWithin(0,this.used-this.overlap,this.used);this.used=this.overlap;}
  }
  process(inputs) {
    if(this.stopped) return false;
    const channels=inputs[0];if(!channels?.length) return true;
    const length=channels[0].length;
    for(let i=0;i<length;i++) {
      let sum=0;for(const ch of channels)sum+=ch[i]||0;
      this.buffer[this.used++]=sum/channels.length;this.total++;
      if(this.used===this.window)this.emit();
    }
    return true;
  }
}
registerProcessor("scut-pcm",ScutPCM);
