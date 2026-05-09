// lib/db/__tests__/_pagination.test.ts
//
// Unit test for the paginate() utility. Stubs the query builder so the
// test runs without a Supabase stack. Asserts:
//   * paginate keeps requesting pages until it gets a short read
//   * all rows are concatenated in encounter order (no dedup, no reorder)
//   * each page request hits the expected (offset, offset + pageSize - 1)
//   * a Postgrest error short-circuits with a throw
//   * the maxRows safety stop fires when the loop would otherwise run away

import { test } from "node:test";
import assert from "node:assert/strict";

import { paginate } from "../_pagination";

type Row = { id: number };

function stubBuilder(pages: Row[][], capturedRanges: Array<[number, number]>) {
  // Each call to factory() returns a fresh "builder" with a .range() method.
  // Successive factory() calls hand out the next page in order.
  let pageIdx = 0;
  return () => ({
    range: async (from: number, to: number) => {
      capturedRanges.push([from, to]);
      const data = pages[pageIdx] ?? [];
      pageIdx++;
      return { data, error: null };
    },
  });
}

test("paginate — single short page returns immediately", async () => {
  const ranges: Array<[number, number]> = [];
  const factory = stubBuilder([[{ id: 1 }, { id: 2 }, { id: 3 }]], ranges);
  const out = await paginate<Row>(factory, { pageSize: 1000 });
  assert.deepEqual(
    out.map((r) => r.id),
    [1, 2, 3],
  );
  // One request only — short read terminates the loop.
  assert.deepEqual(ranges, [[0, 999]]);
});

test("paginate — fills exactly one full page then a short page", async () => {
  const full = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  const tail = [{ id: 6 }];
  const ranges: Array<[number, number]> = [];
  const factory = stubBuilder([full, tail], ranges);
  const out = await paginate<Row>(factory, { pageSize: 5 });
  assert.deepEqual(
    out.map((r) => r.id),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(ranges, [
    [0, 4],
    [5, 9],
  ]);
});

test("paginate — multi-page loop assembles in order", async () => {
  // Simulate a real situation: 1370 rows, default pageSize 1000.
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 }));
  const page2 = Array.from({ length: 370 }, (_, i) => ({ id: 1001 + i }));
  const ranges: Array<[number, number]> = [];
  const factory = stubBuilder([page1, page2], ranges);
  const out = await paginate<Row>(factory);
  assert.equal(out.length, 1370);
  assert.equal(out[0].id, 1);
  assert.equal(out.at(-1)?.id, 1370);
  assert.deepEqual(ranges, [
    [0, 999],
    [1000, 1999],
  ]);
});

test("paginate — empty first page terminates without throwing", async () => {
  const ranges: Array<[number, number]> = [];
  const factory = stubBuilder([[]], ranges);
  const out = await paginate<Row>(factory);
  assert.deepEqual(out, []);
  assert.deepEqual(ranges, [[0, 999]]);
});

test("paginate — Postgrest error throws", async () => {
  // Cast through unknown — paginate() only inspects {data, error}, but the
  // type signature requires a real PostgrestError shape. The runtime test
  // doesn't care about toJSON; the type system does.
  const factory = (() => ({
    range: async () => ({
      data: null,
      error: {
        message: "boom",
        details: "",
        hint: "",
        code: "PGRST",
        name: "PostgrestError",
      },
    }),
  })) as unknown as Parameters<typeof paginate<Row>>[0];
  await assert.rejects(
    () => paginate<Row>(factory),
    (err: unknown) =>
      typeof err === "object" &&
      err !== null &&
      (err as { message?: string }).message === "boom",
  );
});

test("paginate — maxRows safety stop fires on a runaway producer", async () => {
  // Producer never short-reads — every page is full size.
  const factory = () => ({
    range: async (from: number, to: number) => {
      const len = to - from + 1;
      const data = Array.from({ length: len }, (_, i) => ({ id: from + i }));
      return { data, error: null };
    },
  });
  await assert.rejects(
    () => paginate<Row>(factory, { pageSize: 100, maxRows: 250 }),
    /exceeded maxRows=250/,
  );
});

test("paginate — pageSize <= 0 rejected", async () => {
  await assert.rejects(
    () => paginate<Row>(() => ({ range: async () => ({ data: [], error: null }) }), { pageSize: 0 }),
    /pageSize must be > 0/,
  );
});
