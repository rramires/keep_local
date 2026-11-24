import {t} from './i18n.js';

const templates={
  blank:[''],
  server:['host','port','user','password',{text:'notes'}],
  database:['host','port','database','user','password'],
  api:['url','keyId','token'],
  ssh:['host','port','user',{label:'privateKey',multiline:true},'passphrase'],
  web:['url','userEmail','password'],
  objectStorage:['accountId','endpoint','bucket','region','accessKeyId','secretAccessKey','token'],
};

export const VAULT_TEMPLATE_IDS=Object.freeze(Object.keys(templates));

export function createVaultTemplate(name) {
  if(!Object.hasOwn(templates,name))throw new RangeError('Unknown vault template');
  const label=key=>key?t('vault.template.field.'+key):'';
  return templates[name].map(field=>{
    const id=crypto.randomUUID();
    if(typeof field==='string')return {id,kind:'field',label:label(field),value:''};
    if(field.text)return {id,kind:'text',value:''};
    return {id,kind:'field',label:label(field.label),value:'',multiline:field.multiline};
  });
}
