// -*- mode: js; js-indent-level: 2; -*-

// Workaround for https://github.com/microsoft/TypeScript/issues/36470
declare global {
  interface CallableFunction {
    apply<T, A, R>(this: (this: T, ...args: A[]) => R, thisArg: T, args: ArrayLike<A>): R;
  }
}

export namespace KaitaiStream {
  export interface ZlibHandler {
    inflate(data: Uint8Array): Uint8Array;
    deflate(data: Uint8Array): Uint8Array;
  }
}

/**
 * KaitaiStream is an implementation of Kaitai Struct API for JavaScript.
 * Based on DataStream - https://github.com/kig/DataStream.js .
 */
export class KaitaiStream {
  /**
   * @param arrayBuffer ArrayBuffer to read from.
   * @param byteOffset Offset from arrayBuffer beginning for the KaitaiStream.
   */
  public constructor(arrayBuffer: ArrayBuffer | DataView<ArrayBuffer> | Uint8Array | number, byteOffset?: number) {
    this._byteOffset = byteOffset || 0;

    if (ArrayBuffer.isView(arrayBuffer)) {
      if (arrayBuffer instanceof DataView) {
        this.dataView = arrayBuffer;
      } else {
        const backing = arrayBuffer.buffer;
        if (!(backing instanceof ArrayBuffer))
          throw new TypeError(`Unsupported ArrayBuffer type: ${backing.constructor.name}`);
        this.buffer = backing;
        this._byteOffset += arrayBuffer.byteOffset;
      }
    } else if (arrayBuffer instanceof ArrayBuffer) {
      this.buffer = arrayBuffer;
    } else {
      this.buffer = new ArrayBuffer(arrayBuffer || 1);
    }

    this.pos = 0;
    this.alignToByte();
  }

  /**
   * Virtual byte length of the KaitaiStream backing buffer.
   * Updated to be max of original buffer size and last written size.
   * If dynamicSize is false is set to buffer size.
   */
  private _byteLength = 0;
  private _byteOffset = 0;
  private _buffer!: ArrayBuffer;
  private _dataView!: DataView<ArrayBuffer>;

  public pos: number;
  public bits = 0;
  public bitsLeft = 0;

  /**
   * Runtime implementation for zlib compression.
   * This is dependent on the environment (NodeJS or Browser).
   */
  public static zlibHandler?: KaitaiStream.ZlibHandler | undefined;

  /**
   * Gets the backing ArrayBuffer of the KaitaiStream object.
   *
   * @returns The backing ArrayBuffer.
   */
  public get buffer(): ArrayBuffer {
    this._trimAlloc();
    return this._buffer;
  }

  /**
   * Sets the backing ArrayBuffer of the KaitaiStream object and updates the
   * DataView to point to the new buffer.
   */
  public set buffer(v: ArrayBuffer) {
    this._buffer = v;
    this._dataView = new DataView(this._buffer, this._byteOffset);
    this._byteLength = this._buffer.byteLength;
  }

  /**
   * Gets the byteOffset of the KaitaiStream object.
   *
   * @returns The byteOffset.
   */
  public get byteOffset(): number {
    return this._byteOffset;
  }

  /**
   * Sets the byteOffset of the KaitaiStream object and updates the DataView to
   * point to the new byteOffset.
   */
  public set byteOffset(v: number) {
    this._byteOffset = v;
    this._dataView = new DataView(this._buffer, this._byteOffset);
    this._byteLength = this._buffer.byteLength;
  }

  /**
   * Gets the backing DataView of the KaitaiStream object.
   *
   * @returns The backing DataView.
   */
  public get dataView(): DataView<ArrayBuffer> {
    return this._dataView;
  }
  /**
   * Sets the backing DataView of the KaitaiStream object and updates the buffer
   * and byteOffset to point to the DataView values.
   */
  public set dataView(v: DataView<ArrayBuffer>) {
    this._byteOffset = v.byteOffset;
    this._buffer = v.buffer;
    this._dataView = new DataView(this._buffer, this._byteOffset);
    this._byteLength = this._byteOffset + v.byteLength;
  }

