import { t } from './i18n.js';
const COMMON=new Set([
  'password','passwordpassword','passphrase','senha','senhasenhasenha','admin','administrator','administrador',
  'welcome','bemvindo','bemvinda','letmein','letmeinletmein','changeme','changeit','default','secret','segredo',
  'iloveyou','iloveyouforever','loveyou','teamo','princess','princesa','sunshine','monkey','dragon','football',
  'baseball','superman','batman','michael','jennifer','jessica','jordan','charlie','donald','ashley','thomas',
  'master','mestre','root','login','guest','usuario','user','test','teste','testing','trustnoone','whatever',
  'nothing','computer','computador','internet','freedom','liberdade','family','familia','jesus','god','deus',
  'qwerty','asdfgh','zxcvbn','qazwsx','abc123','123456','123456789','1234567890','000000','111111','654321',
  'password123456','12345678901234','123456789012345','1234567890123456','qwertyuiopasdfgh',
  'correcthorsebatterystaple','troubador','troubadour','keeplocal'
]);
const WALKS=['abcdefghijklmnopqrstuvwxyz','01234567890123456789','qwertyuiopasdfghjklzxcvbnm','azertyuiopqsdfghjklmwxcvbn','qazwsxedcrfvtgbyhnujmikolp'];
function repeatedPattern(chars) {
  for(let size=1;size<=Math.min(8,Math.floor(chars.length/2));size++)if(chars.every((ch,i)=>ch===chars[i%size]))return true;
  return false;
}
function predictable(value) {
  const compact=value.replace(/[^\p{L}\p{N}]/gu,''),leet=value.replace(/[430157@$]/g,c=>({'4':'a','3':'e','0':'o','1':'i','5':'s','7':'t','@':'a','$':'s'}[c])).replace(/[^\p{L}\p{N}]/gu,'');
  if(COMMON.has(compact)||COMMON.has(leet)||repeatedPattern([...value.replace(/\s/gu,'')]))return true;
  if([...COMMON].some(word=>word.length>=4&&(compact.startsWith(word)||leet.startsWith(word))))return true;
  let remainder=compact;
  for(const walk of WALKS)for(const path of [walk,[...walk].reverse().join('')]){
    for(let length=path.length;length>=4;length--)for(let i=0;i+length<=path.length;i++)remainder=remainder.split(path.slice(i,i+length)).join('');
  }
  return compact.length>=8&&compact.length-remainder.length>=8&&(remainder.length<8||remainder.length/compact.length<0.3);
}
export function validatePassword(pw) {
  const normalized=pw.normalize('NFKC').trim().toLowerCase(),chars=[...normalized];
  const checks={minLength:[...pw.trim()].length>=14,notCommon:chars.length>0&&!predictable(normalized)};
  const errors=[];
  if(!checks.minLength)errors.push(t('validation.minLength'));
  if(!checks.notCommon)errors.push(t('validation.common'));
  const words=normalized.split(/\s+/u),variedWords=words.length>=5&&new Set(words).size>=5;
  const variedCharacters=new Set(chars).size>=12&&!/(.)\1{3}/u.test(normalized);
  const strength=errors.length?'weak':chars.length>=25&&(variedWords||variedCharacters)?'long':'adequate';
  return {valid:!errors.length,errors,checks,strength};
}
