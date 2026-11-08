import { NextResponse } from 'next/server';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { POST as createTransfer } from '@/app/api/transfers/route';
import { POST as createDebtPayment } from '@/app/api/due-debt/[id]/payments/route';
import { getWorkspaceContext } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PushOperation = {
  operationId: string;
  type: 'transaction.create' | 'transfer.create' | 'debt.payment';
  payload: Record<string, unknown>;
};
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  if (!isRecord(body) || !Array.isArray(body.operations) || body.operations.length < 1 || body.operations.length > 25)
    return NextResponse.json({ error: 'Provide between 1 and 25 sync operations' }, { status: 400 });

  const seen = new Set<string>();
  const validated: PushOperation[] = [];
  for (const value of body.operations) {
    if (!isRecord(value) || typeof value.operationId !== 'string' || !OPERATION_ID.test(value.operationId) ||
      (value.type !== 'transaction.create' && value.type !== 'transfer.create' && value.type !== 'debt.payment') ||
      !isRecord(value.payload))
      return NextResponse.json({ error: 'Each operation needs a UUID operationId, a supported type, and an object payload' }, { status: 400 });
    if (seen.has(value.operationId)) return NextResponse.json({ error: 'Duplicate operationId in this batch' }, { status: 400 });
    seen.add(value.operationId);
    validated.push(value as PushOperation);
  }

  const context = await getWorkspaceContext(req);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  const results: Array<{ operationId: string; type: PushOperation['type']; ok: boolean; status: number; result?: unknown; error?: string }> = [];
  for (const operation of validated) {
    const headers = new Headers({
      'content-type': 'application/json', 'x-workspace-id': context.workspaceId,
      'idempotency-key': operation.operationId,
    });
    const cookie = req.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);
    const authorization = req.headers.get('authorization');
    if (authorization) headers.set('authorization', authorization);

    const debtId = operation.type === 'debt.payment' ? operation.payload.dueDebtId : null;
    if (operation.type === 'debt.payment' && (typeof debtId !== 'string' || !OPERATION_ID.test(debtId))) {
      results.push({ operationId: operation.operationId, type: operation.type, ok: false, status: 400, error: 'debt.payment requires a valid dueDebtId' });
      continue;
    }
    const internalRequest = new Request(new URL(
      operation.type === 'transaction.create' ? '/api/transactions' :
      operation.type === 'transfer.create' ? '/api/transfers' : `/api/due-debt/${debtId}/payments`, req.url),
      { method: 'POST', headers, body: JSON.stringify(operation.payload) });

    try {
      const response = operation.type === 'transaction.create' ? await createTransaction(internalRequest) :
        operation.type === 'transfer.create' ? await createTransfer(internalRequest) :
        await createDebtPayment(internalRequest, { params: { id: String(debtId) } });
      const data = await response.json().catch(() => null);
      const ok = response.status >= 200 && response.status < 300;
      results.push({ operationId: operation.operationId, type: operation.type, ok, status: response.status,
        ...(ok ? { result: data } : { error: isRecord(data) && typeof data.error === 'string' ? data.error : 'Operation was rejected' }) });
    } catch {
      results.push({ operationId: operation.operationId, type: operation.type, ok: false, status: 503,
        error: 'Outcome is uncertain. Retry with the same operationId; do not create a new one.' });
    }
  }

  const failed = results.some(result => !result.ok);
  return NextResponse.json({ workspaceId: context.workspaceId, results, complete: !failed },
    { status: failed ? 207 : 200, headers: { 'Cache-Control': 'no-store' } });
}
