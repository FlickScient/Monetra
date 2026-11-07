import { NextResponse } from 'next/server';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { POST as createTransfer } from '@/app/api/transfers/route';
import { getWorkspaceContext } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PushOperation = {
  operationId: string;
  type: 'transaction.create' | 'transfer.create';
  payload: Record<string, unknown>;
};

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isRecord(body) || !Array.isArray(body.operations) || body.operations.length < 1 || body.operations.length > 25) {
    return NextResponse.json({ error: 'Provide between 1 and 25 sync operations' }, { status: 400 });
  }

  const operations = body.operations as unknown[];
  const seen = new Set<string>();
  const validated: PushOperation[] = [];

  for (const value of operations) {
    if (!isRecord(value) || typeof value.operationId !== 'string' ||
        !OPERATION_ID.test(value.operationId) ||
        (value.type !== 'transaction.create' && value.type !== 'transfer.create') ||
        !isRecord(value.payload)) {
      return NextResponse.json({ error: 'Each operation needs a UUID operationId, a supported type, and an object payload' }, { status: 400 });
    }
    if (seen.has(value.operationId)) {
      return NextResponse.json({ error: 'Duplicate operationId in this batch' }, { status: 400 });
    }
    seen.add(value.operationId);
    validated.push(value as PushOperation);
  }

  const context = await getWorkspaceContext(req);
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  // Each command is executed by the same server handler as the web app. Those
  // handlers own the wallet locks, journal postings, validation and durable
  // idempotency check; this endpoint never writes financial rows itself.
  const results: Array<{
    operationId: string;
    type: PushOperation['type'];
    ok: boolean;
    status: number;
    result?: unknown;
    error?: string;
  }> = [];

  for (const operation of validated) {
    const headers = new Headers({
      'content-type': 'application/json',
      'x-workspace-id': context.workspaceId,
      'idempotency-key': operation.operationId,
    });
    const cookie = req.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);

    const internalRequest = new Request(new URL(
      operation.type === 'transaction.create' ? '/api/transactions' : '/api/transfers',
      req.url,
    ), {
      method: 'POST',
      headers,
      body: JSON.stringify(operation.payload),
    });

    try {
      const response = operation.type === 'transaction.create'
        ? await createTransaction(internalRequest)
        : await createTransfer(internalRequest);
      const data = await response.json().catch(() => null);
      const ok = response.status >= 200 && response.status < 300;
      results.push({
        operationId: operation.operationId,
        type: operation.type,
        ok,
        status: response.status,
        ...(ok ? { result: data } : { error: isRecord(data) && typeof data.error === 'string' ? data.error : 'Operation was rejected' }),
      });
    } catch {
      // The client must retain and retry this operation ID. The underlying
      // command may have committed before a transport/runtime failure.
      results.push({
        operationId: operation.operationId,
        type: operation.type,
        ok: false,
        status: 503,
        error: 'Outcome is uncertain. Retry with the same operationId; do not create a new one.',
      });
    }
  }

  const failed = results.some((result) => !result.ok);
  return NextResponse.json({
    workspaceId: context.workspaceId,
    results,
    complete: !failed,
  }, {
    status: failed ? 207 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
