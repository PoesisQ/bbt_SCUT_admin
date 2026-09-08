(() => {
  const A=AssistantClient,$=id=>document.getElementById(id),extension=!!globalThis.chrome?.runtime?.id;
  let browser='edge',setup=null;
  const notify=(text,error=false)=>{$('guide-message').textContent=text;$('guide-message').className='notice'+(error?' error':'');};
  async function copy(value,label){try{if(!value)throw new Error('请先启动并连接本地服务，再复制项目路径。');await navigator.clipboard.writeText(value);AssistantUI.toast(label);}catch(e){notify(e.message,true);}}
  function choose(name){browser=name;document.querySelectorAll('[data-browser]').forEach(b=>{b.classList.toggle('active',b.dataset.browser===name);b.setAttribute('aria-pressed',String(b.dataset.browser===name));});$('extensions-address').textContent=name+'://extensions';$('browser-label').textContent=name==='edge'?'Edge':'Chrome';}
  document.querySelectorAll('[data-browser]').forEach(b=>b.onclick=()=>choose(b.dataset.browser));
  $('copy-address').onclick=()=>copy(browser+'://extensions','扩展管理地址已复制，在浏览器地址栏粘贴并回车');
  $('copy-path').onclick=()=>copy(setup?.extension_path,'扩展文件夹路径已复制');
  $('copy-launch').onclick=()=>copy(setup?.start_command,'启动命令已复制，可在 PowerShell 中运行');
  $('pair-token').onclick=async()=>{try{if(extension){await chrome.runtime.openOptionsPage();return;}const result=await A.api('/api/pairing-token');await copy(result.token,'连接口令已复制；粘贴到扩展「设置 → 连接与安装」');}catch(e){notify(e.message,true);}};
  $('pair-token').textContent=extension?'打开扩展连接设置':'复制扩展连接口令';
  if(extension){$('extension-context').textContent='此页面已在扩展内打开。连接成功后，就可以开始听课。';}
  (async()=>{try{setup=await A.api('/api/setup');$('extension-path').textContent=setup.extension_path;$('launch-command').textContent=setup.start_command;$('service-status').textContent='本地服务已就绪';$('service-status').className='chip';$('service-description').textContent='模型在本机运行，浏览器通过连接口令与它配对。';}catch{$('service-status').textContent='等待连接';$('service-status').className='chip warn';$('service-description').textContent='先运行项目中的「启动课堂助手.cmd」，再连接扩展。';$('extension-path').textContent='选择项目文件夹内的 extension 子文件夹';$('launch-command').textContent='双击项目内「启动课堂助手.cmd」';}})();
})();
