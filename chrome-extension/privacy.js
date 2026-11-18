function switchLang(lang) {
  document.querySelectorAll('.lang-content').forEach(el=>el.classList.toggle('active',el.id==='lang-'+lang));
  document.querySelectorAll('.lang-btn').forEach(el=>el.classList.toggle('active',el.dataset.lang===lang));
  document.documentElement.lang=lang==='pt'?'pt-BR':'en';
}
document.querySelectorAll('.lang-btn').forEach(button=>button.addEventListener('click',()=>switchLang(button.dataset.lang)));
switchLang(navigator.language.startsWith('pt')?'pt':'en');
