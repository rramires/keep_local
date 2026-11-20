import {create} from './harness.mjs';

export async function run({browser,check,assert}) {
  await check('E0 clipboard warning names cross-device sync in English and Portuguese',async()=>{
    const page=await browser.page();
    try {
      await create(page);
      await page.eval("document.querySelector('[data-view=vault]').click()");
      const read=()=>page.eval("document.querySelector('.vault-clipboard-tip span').textContent");
      const english=await read();
      await page.eval("document.querySelector('#lang-toggle').click()");
      await page.until("document.documentElement.lang==='pt-BR'&&document.querySelector('.vault-clipboard-tip span')?.textContent.includes('histórico')");
      assert.deepEqual([english,await read()],[
        'Windows clipboard history (Win+V) and sync across devices can retain copied values after KeepLocal clears the clipboard.',
        'O histórico da área de transferência do Windows (Win+V) e a sincronização entre dispositivos podem conservar valores copiados mesmo após a limpeza pelo KeepLocal.',
      ]);
    }finally{await page.close();}
  });
}
