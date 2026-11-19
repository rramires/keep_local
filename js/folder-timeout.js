export const FOLDER_METADATA_TIMEOUT_MS=15_000;
export const FOLDER_FILE_TIMEOUT_MS=60_000;

// A disposable CDP fixture can set shorter deadlines before module evaluation.
const testTimeouts=globalThis.__keepLocalTestFolderTimeouts;
const timeouts={
  metadata:testTimeouts?.metadata??FOLDER_METADATA_TIMEOUT_MS,
  file:testTimeouts?.file??FOLDER_FILE_TIMEOUT_MS,
};

export async function withFolderReadTimeout(read,kind='metadata') {
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new DOMException('Folder read timed out','TimeoutError')),timeouts[kind]);
  });
  try {
    // The native read cannot be canceled. Only the winner leaves this helper.
    return await Promise.race([deadline,typeof read==='function'?read():read]);
  } finally {
    clearTimeout(timer);
  }
}