  /**
   * Internal function to trim the KaitaiStream buffer when required.
   * Used for stripping out the extra bytes from the backing buffer when
   * the virtual byteLength is smaller than the buffer byteLength (happens after
   * growing the buffer with writes and not filling the extra space completely).
   */
  private _trimAlloc(): void {
    if (this._byteLength === this._buffer.byteLength) {
      return;
    }
    const buf = new ArrayBuffer(this._byteLength);
    const dst = new Uint8Array(buf);
    const src = new Uint8Array(this._buffer, 0, dst.length);
    dst.set(src);
    this.buffer = buf;
  }

  // ========================================================================
  // Stream positioning
  // ========================================================================

  /**
   * Returns true if the KaitaiStream seek pointer is at the end of buffer and
   * there's no more data to read.
   *
   * @returns True if the seek pointer is at the end of the buffer.
   */
  public isEof(): boolean {
    return this.pos >= this.size && this.bitsLeft === 0;
  }

  /**
   * Sets the KaitaiStream read/write position to given position.
   * Clamps between 0 and KaitaiStream length.
   *
   * @param pos Position to seek to.
   */
  public seek(pos: number): void {
    this.alignToByte();
    const npos = Math.max(0, Math.min(this.size, pos));
    this.pos = (isNaN(npos) || !isFinite(npos)) ? 0 : npos;
  }

  /**
   * Returns the byte length of the KaitaiStream object.
   *
   * @returns The byte length.
   */
  public get size(): number {
    return this._byteLength - this._byteOffset;
  }

  // ========================================================================
  // Integer numbers
  // ========================================================================

  // ------------------------------------------------------------------------
  // Signed
  // ------------------------------------------------------------------------

