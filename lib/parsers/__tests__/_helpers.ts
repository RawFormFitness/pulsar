// lib/parsers/__tests__/_helpers.ts
//
// Shared test helpers. Each parser test reads the corresponding CSV from
// prototype/sample_data/ and exercises the parser. These helpers exist so
// individual tests stay short and focused on the assertion shape.
//
// Privacy note: prototype/sample_data/ is real gym data. Tests can read
// from it but MUST NOT snapshot row contents into committed fixtures —
// only row-count assertions and structural shape checks.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SAMPLE_DIR = resolve(process.cwd(), "prototype", "sample_data");

export async function loadSample(name: string): Promise<Buffer> {
  return readFile(resolve(SAMPLE_DIR, name));
}

export const TEST_GYM_ID = "11111111-1111-1111-1111-111111111111";
