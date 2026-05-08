// lib/parsers/io.ts
//
// Tiny IO helpers used by every parser: turn a File | Buffer | string into
// a string of CSV text + the SHA-256 of its bytes. We hash the bytes (not
// the parsed rows) so re-import detection is robust against any parsing
// changes we might make later.

import { createHash } from "node:crypto";

export type ParserInput = string | Buffer | ArrayBuffer | Uint8Array | File;

/**
 * Normalize any accepted input into { text, sourceHash }.
 *
 * - string: assumed to already be CSV text; hashed as UTF-8 bytes.
 * - Buffer / ArrayBuffer / Uint8Array: read and hashed directly.
 * - File: read via .arrayBuffer() (works in Node 20+ / browser).
 */
export async function readInput(
  input: ParserInput,
): Promise<{ text: string; sourceHash: string }> {
  let bytes: Uint8Array;

  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    // Buffer is a Uint8Array in Node, so this branch handles both.
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (typeof File !== "undefined" && input instanceof File) {
    const ab = await input.arrayBuffer();
    bytes = new Uint8Array(ab);
  } else {
    throw new TypeError(
      "Unsupported parser input type. Expected string | Buffer | ArrayBuffer | Uint8Array | File.",
    );
  }

  const hash = createHash("sha256").update(bytes).digest("hex");
  // Strip a UTF-8 BOM if present so header detection isn't thrown off.
  const text =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
      ? new TextDecoder("utf-8").decode(bytes.subarray(3))
      : new TextDecoder("utf-8").decode(bytes);

  return { text, sourceHash: hash };
}
