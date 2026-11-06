import { NextResponse } from "next/server";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions, wallets, workspaces } from "@/db/schema";
import { dueDebts, dueDebtPayments, goalAllocations, savingsGoals } from "@/db/modules-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContextRequest = {
  clerkUserId?: string;
  workspaceId?: string;
  requestId?: string;
  includeFinancialContext?: boolean;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function verifySignature(secret: string, timestamp: string, requestId: string, rawBody: string, signature: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret)
    .update(timestamp + "." + requestId + "." + rawBody)
    .digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  const secret = process.env.FISCUS_EDGE_SHARED_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "Context service is not configured." }, { status: 503 });
  }

  const timestamp = request.headers.get("x-fiscus-timestamp") || "";
  const requestId = request.headers.get("x-fiscus-request-id") || "";
  const signature = request.headers.get("x-fiscus-signature") || "";
  const timestampNumber = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isInteger(timestampNumber) ||
    Math.abs(nowSeconds - timestampNumber) > 60 ||
    !isUuid(requestId)
  ) {
    return NextResponse.json({ error: "Invalid signed request." }, { status: 401 });
  }

  const rawBody = await request.text();
  if (rawBody.length > 12000) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  if (!verifySignature(secret, timestamp, requestId, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signed request." }, { status: 401 });
  }

  let body: ContextRequest;
  try {
    body = JSON.parse(rawBody) as ContextRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (
    body.requestId !== requestId ||
    typeof body.clerkUserId !== "string" ||
    !body.clerkUserId.startsWith("user_") ||
    typeof body.workspaceId !== "string" ||
    !isUuid(body.workspaceId)
  ) {
    return NextResponse.json({ error: "Invalid identity or workspace." }, { status: 400 });
  }

  try {
    const [ownedWorkspace] = await db.select({ id: workspaces.id })
      .from(workspaces)
      .where(and(
        eq(workspaces.id, body.workspaceId),
        eq(workspaces.userId, body.clerkUserId),
      ))
      .limit(1);

    if (!ownedWorkspace) {
      return NextResponse.json({ authorized: false }, { status: 403 });
    }

    if (body.includeFinancialContext !== true) {
      return NextResponse.json({ authorized: true }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const txFilter = and(
      eq(transactions.workspaceId, body.workspaceId),
      eq(transactions.userId, body.clerkUserId),
      isNull(transactions.voidedAt),
    );

    const [walletRows, recentRows, monthlyRows, categoryRows, debtRows, goalRows] = await Promise.all([
      db.select({
        name: wallets.name,
        type: wallets.walletType,
        currency: wallets.currency,
        openingBalanceMinor: wallets.openingBalanceMinor,
        currentBalanceMinor: wallets.currentBalanceMinor,
        status: wallets.status,
      })
        .from(wallets)
        .where(and(
          eq(wallets.workspaceId, body.workspaceId),
          eq(wallets.userId, body.clerkUserId),
          eq(wallets.status, "active"),
        )),
      db.select({
        type: transactions.transactionType,
        amountMinor: transactions.amountMinor,
        description: transactions.description,
        date: transactions.occurredAt,
        category: categories.name,
        wallet: wallets.name,
      })
        .from(transactions)
        .leftJoin(categories, and(
          eq(categories.id, transactions.categoryId),
          eq(categories.workspaceId, body.workspaceId),
          eq(categories.userId, body.clerkUserId),
        ))
        .leftJoin(wallets, and(
          eq(wallets.id, transactions.walletId),
          eq(wallets.workspaceId, body.workspaceId),
          eq(wallets.userId, body.clerkUserId),
        ))
        .where(txFilter)
        .orderBy(desc(transactions.occurredAt))
        .limit(150),
      db.select({
        month: sql<string>`to_char(date_trunc('month', ${transactions.occurredAt} + interval '6 hours'), 'YYYY-MM')`,
        type: transactions.transactionType,
        totalMinor: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)::text`,
        count: sql<number>`COUNT(*)::int`,
      })
        .from(transactions)
        .where(txFilter)
        .groupBy(
          sql`date_trunc('month', ${transactions.occurredAt} + interval '6 hours')`,
          transactions.transactionType,
        )
        .orderBy(sql`date_trunc('month', ${transactions.occurredAt} + interval '6 hours')`),
      db.select({
        category: sql<string>`COALESCE(${categories.name}, 'Uncategorized')`,
        totalMinor: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)::text`,
        count: sql<number>`COUNT(*)::int`,
      })
        .from(transactions)
        .leftJoin(categories, and(
          eq(categories.id, transactions.categoryId),
          eq(categories.workspaceId, body.workspaceId),
          eq(categories.userId, body.clerkUserId),
        ))
        .where(and(txFilter, eq(transactions.transactionType, "expense")))
        .groupBy(categories.name)
        .orderBy(sql`SUM(${transactions.amountMinor}) DESC`),
      db.select({
        direction: dueDebts.direction,
        counterparty: dueDebts.counterpartyName,
        amountMinor: dueDebts.principalMinor,
        paidMinor: sql<string>`(SELECT COALESCE(SUM(${dueDebtPayments.amountMinor}), 0)::text FROM ${dueDebtPayments} WHERE ${dueDebtPayments.dueDebtId} = ${dueDebts.id} AND ${dueDebtPayments.workspaceId} = ${body.workspaceId} AND ${dueDebtPayments.userId} = ${body.clerkUserId})`,
        currency: dueDebts.currency,
        dueDate: dueDebts.dueDate,
        status: dueDebts.status,
        note: dueDebts.note,
      })
        .from(dueDebts)
        .where(and(
          eq(dueDebts.workspaceId, body.workspaceId),
          eq(dueDebts.userId, body.clerkUserId),
          sql`${dueDebts.status} <> 'archived'`,
        )),
      db.select({
        name: savingsGoals.name,
        targetMinor: savingsGoals.targetMinor,
        allocatedMinor: sql<string>`(SELECT COALESCE(SUM(${goalAllocations.amountMinor}), 0)::text FROM ${goalAllocations} WHERE ${goalAllocations.goalId} = ${savingsGoals.id} AND ${goalAllocations.workspaceId} = ${body.workspaceId})`,
        currency: savingsGoals.currency,
        targetDate: savingsGoals.targetDate,
        status: savingsGoals.status,
      })
        .from(savingsGoals)
        .where(and(
          eq(savingsGoals.workspaceId, body.workspaceId),
          eq(savingsGoals.userId, body.clerkUserId),
          eq(savingsGoals.status, "active"),
        )),
    ]);

    return NextResponse.json({
      authorized: true,
      financeContext: {
        amountsAreMinorUnits: true,
        wallets: walletRows,
        monthlyTransactionTotals: monthlyRows,
        allTimeExpenseCategories: categoryRows,
        recentTransactions: recentRows,
        debts: debtRows.map((debt) => ({
          ...debt,
          outstandingMinor: Math.max(0, Number(debt.amountMinor) - Number(debt.paidMinor)),
        })),
        savingsGoals: goalRows,
        coverage: "Monthly and category aggregates cover all recorded transactions; detailed transaction rows are the latest 150 only.",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      "MONETRA_FISCUS_CONTEXT_ERROR",
      error instanceof Error ? error.name : "unknown",
    );
    return NextResponse.json({
      authorized: false,
      error: "Financial context is temporarily unavailable.",
    }, { status: 500 });
  }
}
