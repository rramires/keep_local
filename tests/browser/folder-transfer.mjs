export async function writeFolderFixture(page,name,base64) {
  await page.eval(`(async()=>{
    const directory=await folderTest.directory(true);
    const file=await directory.getFileHandle(${JSON.stringify(name)},{create:true});
    const writer=await file.createWritable();
    await writer.write(Uint8Array.fromBase64(${JSON.stringify(base64)}));
    await writer.close();
  })()`);
}

export async function readFolderFixture(page,name) {
  return page.eval(`(async()=>{
    const handle=await (await folderTest.directory()).getFileHandle(${JSON.stringify(name)});
    return new Uint8Array(await (await handle.getFile()).arrayBuffer()).toBase64();
  })()`);
}

export async function copyFolderFiles(from,to) {
  const files=await from.eval(`(async()=>{
    const entries=[];
    for await(const [name,handle] of (await folderTest.directory()).entries()){
      if(handle.kind==='file'&&/\\.keeplocal$/i.test(name)) entries.push(name);
    }
    return entries;
  })()`);
  for(const name of files) await writeFolderFixture(to,name,await readFolderFixture(from,name));
}
