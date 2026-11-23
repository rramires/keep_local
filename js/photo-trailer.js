import {MAX_BACKUP_BYTES} from './backup-format.js';

const JPEG_SIGNATURE=[0xff,0xd8,0xff];
const PNG_SIGNATURE=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
const JPEG_END=[0xff,0xd9];
const PNG_END=[0,0,0,0,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82];
const LENGTH_BYTES=4;
const MIN_COPY_BYTES=44;
export const MAX_PHOTO_IMAGE_BYTES=32*1024*1024;
export const MAX_PHOTO_BYTES=MAX_PHOTO_IMAGE_BYTES+MAX_BACKUP_BYTES+LENGTH_BYTES;

function matches(bytes,signature,offset=0) {
  return offset>=0&&signature.every((value,index)=>bytes[offset+index]===value);
}

export function photoType(bytes) {
  if(matches(bytes,JPEG_SIGNATURE))return 'jpeg';
  if(matches(bytes,PNG_SIGNATURE))return 'png';
  return null;
}

export function photoParts(bytes) {
  if(bytes.length<LENGTH_BYTES||bytes.length>MAX_PHOTO_BYTES)return null;
  const type=photoType(bytes);
  if(!type)return null;
  const marker=type==='jpeg'?JPEG_END:PNG_END;
  const endsAt=end=>end<=MAX_PHOTO_IMAGE_BYTES&&matches(bytes,marker,end-marker.length);
  const lengthOffset=bytes.length-LENGTH_BYTES;
  const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(lengthOffset,true);
  const boundary=lengthOffset-length;
  const minimum=type==='jpeg'?4:PNG_SIGNATURE.length+PNG_END.length;
  if(length>=MIN_COPY_BYTES&&length<=MAX_BACKUP_BYTES&&boundary>=minimum&&endsAt(boundary))
    return {image:bytes.subarray(0,boundary),copy:bytes.subarray(boundary,lengthOffset)};
  if(bytes.length>=minimum&&endsAt(bytes.length))return {image:bytes,copy:null};
  return null;
}

export function buildPhoto(image,copy) {
  const parts=photoParts(image);
  if(!parts||parts.copy||copy.length<MIN_COPY_BYTES||copy.length>MAX_BACKUP_BYTES)
    throw new Error('photo.unrecognized');
  const bytes=new Uint8Array(image.length+copy.length+LENGTH_BYTES);
  bytes.set(image);
  bytes.set(copy,image.length);
  new DataView(bytes.buffer).setUint32(bytes.length-LENGTH_BYTES,copy.length,true);
  return bytes;
}
