/* Incremental transcript rendering preserves the reading position while audio arrives. */
globalThis.SessionView=(()=>{
  function time(value){const n=Math.floor(Math.max(0,value||0));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,'0')).join(':');}
  function repeated(text){return [...String(text).matchAll(/(.{1,24}?)\1{7,}/gu)].some(m=>m[0].length>=24)||String(text).includes('\ufffd');}
  function clean(s){return s.quality==='uncertain'||repeated(s.text)?'此段识别异常，建议按当前语言重新转写。':s.text;}
  function paint(target,segments,follow=true){
    const before=target.getBoundingClientRect().top;
    const anchor=follow?null:[...target.children].find(n=>n.getBoundingClientRect().bottom>before);
    const anchorOffset=anchor?.getBoundingClientRect().top;
    const known=new Map([...target.children].map(n=>[n.dataset.id,n])),keep=new Set();
    let cursor=target.firstChild;
    for(const s of segments){
      let row=known.get(s.id);keep.add(s.id);
      if(!row){row=document.createElement('article');row.className='live-line';row.dataset.id=s.id;const stamp=document.createElement('time'),words=document.createElement('p');row.append(stamp,words);}
      const text=clean(s),stamp=time(s.start)+(s.language?' · '+({zh:'中文',en:'EN',yue:'粤语'}[s.language]||s.language):'');
      if(row.firstChild.textContent!==stamp)row.firstChild.textContent=stamp;
      if(row.lastChild.textContent!==text)row.lastChild.textContent=text;
      row.classList.toggle('uncertain',text!==s.text||s.quality==='uncertain');
      row.classList.toggle('latest',s===segments.at(-1));
      if(row!==cursor)target.insertBefore(row,cursor);cursor=row.nextSibling;
    }
    for(const [id,row] of known)if(!keep.has(id))row.remove();
    if(follow)target.scrollTop=target.scrollHeight;
    else if(anchor?.isConnected)target.scrollTop+=anchor.getBoundingClientRect().top-anchorOffset;
  }
  function analysisEnabled(preferences,session){return typeof session?.analysis==='boolean'?session.analysis:preferences?.analysisDefault!==false;}
  return {time,clean,repeated,paint,analysisEnabled};
})();
