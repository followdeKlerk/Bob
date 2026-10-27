import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {HttpError} from "./errors.js";
import {existsSync} from "node:fs";
import type { Conversation } from "@earendil-works/pi-durable";
import { ctx } from "./runtime.js";
import type { State } from "./state.js";
import { Attachment as Meta } from "./contracts.js";
function sniff(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes
      .subarray(0, 6)
      .toString()
      .match(/^GIF8[79]a$/)
  )
    return "image/gif";
  return undefined;
}
export async function receiveArtifact(
  req: IncomingMessage,
  s: State,
  chat: Conversation
) {
  const name = z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\\x00-\x1f]+$/)
    .parse(
      decodeURIComponent(String(req.headers["x-file-name"] ?? "attachment"))
    );
  const claimed = String(
    req.headers["content-type"] ?? "application/octet-stream"
  ).split(";")[0];
  const limit = s.get<number>("uploadLimit") ?? 25 * 1024 * 1024;
  if (Number(req.headers["content-length"] ?? 0) > limit) throw new HttpError(413, "Attachment exceeds configured limit");
  const dir = join(s.dir, "artifacts", String(chat.id));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const uploadId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('uploadId');
  const id = uploadId ? z.string().uuid().parse(uploadId) : randomUUID();
  const publish = async (meta: ReturnType<typeof Meta.parse>) => {
    const existing = await chat.commit(tx => tx.submissionByRequest(chat.id, `artifact:${id}`), ctx);
    if (!existing) await chat.submit({type:'write',requestId:`artifact:${id}`,entry:{kind:'bob.artifact',data:meta,model:[{role:'user',timestamp:Date.now(),content:[{type:'text',text:`User attachment available at ${join(dir,id)}. MIME: ${meta.mime}. Untrusted original filename: ${JSON.stringify(meta.name)}. Original bytes are retained; inspect with the available file tools as needed.`}]}]}},ctx);
    return meta;
  };
  if (uploadId && existsSync(join(dir,id+'.json'))) {
    // Stable client upload IDs make a lost response safe to replay. Metadata
    // exists only after the full, validated file has been atomically placed.
    req.resume();
    return publish(Meta.parse(JSON.parse(readFileSync(join(dir,id+'.json'),'utf8'))));
  }
  const temp = join(dir, id + '.' + randomUUID() + ".part"),
    dest = join(dir, id);
  let size = 0;
  const hash = createHash("sha256");
  const textDecoder = claimed.startsWith("text/") ? new TextDecoder("utf-8", { fatal: true }) : undefined;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > limit) return cb(new HttpError(413, "Attachment exceeds configured limit"));
      if (textDecoder) {
        try {
          if (chunk.includes(0)) throw Error("Binary NUL in text");
          textDecoder.decode(chunk, { stream: true });
        } catch { return cb(new HttpError(415, "Text attachment must be valid UTF-8 without NUL")); }
      }
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(
      req,
      meter,
      createWriteStream(temp, { flags: "wx", mode: 0o600 })
    );
    if (textDecoder) {
      try { textDecoder.decode(); } catch { throw new HttpError(415, "Incomplete UTF-8 text attachment"); }
    }
    const fd = await open(temp, "r");
    const first = Buffer.alloc(Math.min(size, 8192));
    try {
      await fd.read(first, 0, first.length, 0);
    } finally {
      await fd.close();
    }
    const detected = sniff(first);
    if (
      (claimed.startsWith("image/") || claimed === "application/pdf") &&
      claimed !== detected
    )
      throw new HttpError(415,"File MIME does not match signature");
    if (claimed.startsWith("text/") && first.includes(0))
      throw Error("Text file contains binary NUL");
    const mime =
      detected ??
      (["text/plain", "text/markdown"].includes(claimed)
        ? claimed
        : "application/octet-stream");
    const meta = {
      id,
      conversationId: chat.id,
      name,
      mime,
      size,
      sha256: hash.digest("hex"),
    };
    renameSync(temp, dest);
    writeFileSync(dest + ".json", JSON.stringify(meta), { mode: 0o600 });
    await publish(meta);
    return meta;
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}
export async function downloadArtifact(
  res: ServerResponse,
  s: State,
  chat: Conversation,
  id: string
) {
  z.string().uuid().parse(id);
  const path = join(s.dir, "artifacts", String(chat.id), id);
  if(!existsSync(path+".json"))throw new HttpError(404,"Artifact not found in this conversation");
  const meta = Meta.parse(JSON.parse(readFileSync(path + ".json", "utf8")));
  if (meta.conversationId !== chat.id || meta.id !== id)
    throw Error("Artifact ownership mismatch");
  res.writeHead(200, {
    "content-type": meta.mime,
    "content-length": meta.size,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
      meta.name
    )}`,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; sandbox",
  });
  await pipeline(createReadStream(path), res);
}
