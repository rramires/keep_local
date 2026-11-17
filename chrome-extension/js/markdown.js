import { t } from './i18n.js';
const configured=new WeakSet();
const SAFE_URI=/^(?:https?:|mailto:)/i;
export function renderMarkdown(target,text) {
  const purifier=window.DOMPurify;
  if(!window.marked?.parse||!purifier?.sanitize){
    target.textContent=text;
    const warning=document.createElement('p');warning.className='markdown-warning';warning.role='status';warning.textContent=t('markdown.unavailable');target.prepend(warning);return;
  }
  if(!configured.has(purifier)){
    purifier.addHook('afterSanitizeAttributes',node=>{
      if(node.tagName!=='A')return;
      if(!SAFE_URI.test(node.getAttribute('href')||''))node.removeAttribute('href');
      node.setAttribute('target','_blank');node.setAttribute('rel','noopener noreferrer');
    });configured.add(purifier);
  }
  const renderer=new window.marked.Renderer();
  renderer.html=token=>String(token.text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  renderer.image=()=>'';
  target.innerHTML=purifier.sanitize(window.marked.parse(text,{renderer}),{
    ALLOWED_TAGS:['p','br','strong','em','del','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','hr','a','table','thead','tbody','tr','td','th'],
    ALLOWED_ATTR:['href','title','target','rel'],ALLOWED_URI_REGEXP:SAFE_URI,
    FORBID_TAGS:['img','style','form','input','iframe','object','svg'],FORBID_ATTR:['style']
  });
}
