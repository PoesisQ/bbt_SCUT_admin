/* Small shared presentation layer; all icon markup is bundled and trusted. */
(() => {
  const paths={
    book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2"/>',
    grid:'<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    bell:'<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4M12 2v2"/>',
    wave:'<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>',
    spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
    settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>',
    arrow:'<path d="M5 12h14M14 7l5 5-5 5"/>',
    link:'<path d="m10 7 2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2M8 16l8-8"/>',
    shield:'<path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6zM8 12l3 3 5-6"/>',
    folder:'<path d="M3 7V5h7l2 3h9v12H3z"/>',
    copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
    play:'<path d="m8 4 12 8-12 8z"/>',
    refresh:'<path d="M20 7V3M20 7h-4M20 7a9 9 0 1 0 1 8"/>',
    cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/><rect x="10" y="10" width="4" height="4" rx=".5"/>',
    download:'<path d="M12 3v12M7 10l5 5 5-5M4 16v5h16v-5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01"/>',
    check:'<path d="m5 12 4 4L20 5"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'
  };
  function icons(root=document){for(const target of root.querySelectorAll('[data-icon]')){if(target.classList.contains('brand-mark')){target.innerHTML='<img src="brand.png" alt="">';continue;}const name=target.dataset.icon;if(!paths[name])continue;target.innerHTML=`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;}}
  icons();
  const favicon=document.createElement('link');favicon.rel='icon';favicon.type='image/png';favicon.href='brand.png';document.head.append(favicon);
  let timer;
  function toast(text){let region=document.querySelector('.toast-region');if(!region){region=document.createElement('div');region.className='toast-region';region.setAttribute('role','status');document.body.append(region);}region.replaceChildren();const el=document.createElement('div');el.className='ui-toast';el.textContent=text;region.append(el);clearTimeout(timer);timer=setTimeout(()=>region.replaceChildren(),4200);}
  function selectPanel(name,focus=false){
    const button=document.querySelector(`[data-panel="${name}"]`);if(!button)return;
    document.querySelectorAll('[data-panel]').forEach(el=>{const active=el===button;el.classList.toggle('active',active);el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1;});
    document.querySelectorAll('.settings-panel').forEach(el=>el.hidden=el.id!==`panel-${name}`);
    history.replaceState(null,'',location.pathname+location.search+'#'+name);if(focus)button.focus();
  }
  const nav=document.querySelector('.settings-nav');
  if(nav){nav.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>selectPanel(button.dataset.panel)));nav.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;const buttons=[...nav.querySelectorAll('[data-panel]')],current=buttons.indexOf(document.activeElement);if(current<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+buttons.length)%buttons.length;selectPanel(buttons[next].dataset.panel,true);});
    // Legacy token links are consumed by options.js, before panel navigation.
    if(!location.hash.includes('token='))selectPanel(location.hash.slice(1)||'connection');
  }
  globalThis.AssistantUI={icons,toast,selectPanel};
})();
