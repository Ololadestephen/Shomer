/** Durable paid-result records. The payment authorization itself is never stored. */

export type PaidReceiptState = 'processing' | 'report_ready' | 'settled';

export interface ReceiptStatement {
  bind(...values: unknown[]): ReceiptStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

/** Structural subset of a Cloudflare D1 binding, kept injectable for tests. */
export interface ReceiptDatabase {
  prepare(query: string): ReceiptStatement;
}

export interface PaidReceiptRecord {
  receiptId: string;
  requestHash: string;
  state: PaidReceiptState;
  responseStatus: number | null;
  responseBody: Record<string, unknown> | null;
  paymentResponseHeader: string | null;
  transactionHash: string | null;
  reportId: string | null;
  network: string | null;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

interface PaidReceiptRow {
  receipt_id: string;
  request_hash: string;
  state: PaidReceiptState;
  response_status: number | null;
  response_json: string | null;
  payment_response_header: string | null;
  transaction_hash: string | null;
  report_id: string | null;
  network: string | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function paymentReceiptIdentity(
  paymentHeader: string,
  requestBody: unknown,
): Promise<{ receiptId: string; requestHash: string }> {
  const [paymentDigest, requestHash] = await Promise.all([
    sha256Hex(paymentHeader.trim()),
    sha256Hex(canonicalJson(requestBody)),
  ]);
  return {
    receiptId: `shomer_${paymentDigest}`,
    requestHash,
  };
}

function parseResponseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function toRecord(row: PaidReceiptRow): PaidReceiptRecord {
  return {
    receiptId: row.receipt_id,
    requestHash: row.request_hash,
    state: row.state,
    responseStatus: row.response_status,
    responseBody: parseResponseJson(row.response_json),
    paymentResponseHeader: row.payment_response_header,
    transactionHash: row.transaction_hash,
    reportId: row.report_id,
    network: row.network,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

export async function getPaidReceipt(
  db: ReceiptDatabase,
  receiptId: string,
): Promise<PaidReceiptRecord | null> {
  const row = await db
    .prepare(
      `SELECT receipt_id, request_hash, state, response_status, response_json,
              payment_response_header, transaction_hash, report_id, network,
              created_at, updated_at, last_error
         FROM paid_receipts
        WHERE receipt_id = ?`,
    )
    .bind(receiptId)
    .first<PaidReceiptRow>();
  return row ? toRecord(row) : null;
}

export async function beginPaidReceipt(
  db: ReceiptDatabase,
  identity: { receiptId: string; requestHash: string },
): Promise<PaidReceiptRecord> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO paid_receipts
        (receipt_id, request_hash, state, created_at, updated_at)
       VALUES (?, ?, 'processing', ?, ?)`,
    )
    .bind(identity.receiptId, identity.requestHash, now, now)
    .run();
  const record = await getPaidReceipt(db, identity.receiptId);
  if (!record) throw new Error('Receipt record could not be created.');
  return record;
}

export async function savePaidReport(
  db: ReceiptDatabase,
  input: {
    receiptId: string;
    responseStatus: number;
    responseBody: Record<string, unknown>;
    reportId: string | null;
    network: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE paid_receipts
          SET state = 'report_ready', response_status = ?, response_json = ?,
              report_id = ?, network = ?, updated_at = ?, last_error = NULL
        WHERE receipt_id = ?`,
    )
    .bind(
      input.responseStatus,
      JSON.stringify(input.responseBody),
      input.reportId,
      input.network,
      new Date().toISOString(),
      input.receiptId,
    )
    .run();
}

export async function savePaidSettlement(
  db: ReceiptDatabase,
  input: {
    receiptId: string;
    responseBody: Record<string, unknown>;
    paymentResponseHeader: string | null;
    transactionHash: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE paid_receipts
          SET state = 'settled', response_json = ?, payment_response_header = ?,
              transaction_hash = ?, updated_at = ?, last_error = NULL
        WHERE receipt_id = ?`,
    )
    .bind(
      JSON.stringify(input.responseBody),
      input.paymentResponseHeader,
      input.transactionHash,
      new Date().toISOString(),
      input.receiptId,
    )
    .run();
}

export async function savePaidReceiptError(
  db: ReceiptDatabase,
  receiptId: string,
  error: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE paid_receipts
          SET last_error = ?, updated_at = ?
        WHERE receipt_id = ?`,
    )
    .bind(error.slice(0, 500), new Date().toISOString(), receiptId)
    .run();
}

