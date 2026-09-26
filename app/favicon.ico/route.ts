import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET() {
  const icon = await readFile(join(process.cwd(), "public", "uvel-mark-dark.png"));
  return new Response(new Uint8Array(icon), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}
