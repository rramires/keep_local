export const PASSWORD_DEFAULTS=Object.freeze({
  length:24,upper:true,lower:true,digits:true,symbols:true,avoidSimilar:false,
});

const alphabet={
  upper:'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower:'abcdefghijklmnopqrstuvwxyz',
  digits:'0123456789',
  symbols:'!#$%&()*+,-./:;<=>?@[]^_{|}~',
};
const similar=/[0Oo1lI|]/g;

export function uniformIndex(size,random) {
  if(!Number.isInteger(size)||size<1||size>256)throw new RangeError('Invalid random range');
  const sample=new Uint8Array(1);
  const limit=256-(256%size);
  do { random(sample); } while(sample[0]>=limit);
  return sample[0]%size;
}

export function generatePassword(options={},random=bytes=>crypto.getRandomValues(bytes)) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Invalid password options');
  const settings={...PASSWORD_DEFAULTS,...options};
  const {length,avoidSimilar}=settings;
  if(!Number.isInteger(length)||length<8||length>128)throw new RangeError('Password length must be 8–128');
  if([...Object.keys(alphabet),'avoidSimilar'].some(key=>typeof settings[key]!=='boolean'))
    throw new TypeError('Password class flags must be boolean');
  const groups=Object.entries(alphabet).filter(([key])=>settings[key])
    .map(([,chars])=>avoidSimilar?chars.replace(similar,''):chars);
  if(!groups.length)throw new RangeError('Choose at least one password class');
  const choose=chars=>chars[uniformIndex(chars.length,random)];
  const pool=groups.join('');
  const password=groups.map(choose);
  while(password.length<length)password.push(choose(pool));
  for(let index=password.length-1;index>0;index--){
    const other=uniformIndex(index+1,random);
    [password[index],password[other]]=[password[other],password[index]];
  }
  return password.join('');
}
