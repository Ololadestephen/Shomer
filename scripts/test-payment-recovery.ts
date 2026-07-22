import assert from 'node:assert/strict';
import {
  beginPaidReceipt,
  getPaidReceipt,
  paymentReceiptIdentity,
  savePaidReceiptError,
  savePaidReport,
  savePaidSettlement,
  type ReceiptDatabase,
  type ReceiptStatement,
} from '../server/paymentReceipts';

type Row = Record<string, unknown>;

class MemoryStatement implements ReceiptStatement {
  constructor(
    private readonly db: MemoryReceiptDatabase,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): ReceiptStatement {
    return new MemoryStatement(this.db, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    const id = String(this.values[0] ?? '');
    return (this.db.rows.get(id) as T | undefined) ?? null;
  }

  async run(): Promise<unknown> {
    if (this.sql.includes('INSERT OR IGNORE')) {
      const [receiptId, requestHash, createdAt, updatedAt] = this.values.map(String);
      if (!this.db.rows.has(receiptId)) {
        this.db.rows.set(receiptId, {
          receipt_id: receiptId,
          request_hash: requestHash,
          state: 'processing',
          response_status: null,
          response_json: null,
          payment_response_header: null,
          transaction_hash: null,
          report_id: null,
          network: null,
          created_at: createdAt,
          updated_at: updatedAt,
          last_error: null,
        });
      }
      return {};
    }

    const receiptId = String(this.values.at(-1) ?? '');
    const row = this.db.rows.get(receiptId);
    if (!row) throw new Error(`missing fixture receipt ${receiptId}`);
    if (this.sql.includes("state = 'report_ready'")) {
      const [status, responseJson, reportId, network, updatedAt] = this.values;
      Object.assign(row, {
        state: 'report_ready',
        response_status: status,
        response_json: responseJson,
        report_id: reportId,
        network,
        updated_at: updatedAt,
        last_error: null,
      });
    } else if (this.sql.includes("state = 'settled'")) {
      const [responseJson, responseHeader, transactionHash, updatedAt] = this.values;
      Object.assign(row, {
        state: 'settled',
        response_json: responseJson,
        payment_response_header: responseHeader,
        transaction_hash: transactionHash,
        updated_at: updatedAt,
        last_error: null,
      });
    } else if (this.sql.includes('last_error = ?')) {
      const [lastError, updatedAt] = this.values;
      Object.assign(row, { last_error: lastError, updated_at: updatedAt });
    }
    return {};
  }
}

class MemoryReceiptDatabase implements ReceiptDatabase {
  readonly rows = new Map<string, Row>();

  prepare(query: string): ReceiptStatement {
    return new MemoryStatement(this, query);
  }
}

const db = new MemoryReceiptDatabase();
const paymentAuthorization = 'fixture-payment-authorization-never-persisted';
const requestA = {
  contractAddress: '0x1111111111111111111111111111111111111111',
  network: 'mainnet',
  policy: { owner: '0x2222222222222222222222222222222222222222' },
};
const reorderedRequestA = {
  policy: { owner: '0x2222222222222222222222222222222222222222' },
  network: 'mainnet',
  contractAddress: '0x1111111111111111111111111111111111111111',
};
const requestB = { ...requestA, projectName: 'Different request' };

const identityA = await paymentReceiptIdentity(paymentAuthorization, requestA);
const reorderedIdentity = await paymentReceiptIdentity(
  paymentAuthorization,
  reorderedRequestA,
);
const identityB = await paymentReceiptIdentity(paymentAuthorization, requestB);

assert.equal(identityA.receiptId, reorderedIdentity.receiptId);
assert.equal(identityA.requestHash, reorderedIdentity.requestHash);
assert.equal(identityA.receiptId, identityB.receiptId);
assert.notEqual(identityA.requestHash, identityB.requestHash);
console.log('ok: request hashing is canonical and detects payment replay mismatches');

let receipt = await beginPaidReceipt(db, identityA);
assert.equal(receipt.state, 'processing');

const reportBody = {
  ok: true,
  verdict: 'policy_matched',
  deepVerification: {
    auditorBrief: { reportId: 'shomer-196-12345-fixture' },
  },
};
await savePaidReport(db, {
  receiptId: identityA.receiptId,
  responseStatus: 200,
  responseBody: reportBody,
  reportId: 'shomer-196-12345-fixture',
  network: 'eip155:196',
});
receipt = (await getPaidReceipt(db, identityA.receiptId))!;
assert.equal(receipt.state, 'report_ready');
assert.deepEqual(receipt.responseBody, reportBody);
console.log('ok: generated report is durable before settlement');

await savePaidReceiptError(db, identityA.receiptId, 'temporary timeout');
receipt = (await getPaidReceipt(db, identityA.receiptId))!;
assert.equal(receipt.lastError, 'temporary timeout');
assert.equal(receipt.state, 'report_ready');

const transactionHash = `0x${'ab'.repeat(32)}`;
const finalBody = {
  ...reportBody,
  payment: {
    settled: true,
    transactionHash,
    receiptId: identityA.receiptId,
  },
};
await savePaidSettlement(db, {
  receiptId: identityA.receiptId,
  responseBody: finalBody,
  paymentResponseHeader: 'fixture-payment-response',
  transactionHash,
});
receipt = (await getPaidReceipt(db, identityA.receiptId))!;
assert.equal(receipt.state, 'settled');
assert.equal(receipt.transactionHash, transactionHash);
assert.deepEqual(receipt.responseBody, finalBody);
assert.equal(receipt.lastError, null);
console.log('ok: settlement transaction and report survive a simulated client timeout');

const repeated = await beginPaidReceipt(db, identityA);
assert.equal(repeated.state, 'settled');
assert.equal(repeated.transactionHash, transactionHash);
assert.doesNotMatch(
  JSON.stringify([...db.rows.values()]),
  new RegExp(paymentAuthorization),
);
console.log('ok: retries recover the settled result without storing authorization secrets');

