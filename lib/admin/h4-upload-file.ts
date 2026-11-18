/** Upload bytes must survive refresh before the multipart request is sent.
 * IndexedDB holds the File; the shared H4 journal holds its original metadata. */
async function fileOperation<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("nexion-admin-h4-upload-files-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("H4_REQUEST_STORAGE_UNAVAILABLE"));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("files", mode), request = operation(transaction.objectStore("files"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error("H4_REQUEST_STORAGE_UNAVAILABLE"));
    });
  } finally { db.close(); }
}
export async function saveH4UploadFile(key: string, file: File) {
  await fileOperation("readwrite", store => store.put(file, key));
  const saved = await readH4UploadFile(key);
  if (saved.name !== file.name || saved.type !== file.type || saved.size !== file.size) throw new Error("H4_REQUEST_STORAGE_UNAVAILABLE");
}
export async function readH4UploadFile(key: string): Promise<File> {
  const file = await fileOperation<unknown>("readonly", store => store.get(key));
  if (!(file instanceof File)) throw new Error("H4_UPLOAD_FILE_UNAVAILABLE");
  return file;
}
export const deleteH4UploadFile = (key: string) => fileOperation("readwrite", store => store.delete(key));
