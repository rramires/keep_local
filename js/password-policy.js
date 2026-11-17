import { t } from './i18n.js';
const COMMON=new Set(['passwordpassword','password123456','12345678901234','123456789012345','1234567890123456','qwertyuiopasdfgh','senhasenhasenha','letmeinletmein','correct horse battery staple']);
export function validatePassword(pw) {
  const normalized=pw.normalize('NFKC').trim().toLowerCase();
  const checks={minLength:[...pw].length>=14,notCommon:!COMMON.has(normalized)&&! /^(.)\1+$/.test(normalized)};
  const errors=[];
  if(!checks.minLength)errors.push(t('validation.minLength'));
  if(!checks.notCommon)errors.push(t('validation.common'));
  const strength=!checks.minLength||!checks.notCommon?'weak':pw.length>=24?'long':'adequate';
  return {valid:!errors.length,errors,checks,strength};
}
