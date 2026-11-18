// Drive the real DOM while a production promise waits for the user's decision.
export async function withDialogs(page,expression,actions=['confirm']) {
  const pending=page.eval(expression).then(value=>({value}),error=>({error}));
  for(const action of actions){
    await page.until("!!document.querySelector('.app-dialog')");
    if(typeof action==='object')await page.eval(`const input=document.querySelector('.app-dialog input');input.value=${JSON.stringify(action.word)};input.dispatchEvent(new Event('input'))`);
    await page.eval(`document.querySelector('[data-dialog-action=${typeof action==='object'?action.action||'confirm':action}]').click()`);
  }
  const result=await pending;if(result.error)throw result.error;return result.value;
}
