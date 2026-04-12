import zlib from "node:zlib";
import { KaitaiStream } from "./KaitaiStream.js";

/**
 * For NodeJS environments, we use the built-in zlib module.
 */
KaitaiStream.zlibHandler = {
    inflate(buf: Uint8Array): Uint8Array {
        const r = zlib.inflateSync(Buffer.from(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
        return new Uint8Array(r.buffer, r.byteOffset, r.length);
    },
    deflate(buf: Uint8Array): Uint8Array {
        const r = zlib.deflateSync(Buffer.from(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
        return new Uint8Array(r.buffer, r.byteOffset, r.length);
    }
};

export * from "./KaitaiStruct.js";
export * from "./KaitaiStream.js";
