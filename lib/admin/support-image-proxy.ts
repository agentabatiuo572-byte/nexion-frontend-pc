// Transport ceiling only; the backend remains the authority for image policy.
export async function boundedUpload(source: { body: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!source.body) return new ArrayBuffer(0);
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new ArrayBuffer(size);
  const body = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return buffer;
}
