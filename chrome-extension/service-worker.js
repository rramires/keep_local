chrome.action.onClicked.addListener(async () => {
  const url=chrome.runtime.getURL('index.html');
  let contexts=[];
  try { contexts=await chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[url]}); } catch {}
  const existing=contexts.find(context=>context.tabId>=0);
  if(existing){
    try {
      await chrome.tabs.update(existing.tabId,{active:true});
      try { await chrome.windows.update(existing.windowId,{focused:true}); } catch {}
      return;
    } catch {}
  }
  await chrome.tabs.create({url});
});
