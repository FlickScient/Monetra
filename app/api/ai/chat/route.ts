import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createHmac, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getWorkspaceContext } from "@/lib/workspace";
import { db } from "@/db";
import { categories, transactions, wallets } from "@/db/schema";
import { dueDebts, dueDebtPayments, goalAllocations, savingsGoals } from "@/db/modules-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Message = { role: "user" | "model"; content: string };

const requestBuckets = new Map<string, number[]>();

function isRateLimited(userId: string) {
  const now = Date.now();
  const recent = (requestBuckets.get(userId) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 10) {
    requestBuckets.set(userId, recent);
    return true;
  }
  recent.push(now);
  requestBuckets.set(userId, recent);
  if (requestBuckets.size > 1500) {
    requestBuckets.forEach((times, id) => {
      if (!times.length || now - times[times.length - 1] >= 10 * 60 * 1000) requestBuckets.delete(id);
    });
  }
  return false;
}

async function invokeFiscus(
  action: "chat" | "restore" | "clear",
  context: { userId: string; workspaceId: string },
  payload: Record<string, unknown> = {},
) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const sharedSecret = process.env.FISCUS_EDGE_SHARED_SECRET;

  if (!supabaseUrl || !publishableKey || !sharedSecret || sharedSecret.length < 32) {
    return NextResponse.json({
      error: "Fiscus Supabase connection is not configured yet.",
      code: "FISCUS_NOT_CONFIGURED",
    }, { status: 503 });
  }

  const { getToken } = await auth();
  const clerkToken = await getToken();
  if (!clerkToken) {
    return NextResponse.json({ error: "Your session has expired. Please sign in again.", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const requestId = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    ...payload,
    action,
    clerkUserId: context.userId,
    workspaceId: context.workspaceId,
    requestId,
  });
  const signature = createHmac("sha256", sharedSecret)
    .update(timestamp + "." + requestId + "." + body)
    .digest("hex");

  try {
    const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/functions/v1/fiscus-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + clerkToken,
        apikey: publishableKey,
        "x-fiscus-timestamp": timestamp,
        "x-fiscus-request-id": requestId,
        "x-fiscus-signature": signature,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json().catch(() => ({
      error: "Fiscus returned an unreadable response.",
      code: "INVALID_AI_RESPONSE",
    }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({
      error: "Fiscus could not reach its AI backend. Please try again shortly.",
      code: "FISCUS_CONNECTION_ERROR",
    }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const context = await getWorkspaceContext(request);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  return invokeFiscus("restore", context);
}

export async function DELETE(request: Request) {
  const context = await getWorkspaceContext(request);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  return invokeFiscus("clear", context);
}

export async function POST(request: Request) {
  const context = await getWorkspaceContext(request);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });

  if (isRateLimited(context.userId)) {
    return NextResponse.json({
      error: "Fiscus has a temporary limit of 10 messages per 10 minutes. Please wait a little and try again.",
      code: "RATE_LIMITED",
    }, { status: 429 });
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) {
    return NextResponse.json({ error: "Send between 1 and 12 recent messages." }, { status: 400 });
  }

  const messages: Message[] = [];
  let total = 0;
  for (const item of body.messages) {
    if (!item || typeof item !== "object") {
      return NextResponse.json({ error: "Invalid message." }, { status: 400 });
    }
    const role = (item as Record<string, unknown>).role;
    const content = (item as Record<string, unknown>).content;
    if (
      (role !== "user" && role !== "model") ||
      typeof content !== "string" ||
      !content.trim() ||
      content.length > 3000
    ) {
      return NextResponse.json({ error: "Invalid message." }, { status: 400 });
    }
    total += content.length;
    messages.push({ role, content: content.trim() });
  }

  if (messages[messages.length - 1].role !== "user" || total > 14000) {
    return NextResponse.json({
      error: "Latest message must be from you; conversation is too long.",
    }, { status: 400 });
  }

  try {
    const txFilter = and(
      eq(transactions.workspaceId, context.workspaceId),
      eq(transactions.userId, context.userId),
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
          eq(wallets.workspaceId, context.workspaceId),
          eq(wallets.userId, context.userId),
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
          eq(categories.workspaceId, context.workspaceId),
          eq(categories.userId, context.userId),
        ))
        .leftJoin(wallets, and(
          eq(wallets.id, transactions.walletId),
          eq(wallets.workspaceId, context.workspaceId),
          eq(wallets.userId, context.userId),
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
          eq(categories.workspaceId, context.workspaceId),
          eq(categories.userId, context.userId),
        ))
        .where(and(txFilter, eq(transactions.transactionType, "expense")))
        .groupBy(categories.name)
        .orderBy(sql`SUM(${transactions.amountMinor}) DESC`),
      db.select({
        direction: dueDebts.direction,
        counterparty: dueDebts.counterpartyName,
        amountMinor: dueDebts.principalMinor,
        paidMinor: sql<string>`(SELECT COALESCE(SUM(${dueDebtPayments.amountMinor}), 0)::text FROM ${dueDebtPayments} WHERE ${dueDebtPayments.dueDebtId} = ${dueDebts.id} AND ${dueDebtPayments.workspaceId} = ${context.workspaceId} AND ${dueDebtPayments.userId} = ${context.userId})`,
        currency: dueDebts.currency,
        dueDate: dueDebts.dueDate,
        status: dueDebts.status,
        note: dueDebts.note,
      })
        .from(dueDebts)
        .where(and(
          eq(dueDebts.workspaceId, context.workspaceId),
          eq(dueDebts.userId, context.userId),
          sql`${dueDebts.status} <> 'archived'`,
        )),
      db.select({
        name: savingsGoals.name,
        targetMinor: savingsGoals.targetMinor,
        allocatedMinor: sql<string>`(SELECT COALESCE(SUM(${goalAllocations.amountMinor}), 0)::text FROM ${goalAllocations} WHERE ${goalAllocations.goalId} = ${savingsGoals.id} AND ${goalAllocations.workspaceId} = ${context.workspaceId})`,
        currency: savingsGoals.currency,
        targetDate: savingsGoals.targetDate,
        status: savingsGoals.status,
      })
        .from(savingsGoals)
        .where(and(
          eq(savingsGoals.workspaceId, context.workspaceId),
          eq(savingsGoals.userId, context.userId),
          eq(savingsGoals.status, "active"),
        )),
    ]);

    const financeContext = {
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
    };

    return invokeFiscus("chat", context, { messages, financeContext });
  } catch (error) {
    console.error(
      "MONETRA_FISCUS_CONTEXT_ERROR",
      error instanceof Error ? error.name : "unknown",
    );
    return NextResponse.json({
      error: "Monetra could not prepare the selected workspace's financial context.",
      code: "AI_DATA_ERROR",
    }, { status: 500 });
  }
}
