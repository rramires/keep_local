import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));

export async function withArchivedProfile2(ref,run) {
  const directory=await mkdtemp(join(tmpdir(),'keeplocal-profile2-'));
  try{
    const archive=execFileSync('git',['archive',ref,'js'],{cwd:root});
    execFileSync('tar',['-xf','-','-C',directory],{input:archive});
    const backup=await import(pathToFileURL(join(directory,'js/backup-v2.js')));
    const format=await import(pathToFileURL(join(directory,'js/backup-format.js')));
    const model=await import(pathToFileURL(join(directory,'js/note-model.js')));
    return await run({backup,format,model});
  }finally{
    await rm(directory,{recursive:true,force:true});
  }
}