  /**
   * Reads an 8-bit signed int from the stream.
   *
   * @returns The read number.
   */
  public readS1(): number {
    this.alignToByte();
    this.ensureBytesLeft(1);
    const v = this._dataView.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  // ........................................................................
  // Big-endian
  // ........................................................................

  /**
   * Reads a 16-bit big-endian signed int from the stream.
   *
   * @returns The read number.
   */
  public readS2be(): number {
    this.alignToByte();
    this.ensureBytesLeft(2);
    const v = this._dataView.getInt16(this.pos);
    this.pos += 2;
    return v;
  }

  /**
   * Reads a 32-bit big-endian signed int from the stream.
   *
   * @returns The read number.
   */
  public readS4be(): number {
    this.alignToByte();
    this.ensureBytesLeft(4);
    const v = this._dataView.getInt32(this.pos);
    this.pos += 4;
    return v;
  }

  /**
   * Reads a 64-bit big-endian unsigned int from the stream. Note that
   * JavaScript does not support 64-bit integers natively, so it will
   * automatically upgrade internal representation to use IEEE 754
   * double precision float.
   *
   * @returns The read number.
   */
  public readS8be(): number {
    this.alignToByte();
    this.ensureBytesLeft(8);
    const v1 = this.readU4be();
    const v2 = this.readU4be();

    if ((v1 & 0x80000000) !== 0) {
      // negative number
      return -(0x100000000 * (v1 ^ 0xffffffff) + (v2 ^ 0xffffffff)) - 1;
    } else {
      return 0x100000000 * v1 + v2;
    }
  }

  // ........................................................................
  // Little-endian
  // ........................................................................

  /**
   * Reads a 16-bit little-endian signed int from the stream.
   *
   * @returns The read number.
   */
  public readS2le(): number {
    this.alignToByte();
    this.ensureBytesLeft(2);
    const v = this._dataView.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  /**
   * Reads a 32-bit little-endian signed int from the stream.
   *
   * @returns The read number.
   */
  public readS4le(): number {
    this.alignToByte();
    this.ensureBytesLeft(4);
    const v = this._dataView.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /**
   * Reads a 64-bit little-endian unsigned int from the stream. Note that
   * JavaScript does not support 64-bit integers natively, so it will
   * automatically upgrade internal representation to use IEEE 754
   * double precision float.
   *
   * @returns The read number.
   */
  public readS8le(): number {
    this.alignToByte();
    this.ensureBytesLeft(8);
    const v1 = this.readU4le();
    const v2 = this.readU4le();

    if ((v2 & 0x80000000) !== 0) {
      // negative number
      return -(0x100000000 * (v2 ^ 0xffffffff) + (v1 ^ 0xffffffff)) - 1;
    } else {
      return 0x100000000 * v2 + v1;
    }
  }

  // ------------------------------------------------------------------------
  // Unsigned
  // ------------------------------------------------------------------------

  /**
   * Reads an 8-bit unsigned int from the stream.
   *
   * @returns The read number.
   */
  public readU1(): number {
    this.alignToByte();
    this.ensureBytesLeft(1);
    const v = this._dataView.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  // ........................................................................
  // Big-endian
  // ........................................................................

  /**
   * Reads a 16-bit big-endian unsigned int from the stream.
   *
   * @returns The read number.
   */
  public readU2be(): number {
    this.alignToByte();
    this.ensureBytesLeft(2);
    const v = this._dataView.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  /**
   * Reads a 32-bit big-endian unsigned int from the stream.
   *
   * @returns The read number.
   */
  public readU4be(): number {
    this.alignToByte();
    this.ensureBytesLeft(4);
    const v = this._dataView.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  /**
   * Reads a 64-bit big-endian unsigned int from the stream. Note that
   * JavaScript does not support 64-bit integers natively, so it will
   * automatically upgrade internal representation to use IEEE 754
   * double precision float.
   *
   * @returns The read number.
   */
  public readU8be(): number {
    this.alignToByte();
    this.ensureBytesLeft(8);
    const v1 = this.readU4be();
    const v2 = this.readU4be();
    return 0x100000000 * v1 + v2;
  }

  // ........................................................................
  // Little-endian
  // ........................................................................

  /**
   * Reads a 16-bit little-endian unsigned int from the stream.
   *
   * @returns The read number.
   */
  public readU2le(): number {
    this.alignToByte();
    this.ensureBytesLeft(2);
    const v = this._dataView.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  /**
   * Reads a 32-bit little-endian unsigned int from the stream.
   *
   * @returns The read number.
   */
  public readU4le(): number {
    this.alignToByte();
    this.ensureBytesLeft(4);
    const v = this._dataView.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /**
   * Reads a 64-bit little-endian unsigned int from the stream. Note that
   * JavaScript does not support 64-bit integers natively, so it will
   * automatically upgrade internal representation to use IEEE 754
   * double precision float.
   *
   * @returns The read number.
   */
  public readU8le(): number {
    this.alignToByte();
    this.ensureBytesLeft(8);
    const v1 = this.readU4le();
    const v2 = this.readU4le();
    return 0x100000000 * v2 + v1;
  }

  // ========================================================================
  // Floating point numbers
  // ========================================================================

  // ------------------------------------------------------------------------
  // Big endian
  // ------------------------------------------------------------------------

  /**
   * Reads a 32-bit big-endian float from the stream.
   *
   * @returns The read number.
   */
  public readF4be(): number {
    this.alignToByte();
    this.ensureBytesLeft(4);
    const v = this._dataView.getFloat32(this.pos);
    this.pos += 4;
    return v;
  }

  /**
   * Reads a 64-bit big-endian float from the stream.
   *
   * @returns The read number.
   */
  public readF8be(): number {
    this.alignToByte();
    this.ensureBytesLeft(8);
    const v = this._dataView.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }

  // ------------------------------------------------------------------------
  // Little endian
  // ------------------------------------------------------------------------

  /**
   * Reads a 32-bit little-endian float from the stream.
   *
   * @returns The read number.
   */
  public readF4le(): number {
    this.alignToByte();
    this.ensureBytesLeft(4);
    const v = this._dataView.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /**
   * Reads a 64-bit little-endian float from the stream.
   *
   * @returns The read number.
   */
  public readF8le(): number {
    this.alignToByte();
    this.ensureBytesLeft(8);
    const v = this._dataView.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  // ------------------------------------------------------------------------
  // Unaligned bit values
  // ------------------------------------------------------------------------

  /**
   * Aligns the stream position to the next byte boundary.
   */
  public alignToByte(): void {
    this.bitsLeft = 0;
    this.bits = 0;
  }

  /**
   * @param n The number of bits to read.
   * @returns The read bits.
   * @throws {RangeError}
   */
  public readBitsIntBe(n: number): number {
    // JS only supports bit operations on 32 bits
    if (n > 32) {
      throw new RangeError("readBitsIntBe: the maximum supported bit length is 32 (tried to read " + n + " bits)");
    }
    let res = 0;

    const bitsNeeded = n - this.bitsLeft;
    this.bitsLeft = -bitsNeeded & 7; // `-bitsNeeded mod 8`

    if (bitsNeeded > 0) {
      // 1 bit  => 1 byte
      // 8 bits => 1 byte
      // 9 bits => 2 bytes
      const bytesNeeded = ((bitsNeeded - 1) >> 3) + 1; // `ceil(bitsNeeded / 8)` (NB: `x >> 3` is `floor(x / 8)`)
      const buf = this.mapUint8Array(bytesNeeded);
      for (let i = 0; i < bytesNeeded; i++) {
        res = res << 8 | buf[i]!;
      }

      const newBits = res;
      res = res >>> this.bitsLeft | this.bits << bitsNeeded; // `x << 32` is defined as `x << 0` in JS, but only `0 << 32`
                                                            // can occur here (`n = 32` and `bitsLeft = 0`, this implies
                                                            // `bits = 0` unless changed externally)
      this.bits = newBits; // will be masked at the end of the function
    } else {
      res = this.bits >>> -bitsNeeded; // shift unneeded bits out
    }

    const mask = (1 << this.bitsLeft) - 1; // `bitsLeft` is in range 0..7, so `(1 << 32)` does not have to be considered
    this.bits &= mask;

    // always return an unsigned 32-bit integer
    return res >>> 0;
  }

  /**
   * Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions.
   *
   * @deprecated Use {@link readBitsIntBe} instead.
   * @param n The number of bits to read.
   * @returns The read bits.
   */
  public readBitsInt(n: number): number {
    return this.readBitsIntBe(n);
  }

  /**
   * @param n The number of bits to read.
   * @returns The read bits.
   * @throws {RangeError}
   */
  public readBitsIntLe(n: number): number {
    // JS only supports bit operations on 32 bits
    if (n > 32) {
      throw new RangeError("readBitsIntLe: the maximum supported bit length is 32 (tried to read " + n + " bits)");
    }
    let res = 0;
    const bitsNeeded = n - this.bitsLeft;

    if (bitsNeeded > 0) {
      // 1 bit  => 1 byte
      // 8 bits => 1 byte
      // 9 bits => 2 bytes
      const bytesNeeded = ((bitsNeeded - 1) >> 3) + 1; // `ceil(bitsNeeded / 8)` (NB: `x >> 3` is `floor(x / 8)`)
      const buf = this.mapUint8Array(bytesNeeded);
      for (let i = 0; i < bytesNeeded; i++) {
        res |= buf[i]! << (i * 8);
      }

      // NB: in JavaScript, bit shift operators always shift by modulo 32 of the right-hand operand (see
      // https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-unsignedRightShift),
      // so `res >>> 32` is equivalent to `res >>> 0` (but we don't want that)
      const newBits = bitsNeeded < 32 ? res >>> bitsNeeded : 0;
      res = res << this.bitsLeft | this.bits;
      this.bits = newBits;
    } else {
      res = this.bits;
      this.bits >>>= n;
    }

    this.bitsLeft = -bitsNeeded & 7; // `-bitsNeeded mod 8`

    // always return an unsigned 32-bit integer
    if (n < 32) {
      const mask = (1 << n) - 1;
      res &= mask; // this produces a signed 32-bit int, but the sign bit is cleared
    } else {
      res >>>= 0;
    }
    return res;
  }

  /**
   * Native endianness. Either KaitaiStream.BIG_ENDIAN or KaitaiStream.LITTLE_ENDIAN
   * depending on the platform endianness.
   */
  public static endianness: boolean = new Int8Array(new Int16Array([1]).buffer)[0]! > 0;

  // ========================================================================
  // Byte arrays
  // ========================================================================

  /**
   * @param len The number of bytes to read.
   * @returns The read bytes.
   */
  public readBytes(len: number): Uint8Array {
    this.alignToByte();
    return this.mapUint8Array(len);
  }

  /**
   * @returns The read bytes.
   */
  public readBytesFull(): Uint8Array {
    this.alignToByte();
    return this.mapUint8Array(this.size - this.pos);
  }

  /**
   * Reads bytes until the terminator byte is found.
   *
   * @param terminator The terminator byte.
   * @param include True if the terminator should be included with the returned bytes.
   * @param consume True if the terminator should be consumed from the input stream.
   * @param eosError True to throw an error if the end of stream is reached.
   * @returns The read bytes.
   * @throws {string}
   */
  public readBytesTerm(terminator: number, include: boolean, consume: boolean, eosError: boolean): Uint8Array {
    this.alignToByte();
    const blen = this.size - this.pos;
    const u8 = new Uint8Array(this._buffer, this._byteOffset + this.pos);
    let i;
    for (i = 0; i < blen && u8[i] !== terminator; i++); // find first zero byte
    if (i === blen) {
      // we've read all the buffer and haven't found the terminator
      if (eosError) {
        throw new Error("End of stream reached, but no terminator " + terminator + " found");
      } else {
        return this.mapUint8Array(i);
      }
    } else {
      let arr;
      if (include) {
        arr = this.mapUint8Array(i + 1);
      } else {
        arr = this.mapUint8Array(i);
      }
      if (consume) {
        this.pos += 1;
      }
      return arr;
    }
  }

  /**
   * Reads bytes until the terminator byte sequence is found.
   *
   * @param terminator The terminator byte sequence.
   * @param include True if the terminator should be included with the returned bytes.
   * @param consume True if the terminator should be consumed from the input stream.
   * @param eosError True to throw an error if the end of stream is reached.
   * @returns The read bytes.
   * @throws {string}
   */
  public readBytesTermMulti(terminator: Uint8Array, include: boolean, consume: boolean, eosError: boolean): Uint8Array {
    this.alignToByte();
    const unitSize = terminator.length;
    const data = new Uint8Array(this._buffer, this._byteOffset + this.pos, this.size - this.pos);
    let res = KaitaiStream.bytesTerminateMulti(data, terminator, true);
    this.pos += res.length;
    const termFound =
        res.length !== 0 &&
        res.length % unitSize === 0 &&
        KaitaiStream.byteArrayCompare(new Uint8Array(res.buffer, res.length - unitSize), terminator) === 0;
    if (termFound) {
      if (!include) {
        res = new Uint8Array(res.buffer, res.byteOffset, res.length - unitSize);
      }
      if (!consume) {
        this.pos -= unitSize;
      }
    } else if (eosError) {
      throw new Error("End of stream reached, but no terminator " + terminator + " found");
    }
    return res;
  }

  /**
   * Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions.
   *
   * @param expected The expected bytes.
   * @returns The read bytes.
   * @throws {KaitaiStream.UnexpectedDataError}
   */
  public ensureFixedContents(expected: ArrayLike<number>): Uint8Array {
    const actual = this.readBytes(expected.length);
    if (actual.length !== expected.length) {
      throw new KaitaiStream.UnexpectedDataError(expected, actual);
    }
    const actLen = actual.length;
    for (let i = 0; i < actLen; i++) {
      if (actual[i] !== expected[i]) {
        throw new KaitaiStream.UnexpectedDataError(expected, actual);
      }
    }
    return actual;
  }

  /**
   * @param data The data.
   * @param padByte The byte to strip.
   * @returns The stripped data.
   */
  public static bytesStripRight(data: Uint8Array, padByte: number): Uint8Array {
    let newLen = data.length;
    while (data[newLen - 1] === padByte) {
      newLen--;
    }
    return data.slice(0, newLen);
  }

  /**
   * @param data The data.
   * @param term The terminator.
   * @param include True if the returned bytes should include the terminator.
   * @returns The terminated bytes.
   */
  public static bytesTerminate(data: Uint8Array, term: number, include: boolean): Uint8Array {
    let newLen = 0;
    const maxLen = data.length;
    while (newLen < maxLen && data[newLen] !== term) {
      newLen++;
    }
    if (include && newLen < maxLen)
      newLen++;
    return data.slice(0, newLen);
  }

  /**
   * @param data The data.
   * @param term The terminator.
   * @param include True if the returned bytes should include the terminator.
   * @returns The terminated bytes.
   */
  public static bytesTerminateMulti(data: Uint8Array, term: Uint8Array, include: boolean): Uint8Array {
    const unitSize = term.length;
    if (unitSize === 0) {
      return new Uint8Array(0);
    }
    const len = data.length;
    let iTerm = 0;
    for (let iData = 0; iData < len;) {
      if (data[iData] !== term[iTerm]) {
        iData += unitSize - iTerm;
        iTerm = 0;
        continue;
      }
      iData++;
      iTerm++;
      if (iTerm === unitSize) {
        return data.slice(0, iData - (include ? 0 : unitSize));
      }
    }
    return data.slice();
  }

  /**
   * @param arr The bytes.
   * @param encoding The character encoding.
   * @returns The decoded string.
   */
  public static bytesToStr(arr: Uint8Array, encoding: string): string {
    if (encoding == null || encoding.toLowerCase() === "ascii") {
      return KaitaiStream.createStringFromArray(arr);
    } else {
      return (new TextDecoder(encoding)).decode(arr);
    }
  }

  // ========================================================================
  // Byte array processing
  // ========================================================================

  /**
   * @param data The input bytes.
   * @param key The key byte.
   * @returns The Xor'd bytes.
   */
  public static processXorOne(data: Uint8Array, key: number): Uint8Array {
    const r = new Uint8Array(data.length);
    const dl = data.length;
    for (let i = 0; i < dl; i++)
      r[i] = data[i]! ^ key;
    return r;
  }

  /**
   * @param data The input bytes.
   * @param key The key bytes.
   * @returns The Xor'd bytes.
   */
  public static processXorMany(data: Uint8Array, key: Uint8Array): Uint8Array {
    const dl = data.length;
    const r = new Uint8Array(dl);
    const kl = key.length;
    let ki = 0;
    for (let i = 0; i < dl; i++) {
      r[i] = data[i]! ^ key[ki]!;
      ki++;
      if (ki >= kl)
        ki = 0;
    }
    return r;
  }

  /**
   * @param data The input bytes.
   * @param amount The shift amount in bits.
   * @param groupSize The number of bytes in each group.
   * @returns The rotated bytes.
   * @throws {string}
   */
  public static processRotateLeft(data: Uint8Array, amount: number, groupSize: number): Uint8Array {
    if (groupSize !== 1)
      throw new RangeError("unable to rotate group of " + groupSize + " bytes yet");

    const mask = groupSize * 8 - 1;
    const antiAmount = -amount & mask;

    const r = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++)
      r[i] = (data[i]! << amount) & 0xff | (data[i]! >> antiAmount);

    return r;
  }

  /**
   * @param buf The input bytes.
   * @returns The uncompressed bytes.
   */
  public static processZlib(buf: Uint8Array): Uint8Array {
    if (!KaitaiStream.zlibHandler)
      throw new Error("KaitaiStream.zlibHandler is not set");
    return KaitaiStream.zlibHandler.inflate(buf);
  }

  // ========================================================================
  // Misc runtime operations
  // ========================================================================

  /**
   * @param a The dividend.
   * @param b The divisor.
   * @returns The result of `a` mod `b`.
   * @throws {string}
   */
  public static mod(a: number, b: number): number {
    if (b <= 0)
      throw new RangeError("mod divisor <= 0");
    let r = a % b;
    if (r < 0)
      r += b;
    return r;
  }

  /**
   * Gets the smallest value in an array.
   *
   * @param arr The input array.
   * @returns The smallest value.
   */
  public static arrayMin(arr: ArrayLike<number>): number {
    let min = Infinity;
    for (let i = 0, n = arr.length; i < n; ++i) {
      const x = arr[i]!;
      if (x < min) min = x;
    }
    return min;
  }

  /**
   * Gets the largest value in an array.
   *
   * @param arr The input array.
   * @returns The largest value.
   */
  public static arrayMax(arr: ArrayLike<number>): number {
    let max = -Infinity;
    for (let i = 0, n = arr.length; i < n; ++i) {
      const x = arr[i]!;
      if (x > max) max = x;
    }
    return max;
  }

  /**
   * Compares two arrays of bytes from left to right.
   *
   * @param a The first array.
   * @param b The second array.
   * @returns `0` if the arrays are the equal, a positive number if `a` is greater than `b`, or a negative number if `a` is less than `b`.
   */
  public static byteArrayCompare(a: Uint8Array, b: Uint8Array): number {
    if (a === b)
      return 0;
    const al = a.length;
    const bl = b.length;
    const minLen = al < bl ? al : bl;
    for (let i = 0; i < minLen; i++) {
      const cmp = a[i]! - b[i]!;
      if (cmp !== 0)
        return cmp;
    }

    // Reached the end of at least one of the arrays
    if (al === bl) {
      return 0;
    } else {
      return al - bl;
    }
  }

  /**
   * Converts a byte array to a hex string.
   *
   * @param arr The input byte array.
   * @returns The hex string.
   */
  public static byteArrayToHex(arr: Uint8Array): string {
    let str = '[';
    for (let i = 0; i < arr.length; i++) {
      if (i > 0) str += ' ';
      str += arr[i]!.toString(16).padStart(2, '0');
    }
    str += ']';
    return str;
  }

  /**
   * Stringify value for debugging purposes.
   *
   * @param value The value to stringify.
   * @returns The stringified value.
   */
  public static stringifyValue(value: any): string {
    if (value instanceof Uint8Array) {
      return this.byteArrayToHex(value);
    } else {
      return String(value);
    }
  }

  // ========================================================================
  // Internal implementation details
  // ========================================================================

  /**
   * Ensures that we have at least `length` bytes left in the stream.
   * If not, throws an EOFError.
   *
   * @param length Number of bytes to require.
   * @throws {KaitaiStream.EOFError}
   */
  protected ensureBytesLeft(length: number): void {
    if (this.pos + length > this.size) {
      throw new KaitaiStream.EOFError(length, this.size - this.pos);
    }
  }

  /**
   * Maps a Uint8Array into the KaitaiStream buffer.
   * Nice for quickly reading in data.
   *
   * @param length Number of elements to map.
   * @returns A Uint8Array to the KaitaiStream backing buffer.
   */
  protected mapUint8Array(length: number): Uint8Array {
    length |= 0;

    this.ensureBytesLeft(length);

    const arr = new Uint8Array(this._buffer, this.byteOffset + this.pos, length);
    this.pos += length;
    return arr;
  }

  /**
   * Creates an array from an array of character codes.
   * Uses String.fromCharCode in chunks for memory efficiency and then concatenates
   * the resulting string chunks.
   *
   * @param array Array of character codes.
   * @returns String created from the character codes.
   */
  protected static createStringFromArray(array: Uint8Array): string {
    const chunk_size = 0x8000;
    const chunks = [];
    for (let i = 0; i < array.length; i += chunk_size) {
      const chunk = array.subarray(i, i + chunk_size);
      chunks.push(String.fromCharCode.apply(null, chunk));
    }
    return chunks.join("");
  }
}

export namespace KaitaiStream {
  export class EOFError extends Error {
    public bytesReq: number;
    public bytesAvail: number;

    /**
     * @param bytesReq The number of bytes requested.
     * @param bytesAvail The number of bytes available.
     */
    public constructor(bytesReq: number, bytesAvail: number) {
      super(`requested ${bytesReq} bytes, but only ${bytesAvail} bytes available`);
      this.bytesReq = bytesReq;
      this.bytesAvail = bytesAvail;
    }
  }

  /**
   * Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions.
   */
  export class UnexpectedDataError extends Error {
    public expected: any;
    public actual: any;

    /**
     * @param expected The expected value.
     * @param actual The actual value.
     */
    public constructor(expected: any, actual: any) {
      const expectedStr = KaitaiStream.stringifyValue(expected);
      const actualStr = KaitaiStream.stringifyValue(actual);
      super(`expected ${expectedStr}, but got ${actualStr}`);
      this.expected = expected;
      this.actual = actual;
    }
  }

  /**
   * Error that occurs when default endianness should be decided with a
   * switch, but nothing matches (although using endianness expression
   * implies that there should be some positive result).
   */
  export class UndecidedEndiannessError extends Error { }

  /**
   * Common ancestor for all error originating from Kaitai Struct usage.
   * Stores a KSY source path, pointing to an element supposedly guilty of
   * an error.
   */
  class KaitaiStructError extends Error {
    public srcPath?: string | undefined;

    /**
     * @param msg Error message.
     * @param srcPath The path to the KSY source element.
     */
    public constructor(msg: string, srcPath?: string) {
      super(`${srcPath ? srcPath + ": " : ""}${msg}`);
      this.srcPath = srcPath;
    }
  }

  /**
   * Common ancestor for all validation failures. Stores a pointer to
   * KaitaiStream IO object which was involved in an error.
   */
  export class ValidationFailedError extends KaitaiStructError {
    public io?: KaitaiStream | undefined;

    /**
     * @param msg Error message.
     * @param io The KaitaiStream IO object which was involved in an error.
     * @param srcPath The path to the KSY source element.
     */
    constructor(msg: string, io?: KaitaiStream, srcPath?: string) {
      super(`${io !== undefined ? 'at pos ' + io.pos + ': ' : ''}validation failed: ${msg}`, srcPath);
      this.io = io;
    }
  }

  /**
   * Signals validation failure: we required "actual" value to be equal to
   * "expected", but it turned out that it's not.
   */
  export class ValidationNotEqualError extends ValidationFailedError {
    public expected: any;
    public actual: any;

    /**
     * @param expected The expected value.
     * @param actual The actual value.
     * @param io The KaitaiStream IO object which was involved in an error.
     * @param srcPath The path to the KSY source element.
     */
    constructor(expected: any, actual: any, io?: KaitaiStream, srcPath?: string) {
      const expectedStr = KaitaiStream.stringifyValue(expected);
      const actualStr = KaitaiStream.stringifyValue(actual);
      super(`not equal, expected ${expectedStr}, but got ${actualStr}`, io, srcPath);
      this.expected = expected;
      this.actual = actual;
    }
  }

  export class ValidationLessThanError extends ValidationFailedError {
    public min: any;
    public actual: any;

    /**
     * @param min The minimum allowed value.
     * @param actual The actual value.
     * @param io The KaitaiStream IO object which was involved in an error.
     * @param srcPath The path to the KSY source element.
     */
    constructor(min: any, actual: any, io?: KaitaiStream, srcPath?: string) {
      const minStr = KaitaiStream.stringifyValue(min);
      const actualStr = KaitaiStream.stringifyValue(actual);
      super(`not in range, min ${minStr}, but got ${actualStr}`, io, srcPath);
      this.min = min;
      this.actual = actual;
    }
  }

  export class ValidationGreaterThanError extends ValidationFailedError {
    public max: any;
    public actual: any;

    /**
     * @param max The maximum allowed value.
     * @param actual The actual value.
     * @param io The KaitaiStream IO object which was involved in an error.
     * @param srcPath The path to the KSY source element.
     */
    constructor(max: any, actual: any, io?: KaitaiStream, srcPath?: string) {
      const maxStr = KaitaiStream.stringifyValue(max);
      const actualStr = KaitaiStream.stringifyValue(actual);
      super(`not in range, max ${maxStr}, but got ${actualStr}`, io, srcPath);
      this.max = max;
      this.actual = actual;
    }
  }
  export class ValidationNotAnyOfError extends ValidationFailedError {
    public actual: any;

    /**
     * @param actual The actual value.
     * @param io The KaitaiStream IO object which was involved in an error.
     * @param srcPath The path to the KSY source element.
     */
    constructor(actual: any, io?: KaitaiStream, srcPath?: string) {
      const actualStr = KaitaiStream.stringifyValue(actual);
      super(`not any of the list, got ${actualStr}`, io, srcPath);
      this.actual = actual;
    }
  }

  export class ValidationNotInEnumError extends ValidationFailedError {
    public actual: any;

    /**
     * @param actual The actual value.
     * @param io The KaitaiStream IO object which was involved in an error.
     * @param srcPath The path to the KSY source element.
     */
    constructor(actual: any, io?: KaitaiStream, srcPath?: string) {
      const actualStr = KaitaiStream.stringifyValue(actual);
      super(`not in the enum, got ${actualStr}`, io, srcPath);
      this.actual = actual;
    }
  }

  export class ValidationExprError extends ValidationFailedError {
    public actual: any;

    /**
     * @param actual The actual value.
     * @param io The KaitaiStream IO object which was involved in an error.
     * @param srcPath The path to the KSY source element.
     */
    public constructor(actual: any, io?: KaitaiStream, srcPath?: string) {
      super(`not matching the expression, got ${actual}`, io, srcPath);
      this.actual = actual;
    }
  }
}
