import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_BACKUP_BYTES} from '../../js/backup-format.js';

const trailer=()=>import('../../js/photo-trailer.js');
const JPEG=Uint8Array.of(0xff,0xd8,0xff,0xe0,1,2,0xff,0xd9);
const PNG=Uint8Array.of(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0,0,0,0,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82);

test('P2.0 recognizes clean JPEG and PNG by signature regardless of the filename',async()=>{
  const {photoType,photoParts}=await trailer();
  for(const [name,bytes,type] of [['fictional.png',JPEG,'jpeg'],['fictional.jpg',PNG,'png']]){
    const image=new File([bytes],name);
    const view=new Uint8Array(await image.arrayBuffer());
    assert.equal(photoType(view),type);
    assert.deepEqual(photoParts(view),{image:bytes,copy:null});
  }
});

test('P2.0 photo trailer has the exact principal and little-endian length',async()=>{
  const {photoParts,buildPhoto}=await trailer();
  const copies=[new Uint8Array(44).fill(0x8e),new Uint8Array(513).fill(0xa5)];
  for(const image of [JPEG,PNG]){
    for(const copy of copies){
      const photo=buildPhoto(image,copy);
      assert.equal(photo.length,image.length+copy.length+4);
      assert.equal(new DataView(photo.buffer,photo.byteOffset,photo.byteLength).getUint32(photo.length-4,true),copy.length);
      assert.deepEqual(photoParts(photo),{image,copy});
      assert.deepEqual(photoParts(Buffer.concat([Buffer.alloc(3),photo]).subarray(3)).copy,Buffer.from(copy));
    }
  }
});

test('P2.0 refuses unknown boundaries, short inputs and lengths outside the backup bounds',async()=>{
  const {photoParts,buildPhoto}=await trailer();
  const junk=Uint8Array.of(...JPEG,8,0,1,3);
  assert.equal(photoParts(junk),null);
  assert.equal(photoParts(JPEG.subarray(0,3)),null);
  assert.equal(photoParts(PNG.subarray(0,19)),null);
  assert.equal(photoParts(Uint8Array.of(0,1,0xff,0xd9)),null);
  assert.throws(()=>buildPhoto(junk,new Uint8Array(44)));
  for(const length of [0,43,MAX_BACKUP_BYTES+1,0xffffffff]){
    const photo=new Uint8Array(JPEG.length+44+4);
    photo.set(JPEG);
    new DataView(photo.buffer).setUint32(photo.length-4,length,true);
    assert.equal(photoParts(photo),null);
  }
});

test('P2.0 enforces the image and copy size bounds',async()=>{
  const {photoParts,buildPhoto,MAX_PHOTO_IMAGE_BYTES,MAX_PHOTO_BYTES}=await trailer();
  assert.equal(MAX_PHOTO_IMAGE_BYTES,32*1024*1024);
  assert.equal(MAX_PHOTO_BYTES,MAX_PHOTO_IMAGE_BYTES+MAX_BACKUP_BYTES+4);
  const image=new Uint8Array(MAX_PHOTO_IMAGE_BYTES+1);
  image.set(JPEG.subarray(0,3));
  image.set(JPEG.subarray(-2),image.length-2);
  assert.equal(photoParts(image),null);
  assert.throws(()=>buildPhoto(image,new Uint8Array(44)));
  assert.throws(()=>buildPhoto(JPEG,new Uint8Array(43)));
  assert.throws(()=>buildPhoto(JPEG,new Uint8Array(MAX_BACKUP_BYTES+1)));
});

test('P2.0 exact round trips with varied opaque copies from a fixed seed',async()=>{
  const {photoParts,buildPhoto}=await trailer();
  let seed=0x4b4c2029;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<128;i++){
    const image=i%2?PNG:JPEG;
    const copy=Uint8Array.from({length:44+next()%4096},()=>next()>>>24);
    assert.deepEqual(photoParts(buildPhoto(image,copy)),{image,copy});
  }
});
