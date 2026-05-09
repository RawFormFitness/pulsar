// lib/parsers/index.ts
//
// Barrel re-export of the parser layer. Adapters are intentionally loaded
// individually by callers that already know which format they want; the
// orchestrator (lib/import/run.ts) is the only thing that fans out across
// formats.

export type {
  DetectedFormat,
  ParseResult,
  ParseWarning,
  LeadRow,
  SaleRow,
  MemberRow,
  RfcRow,
  CancellationRow,
} from "./types";
export { FORMATS } from "./types";

export { detectFormat } from "./detect";
export type { DetectResult } from "./detect";

export { parseLeads } from "./leads";
export { parseAbcSales } from "./abc_sales";
export { parseAbcMembers } from "./abc_members";
export { parseAbcRfc } from "./abc_rfc";
export { parseCancelLedger } from "./cancel_ledger";
