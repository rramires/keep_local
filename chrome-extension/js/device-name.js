export function normalizeDeviceName(value) {
  if(typeof value!=='string'||/\p{Cc}/u.test(value))return null;
  const name=value.trim();
  return name&&[...name].length<=40?name:null;
}
