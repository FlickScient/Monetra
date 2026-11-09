import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { AuthView, UserButton } from "@clerk/expo/native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaView } from "react-native-safe-area-context";
import { readAllCachedWorkspaces, readCachedWorkspace } from "@/lib/database";
import { pendingOperationCount, queueOfflineOperation, syncWorkspace, type SyncResult } from "@/lib/sync";
import { FiscusPanel } from "@/components/fiscus-panel";

type Workspace = { id: string; name: string; type: string };
type Snapshot = { cursor: string; data: Record<string, any[]> };
const API = (process.env.EXPO_PUBLIC_MONETRA_API_URL || "https://monetra-4rax.vercel.app").replace(/\/+$/, "");
const P = { bg: "#F4F3EC", paper: "#FFFFFF", ink: "#20251D", muted: "#788071", olive: "#596344", soft: "#E8EBDD", line: "#E7E8DF", green: "#327A55", red: "#B64D43" };

const money = (minor: number, currency = "BDT") => {
  try { return new Intl.NumberFormat("en-BD", { style: "currency", currency, maximumFractionDigits: 0 }).format((Number(minor) || 0) / 100); }
  catch { return "৳" + ((Number(minor) || 0) / 100).toLocaleString("en-BD"); }
};

export default function HomeScreen() {
  const { isLoaded, isSignedIn, getToken } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const [authOpen, setAuthOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sync, setSync] = useState<SyncResult>({ status: "offline", message: "Waiting for first sync" });
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "wallets" | "activity" | "more" | "debts" | "goals" | "budgets" | "reports" | "settings" | "fiscus">("overview");
  const [transactionModal, setTransactionModal] = useState(false);
  const [txType, setTxType] = useState<"income" | "expense" | "transfer">("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txDescription, setTxDescription] = useState("");
  const [txWalletId, setTxWalletId] = useState("");
  const [txDestinationWalletId, setTxDestinationWalletId] = useState("");
  const [txCategoryId, setTxCategoryId] = useState("");
  const [txSaving, setTxSaving] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentDebtId, setPaymentDebtId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentSaving, setPaymentSaving] = useState(false);

  const loadLocal = useCallback(async (uid: string, id: string) => {
    const cached = await readCachedWorkspace(uid, id);
    if (cached) setSnapshot(JSON.parse(cached.snapshot_json) as Snapshot);
    setPending(await pendingOperationCount(uid, id));
  }, []);

  const syncNow = useCallback(async (id = workspaceId) => {
    if (!user?.id || !id) return;
    setRefreshing(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your sign-in session needs refreshing.");
      const result = await syncWorkspace(user.id, id, token);
      setSync(result);
      await loadLocal(user.id, id);
      if (result.status === "needs-attention") setError(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not synchronize.");
      await loadLocal(user.id, id);
    } finally { setRefreshing(false); }
  }, [getToken, loadLocal, user?.id, workspaceId]);

  const chooseWorkspace = useCallback(async (id: string) => {
    if (!user?.id) return;
    setWorkspaceId(id);
    await SecureStore.setItemAsync("monetra-active-workspace:" + user.id, id);
    await loadLocal(user.id, id);
    await syncNow(id);
  }, [loadLocal, syncNow, user?.id]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user?.id) return;
    let alive = true;
    void (async () => {
      try {
        const token = await getToken();
        let rows: Workspace[] = [];
        if (token && API) {
          try {
            const response = await fetch(API + "/api/workspaces", { headers: { Authorization: "Bearer " + token } });
            if (!response.ok) throw new Error("Finance workspaces could not be loaded.");
            rows = await response.json();
          } catch (networkError) {
            const cached = await readAllCachedWorkspaces(user.id);
            rows = cached.map((row) => {
              const data = JSON.parse(row.snapshot_json);
              return { id: row.workspace_id, name: data.workspace?.name ?? "Workspace", type: data.workspace?.type ?? "personal" };
            });
            if (!rows.length) throw networkError;
          }
        } else {
          const cached = await readAllCachedWorkspaces(user.id);
          rows = cached.map((row) => {
            const data = JSON.parse(row.snapshot_json);
            return { id: row.workspace_id, name: data.workspace?.name ?? "Workspace", type: data.workspace?.type ?? "personal" };
          });
        }
        if (!alive) return;
        setWorkspaces(rows);
        const saved = await SecureStore.getItemAsync("monetra-active-workspace:" + user.id);
        const active = rows.find((w) => w.id === saved) ?? rows.find((w) => w.type === "personal") ?? rows[0];
        if (!active) throw new Error("No offline copy exists yet. Connect once to download your workspaces.");
        setWorkspaceId(active.id);
        await loadLocal(user.id, active.id);
        if (token) {
          const result = await syncWorkspace(user.id, active.id, token);
          if (alive) setSync(result);
          await loadLocal(user.id, active.id);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Monetra could not start.");
      }
    })();
    return () => { alive = false; };
  }, [isLoaded, isSignedIn, user?.id, getToken, loadLocal]);

  const data = snapshot?.data ?? {};
  const wallets = data.wallets ?? [];
  const transactions = [...(data.transactions ?? [])].filter((x) => !x.voidedAt).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const income = transactions.filter((x) => x.transactionType === "income").reduce((sum, x) => sum + Number(x.amountMinor || 0), 0);
  const expense = transactions.filter((x) => x.transactionType === "expense").reduce((sum, x) => sum + Number(x.amountMinor || 0), 0);
  const balance = wallets.filter((x) => x.status === "active").reduce((sum, x) => sum + Number(x.currentBalanceMinor || 0), 0);
  const active = workspaces.find((w) => w.id === workspaceId);
  const debts = data.dueDebts ?? [];
  const payments = data.dueDebtPayments ?? [];
  const goals = data.savingsGoals ?? [];
  const allocations = data.goalAllocations ?? [];
  const budgets = data.monthlyBudgets ?? [];
  const categories = data.categories ?? [];
  const debtOutstanding = (debt: any) => Math.max(0, Number(debt.principalMinor || 0) - payments.filter((p) => p.dueDebtId === debt.id).reduce((sum, p) => sum + Number(p.amountMinor || 0), 0));
  const allocatedFor = (goal: any) => allocations.filter((a) => a.goalId === goal.id).reduce((sum, a) => sum + Number(a.amountMinor || 0), 0);

  async function saveTransaction() {
    if (!user?.id || !workspaceId || txSaving) return;
    const amount = Number(txAmount.replace(/,/g, ""));
    const amountMinor = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amountMinor <= 0 || !Number.isSafeInteger(amountMinor)) {
      setError("Enter a valid amount greater than zero.");
      return;
    }
    if (!txWalletId) {
      setError("Choose a wallet before saving.");
      return;
    }
    if (txType === "transfer" && (!txDestinationWalletId || txDestinationWalletId === txWalletId)) {
      setError("Choose a different destination wallet.");
      return;
    }
    if (!txDescription.trim()) {
      setError("Add a short description.");
      return;
    }
    setTxSaving(true);
    setError("");
    try {
      await queueOfflineOperation({
        userId: user.id,
        workspaceId,
        type: txType === "transfer" ? "transfer.create" : "transaction.create",
        payload: txType === "transfer" ? {
          walletId: txWalletId,
          destinationWalletId: txDestinationWalletId,
          amountMinor,
          description: txDescription.trim(),
          occurredAt: new Date().toISOString()
        } : {
          walletId: txWalletId,
          transactionType: txType,
          amountMinor,
          categoryId: txCategoryId || null,
          description: txDescription.trim(),
          occurredAt: new Date().toISOString()
        }
      });
      setTransactionModal(false);
      setTxAmount("");
      setTxDescription("");
      setTxCategoryId("");
      setTxDestinationWalletId("");
      await loadLocal(user.id, workspaceId);
      await syncNow(workspaceId);
      setTab("overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this transaction locally.");
    } finally { setTxSaving(false); }
  }

  async function saveDebtPayment() {
    if (!user?.id || !workspaceId || !paymentDebtId || paymentSaving) return;
    const amount = Number(paymentAmount.replace(/,/g, ""));
    const amountMinor = Math.round(amount * 100);
    const debt = debts.find((item) => item.id === paymentDebtId);
    if (!Number.isFinite(amount) || amountMinor <= 0 || !Number.isSafeInteger(amountMinor)) {
      setError("Enter a valid payment amount.");
      return;
    }
    if (!debt || amountMinor > debtOutstanding(debt)) {
      setError("Payment cannot exceed the outstanding amount.");
      return;
    }
    setPaymentSaving(true);
    setError("");
    try {
      await queueOfflineOperation({
        userId: user.id,
        workspaceId,
        type: "debt.payment",
        payload: {
          dueDebtId: paymentDebtId,
          amountMinor,
          paidAt: new Date().toISOString(),
          paymentMethod,
          note: paymentNote.trim() || null
        }
      });
      setPaymentModal(false);
      setPaymentAmount("");
      setPaymentNote("");
      await loadLocal(user.id, workspaceId);
      await syncNow(workspaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the payment locally.");
    } finally { setPaymentSaving(false); }
  }

  if (!isLoaded) return <View style={s.center}><ActivityIndicator color={P.olive} size="large" /></View>;
  if (!isSignedIn) return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={s.auth}>
        <View style={s.mark}><Text style={s.markText}>M</Text></View>
        <Text style={s.brand}>monetra</Text>
        <Text style={s.tagline}>Your money. Clearer.</Text>
        <Text style={s.copy}>One calm place for every wallet, every decision, and every next move.</Text>
        <Pressable style={s.primary} onPress={() => setAuthOpen(true)}><Text style={s.primaryText}>Sign in or create account</Text></Pressable>
      </View>
      <Modal visible={authOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAuthOpen(false)}><AuthView onDismiss={() => setAuthOpen(false)} /></Modal>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={P.bg} />
      <View style={s.header}>
        <View><Text style={s.kicker}>YOUR FINANCIAL SPACE</Text><Text style={s.brandSmall}>monetra</Text></View>
        <View style={s.headerRight}>
          <View style={s.status}><View style={[s.dot, { backgroundColor: sync.status === "synced" ? P.green : sync.status === "needs-attention" ? "#B57B30" : P.muted }]} /><Text style={s.statusText}>{sync.status === "synced" ? "Synced" : sync.status === "needs-attention" ? "Attention" : "Offline"}</Text></View>
          <UserButton />
        </View>
      </View>
      <View style={s.workspaces}>
        {workspaces.map((w) => <Pressable key={w.id} onPress={() => void chooseWorkspace(w.id)} style={[s.chip, w.id === workspaceId && s.chipOn]}><Text style={[s.chipText, w.id === workspaceId && s.chipTextOn]}>{w.name}</Text></Pressable>)}
        <Pressable onPress={() => void syncNow()} style={s.syncButton}><Text style={s.syncButtonText}>↻</Text></Pressable>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void syncNow()} tintColor={P.olive} />}>
        {error ? <View style={s.alert}><Text style={s.alertText}>{error}</Text></View> : null}
        {tab === "overview" && <>
          <Text style={s.heading}>Good to see you{user?.firstName ? ", " + user.firstName : ""}.</Text>
          <Text style={s.subheading}>{active?.name ?? "Workspace"} · {new Date().toLocaleDateString("en-BD", { month: "long", year: "numeric" })}</Text>
          <View style={s.balance}>
            <Text style={s.balanceLabel}>TOTAL WALLET BALANCE</Text><Text style={s.balanceValue}>{money(balance)}</Text>
            <View style={s.balanceFoot}><Text style={s.balanceFootText}>{wallets.length} active wallets</Text><Text style={s.balanceFootText}>LIVE LEDGER</Text></View>
          </View>
          <View style={s.stats}>
            <View style={s.stat}><Text style={s.statLabel}>INCOME</Text><Text style={[s.statValue, { color: P.green }]}>{money(income)}</Text></View>
            <View style={s.stat}><Text style={s.statLabel}>EXPENSE</Text><Text style={[s.statValue, { color: P.red }]}>{money(expense)}</Text></View>
          </View>
          <View style={s.section}><Text style={s.sectionTitle}>Recent activity</Text><Pressable onPress={() => setTransactionModal(true)} style={s.addButton}><Text style={s.addButtonText}>＋ Add</Text></Pressable></View>
          {transactions.slice(0, 10).map((x) => <View key={x.id} style={s.row}>
            <View style={[s.txIcon, { backgroundColor: x.transactionType === "income" ? "#E5F0E7" : "#F6E9E5" }]}><Text style={{ color: x.transactionType === "income" ? P.green : P.red, fontWeight: "800" }}>{x.transactionType === "income" ? "↓" : "↑"}</Text></View>
            <View style={s.rowMain}><Text style={s.rowTitle}>{x.description || "Transaction"}</Text><Text style={s.muted}>{new Date(x.occurredAt).toLocaleDateString("en-BD", { day: "numeric", month: "short" })}</Text></View>
            <Text style={s.amount}>{x.transactionType === "expense" ? "−" : "+"}{money(Number(x.amountMinor || 0))}</Text>
          </View>)}
          {!snapshot && <Text style={s.empty}>Connect once to download your finance data for offline access.</Text>}
        </>}
        {tab === "wallets" && <>
          <Text style={s.heading}>Your wallets</Text><Text style={s.subheading}>Every balance, in one place.</Text>
          {wallets.map((w) => <View key={w.id} style={s.wallet}><View style={s.walletMark}><Text style={s.walletMarkText}>{String(w.name || "W").slice(0,1)}</Text></View><View style={s.rowMain}><Text style={s.rowTitle}>{w.name}</Text><Text style={s.muted}>{String(w.walletType || "wallet").replace(/_/g, " ")}</Text></View><Text style={s.amount}>{money(Number(w.currentBalanceMinor || 0), w.currency || "BDT")}</Text></View>)}
          {!wallets.length && <Text style={s.empty}>No wallets in this offline snapshot.</Text>}
        </>}
        {tab === "activity" && <>
          <Text style={s.heading}>Transactions</Text><Text style={s.subheading}>Latest records from your ledger.</Text>
          {transactions.map((x) => <View key={x.id} style={s.row}><View style={s.rowMain}><Text style={s.rowTitle}>{x.description || "Transaction"}</Text><Text style={s.muted}>{new Date(x.occurredAt).toLocaleString()}</Text></View><Text style={s.amount}>{money(Number(x.amountMinor || 0))}</Text></View>)}
        </>}
        {tab === "more" && <>
          <Text style={s.heading}>Your Monetra</Text><Text style={s.subheading}>Every part of your financial command centre.</Text>
          {([
            ["debts", "Due & debt", "Track money owed and payments"],
            ["goals", "Savings goals", "Progress and allocations"],
            ["budgets", "Monthly budgets", "Limits and category spending"],
            ["reports", "Reports & insights", "Income, expense and cash flow"],
            ["settings", "Settings", "Sync, account and app preferences"]
          ] as const).map(([key, title, subtitle]) => <Pressable key={key} onPress={() => setTab(key)} style={s.moreCard}><View style={s.moreMark}><Text style={s.moreMarkText}>{title.slice(0,1)}</Text></View><View style={s.rowMain}><Text style={s.rowTitle}>{title}</Text><Text style={s.muted}>{subtitle}</Text></View><Text style={s.moreArrow}>›</Text></Pressable>)}
        </>}
        {tab === "debts" && <>
          <Pressable onPress={() => setTab("more")}><Text style={s.backLink}>‹  More</Text></Pressable>
          <Text style={s.heading}>Due & debt</Text><Text style={s.subheading}>Outstanding amounts from your synced ledger.</Text>
          {debts.filter((d) => d.status !== "archived").map((debt) => <View key={debt.id} style={s.moduleCard}>
            <View style={s.section}><Text style={s.rowTitle}>{debt.counterpartyName}</Text><Text style={s.statusTag}>{debt.status}</Text></View>
            <Text style={s.muted}>{debt.direction === "receivable" ? "You should receive" : "You need to pay"} · {debt.dueDate || "No due date"}</Text>
            <Text style={s.moduleAmount}>{money(debtOutstanding(debt), debt.currency || "BDT")}</Text>
            <Text style={s.muted}>Original {money(Number(debt.principalMinor || 0), debt.currency || "BDT")} · Paid {money(Number(debt.principalMinor || 0) - debtOutstanding(debt), debt.currency || "BDT")}</Text>
            {debtOutstanding(debt) > 0 && <Pressable onPress={() => { setPaymentDebtId(debt.id); setPaymentModal(true); }} style={s.settingsButton}><Text style={s.settingsButtonText}>Record payment</Text></Pressable>}
          </View>)}
          {!debts.length && <Text style={s.empty}>No debt records in this workspace.</Text>}
        </>}
        {tab === "goals" && <>
          <Pressable onPress={() => setTab("more")}><Text style={s.backLink}>‹  More</Text></Pressable>
          <Text style={s.heading}>Savings goals</Text><Text style={s.subheading}>Your progress, backed by recorded allocations.</Text>
          {goals.map((goal) => {
            const saved = allocatedFor(goal);
            const target = Number(goal.targetMinor || 0);
            const percent = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0;
            return <View key={goal.id} style={s.moduleCard}><Text style={s.rowTitle}>{goal.name}</Text><Text style={s.moduleAmount}>{money(saved, goal.currency || "BDT")}</Text><Text style={s.muted}>of {money(target, goal.currency || "BDT")} · {percent}%</Text><View style={s.progressTrack}><View style={[s.progressFill, { width: percent + "%" }]} /></View><Text style={s.muted}>{goal.targetDate ? "Target " + goal.targetDate : "No target date"} · {goal.status}</Text></View>;
          })}
          {!goals.length && <Text style={s.empty}>No savings goals in this workspace.</Text>}
        </>}
        {tab === "budgets" && <>
          <Pressable onPress={() => setTab("more")}><Text style={s.backLink}>‹  More</Text></Pressable>
          <Text style={s.heading}>Monthly budgets</Text><Text style={s.subheading}>Budget limits compared with recorded spending.</Text>
          {budgets.map((budget) => {
            const category = categories.find((x) => x.id === budget.categoryId);
            const spent = transactions.filter((x) => x.transactionType === "expense" && x.categoryId === budget.categoryId && String(x.occurredAt).slice(0,7) === String(budget.monthStart).slice(0,7)).reduce((sum, x) => sum + Number(x.amountMinor || 0), 0);
            const limit = Number(budget.limitMinor || 0);
            const percent = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;
            return <View key={budget.id} style={s.moduleCard}><Text style={s.rowTitle}>{category?.name || "Category"}</Text><Text style={s.moduleAmount}>{money(spent)}</Text><Text style={s.muted}>of {money(limit)} · {budget.monthStart}</Text><View style={s.progressTrack}><View style={[s.progressFill, { width: percent + "%", backgroundColor: percent >= 100 ? P.red : P.olive }]} /></View><Text style={s.muted}>{Math.max(0, limit - spent) > 0 ? money(limit - spent) + " remaining" : "Budget limit reached"}</Text></View>;
          })}
          {!budgets.length && <Text style={s.empty}>No monthly budgets in this workspace.</Text>}
        </>}
        {tab === "reports" && <>
          <Pressable onPress={() => setTab("more")}><Text style={s.backLink}>‹  More</Text></Pressable>
          <Text style={s.heading}>Reports & insights</Text><Text style={s.subheading}>Based on the transactions currently synced to this device.</Text>
          <View style={s.reportCard}><Text style={s.statLabel}>TOTAL INCOME</Text><Text style={[s.moduleAmount, { color: P.green }]}>{money(income)}</Text></View>
          <View style={s.reportCard}><Text style={s.statLabel}>TOTAL EXPENSE</Text><Text style={[s.moduleAmount, { color: P.red }]}>{money(expense)}</Text></View>
          <View style={s.reportCard}><Text style={s.statLabel}>NET CASH FLOW</Text><Text style={s.moduleAmount}>{money(income - expense)}</Text></View>
          <Text style={s.formHint}>These totals cover the locally synchronized transaction history, not necessarily only the current month. Refresh to pull the latest Neon changes.</Text>
        </>}
        {tab === "settings" && <>
          <Pressable onPress={() => setTab("more")}><Text style={s.backLink}>‹  More</Text></Pressable>
          <Text style={s.heading}>Settings</Text><Text style={s.subheading}>App status and account information.</Text>
          <View style={s.moduleCard}><Text style={s.rowTitle}>Account</Text><Text style={s.muted}>{user?.primaryEmailAddress?.emailAddress || user?.id}</Text></View>
          <View style={s.moduleCard}><Text style={s.rowTitle}>Active workspace</Text><Text style={s.muted}>{active?.name || "Not selected"}</Text></View>
          <View style={s.moduleCard}><Text style={s.rowTitle}>Synchronization</Text><Text style={s.muted}>{sync.message}</Text><Text style={s.muted}>Last known cursor: {snapshot?.cursor || "Not downloaded"}</Text><Pressable onPress={() => void syncNow()} style={s.settingsButton}><Text style={s.settingsButtonText}>Sync now</Text></Pressable></View>
          <View style={s.moduleCard}><Text style={s.rowTitle}>Offline storage</Text><Text style={s.muted}>Your cached finance snapshot and Fiscus conversation copy are stored locally in this app, isolated by account and workspace.</Text></View>
        </>}
        {tab === "fiscus" && <FiscusPanel workspaceId={workspaceId} userId={user?.id ?? ""} getToken={getToken} />}

        <Text style={s.footer}>Pending sync actions: {pending} · {sync.message}</Text>
      </ScrollView>
      <Modal visible={transactionModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTransactionModal(false)}>
        <SafeAreaView style={s.modalScreen}>
          <View style={s.modalHeader}><Text style={s.modalTitle}>New transaction</Text><Pressable onPress={() => setTransactionModal(false)}><Text style={s.modalClose}>Close</Text></Pressable></View>
          <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
            <View style={s.typeSwitch}>
              {(["expense", "income", "transfer"] as const).map((type) => <Pressable key={type} onPress={() => { setTxType(type); setTxCategoryId(""); }} style={[s.typeOption, txType === type && s.typeOptionOn]}><Text style={[s.typeOptionText, txType === type && s.typeOptionTextOn]}>{type.toUpperCase()}</Text></Pressable>)}
            </View>
            <Text style={s.formLabel}>Amount (৳)</Text>
            <TextInput value={txAmount} onChangeText={setTxAmount} keyboardType="decimal-pad" placeholder="0.00" style={s.formInput} />
            <Text style={s.formLabel}>Description</Text>
            <TextInput value={txDescription} onChangeText={setTxDescription} placeholder="What was this for?" style={s.formInput} maxLength={500} />
            <Text style={s.formLabel}>{txType === "transfer" ? "From wallet" : "Wallet"}</Text>
            <View style={s.choiceWrap}>{wallets.filter((w) => w.status === "active").map((w) => <Pressable key={w.id} onPress={() => setTxWalletId(w.id)} style={[s.choice, txWalletId === w.id && s.choiceOn]}><Text style={[s.choiceText, txWalletId === w.id && s.choiceTextOn]}>{w.name}</Text></Pressable>)}</View>
            {txType === "transfer" ? <>
              <Text style={s.formLabel}>To wallet</Text>
              <View style={s.choiceWrap}>{wallets.filter((w) => w.status === "active" && w.id !== txWalletId).map((w) => <Pressable key={w.id} onPress={() => setTxDestinationWalletId(w.id)} style={[s.choice, txDestinationWalletId === w.id && s.choiceOn]}><Text style={[s.choiceText, txDestinationWalletId === w.id && s.choiceTextOn]}>{w.name}</Text></Pressable>)}</View>
            </> : <>
              <Text style={s.formLabel}>Category (optional)</Text>
              <View style={s.choiceWrap}>{(data.categories ?? []).filter((x) => x.categoryType === txType).map((category) => <Pressable key={category.id} onPress={() => setTxCategoryId(txCategoryId === category.id ? "" : category.id)} style={[s.choice, txCategoryId === category.id && s.choiceOn]}><Text style={[s.choiceText, txCategoryId === category.id && s.choiceTextOn]}>{category.name}</Text></Pressable>)}</View>
            </>}
            <Text style={s.formHint}>Offline entries are saved on this device and marked pending until Neon confirms synchronization.</Text>
            <Pressable disabled={txSaving} onPress={() => void saveTransaction()} style={[s.primary, txSaving && { opacity: 0.6 }]}><Text style={s.primaryText}>{txSaving ? "Saving…" : "Save transaction"}</Text></Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal visible={paymentModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPaymentModal(false)}>
        <SafeAreaView style={s.modalScreen}>
          <View style={s.modalHeader}><Text style={s.modalTitle}>Record debt payment</Text><Pressable onPress={() => setPaymentModal(false)}><Text style={s.modalClose}>Close</Text></Pressable></View>
          <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={s.formLabel}>Payment amount (৳)</Text>
            <TextInput value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" placeholder="0.00" style={s.formInput} />
            <Text style={s.formLabel}>Payment method</Text>
            <View style={s.choiceWrap}>{(["Cash", "Bank", "bKash", "Nagad", "Rocket", "Other"] as const).map((method) => <Pressable key={method} onPress={() => setPaymentMethod(method)} style={[s.choice, paymentMethod === method && s.choiceOn]}><Text style={[s.choiceText, paymentMethod === method && s.choiceTextOn]}>{method}</Text></Pressable>)}</View>
            <Text style={s.formLabel}>Note (optional)</Text>
            <TextInput value={paymentNote} onChangeText={setPaymentNote} placeholder="Add a note" style={s.formInput} maxLength={1000} />
            <Text style={s.formHint}>Saved locally while offline. The payment is only posted to Neon after server confirmation.</Text>
            <Pressable disabled={paymentSaving} onPress={() => void saveDebtPayment()} style={[s.primary, paymentSaving && { opacity: 0.6 }]}><Text style={s.primaryText}>{paymentSaving ? "Saving…" : "Save payment"}</Text></Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <View style={s.nav}>
        {(["overview", "wallets", "activity", "more", "fiscus"] as const).map((name) => <Pressable key={name} style={s.navItem} onPress={() => setTab(name)}><Text style={[s.navGlyph, tab === name && s.navActive]}>{name === "overview" ? "⌂" : name === "wallets" ? "▣" : name === "activity" ? "≡" : name === "more" ? "•••" : "✳"}</Text><Text style={[s.navText, tab === name && s.navActive]}>{name === "fiscus" ? "Fiscus" : name[0].toUpperCase() + name.slice(1)}</Text></Pressable>)}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: P.bg }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: P.bg },
  auth: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }, mark: { width: 64, height: 64, borderRadius: 21, backgroundColor: P.olive, alignItems: "center", justifyContent: "center" },
  markText: { color: "#FFF", fontSize: 34, fontWeight: "800" }, brand: { color: P.ink, fontSize: 30, fontWeight: "800", marginTop: 12, letterSpacing: -1 },
  tagline: { color: P.olive, fontSize: 15, fontWeight: "700", marginTop: 4 }, copy: { color: P.muted, textAlign: "center", lineHeight: 23, marginTop: 20 },
  primary: { marginTop: 30, backgroundColor: P.olive, borderRadius: 16, padding: 17, width: "100%", alignItems: "center" }, primaryText: { color: "#FFF", fontWeight: "800" },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { color: P.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.4 }, brandSmall: { color: P.ink, fontSize: 25, fontWeight: "800", letterSpacing: -1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 }, status: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: P.paper, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  dot: { width: 6, height: 6, borderRadius: 5 }, statusText: { color: P.ink, fontSize: 10, fontWeight: "700" },
  workspaces: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 20, paddingBottom: 10 }, chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: P.line },
  chipOn: { backgroundColor: P.olive, borderColor: P.olive }, chipText: { color: P.muted, fontSize: 11, fontWeight: "700" }, chipTextOn: { color: "#FFF" },
  syncButton: { marginLeft: "auto", width: 33, height: 33, backgroundColor: P.paper, borderRadius: 17, alignItems: "center", justifyContent: "center" }, syncButtonText: { color: P.olive, fontSize: 21 },
  scroll: { flex: 1 }, body: { paddingHorizontal: 20, paddingBottom: 25 }, heading: { color: P.ink, fontSize: 23, fontWeight: "800", marginTop: 15, letterSpacing: -0.6 },
  subheading: { color: P.muted, fontSize: 12, marginTop: 5, marginBottom: 17 }, balance: { backgroundColor: P.olive, borderRadius: 24, padding: 22, marginBottom: 12 },
  balanceLabel: { color: "#D8DDCE", fontSize: 10, fontWeight: "800", letterSpacing: 1.1 }, balanceValue: { color: "#FFF", fontSize: 32, fontWeight: "800", marginTop: 12, letterSpacing: -1 },
  balanceFoot: { flexDirection: "row", justifyContent: "space-between", marginTop: 20 }, balanceFootText: { color: "#E2E6D9", fontSize: 10, fontWeight: "600" },
  stats: { flexDirection: "row", gap: 10, marginBottom: 24 }, stat: { flex: 1, backgroundColor: P.paper, borderRadius: 18, padding: 15 },
  statLabel: { color: P.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 }, statValue: { fontSize: 16, fontWeight: "800", marginTop: 9 },
  section: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }, sectionTitle: { color: P.ink, fontSize: 16, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: P.line },
  txIcon: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center" }, rowMain: { flex: 1 },
  rowTitle: { color: P.ink, fontSize: 12, fontWeight: "700" }, muted: { color: P.muted, fontSize: 10, marginTop: 4 }, amount: { color: P.ink, fontSize: 12, fontWeight: "800" },
  wallet: { backgroundColor: P.paper, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", marginBottom: 9, gap: 12 },
  walletMark: { width: 40, height: 40, borderRadius: 14, backgroundColor: P.soft, alignItems: "center", justifyContent: "center" }, walletMarkText: { color: P.olive, fontSize: 16, fontWeight: "800" },
  empty: { color: P.muted, backgroundColor: P.paper, padding: 22, borderRadius: 16, textAlign: "center", lineHeight: 20, marginTop: 8 },
  alert: { backgroundColor: "#F5EBD8", padding: 12, borderRadius: 12, marginTop: 8 }, alertText: { color: "#7C551D", fontSize: 11, lineHeight: 17 },
  footer: { color: P.muted, fontSize: 10, textAlign: "center", paddingVertical: 16 },
  moreCard: { backgroundColor: P.paper, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 9 },
  moreMark: { width: 38, height: 38, borderRadius: 13, backgroundColor: P.soft, alignItems: "center", justifyContent: "center" },
  moreMarkText: { color: P.olive, fontSize: 15, fontWeight: "800" }, moreArrow: { color: P.muted, fontSize: 22 },
  backLink: { color: P.olive, fontSize: 12, fontWeight: "800", marginTop: 12 },
  moduleCard: { backgroundColor: P.paper, borderRadius: 16, padding: 16, marginBottom: 10 },
  moduleAmount: { color: P.ink, fontSize: 21, fontWeight: "800", marginTop: 9, marginBottom: 4 },
  statusTag: { color: P.olive, fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  progressTrack: { height: 7, backgroundColor: P.soft, borderRadius: 6, overflow: "hidden", marginVertical: 10 },
  progressFill: { height: 7, backgroundColor: P.olive, borderRadius: 6 },
  reportCard: { backgroundColor: P.paper, borderRadius: 16, padding: 17, marginBottom: 10 },
  settingsButton: { alignSelf: "flex-start", backgroundColor: P.olive, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 11, marginTop: 12 },
  settingsButtonText: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  addButton: { backgroundColor: P.olive, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 }, addButtonText: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  modalScreen: { flex: 1, backgroundColor: P.bg }, modalHeader: { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { color: P.ink, fontSize: 20, fontWeight: "800" }, modalClose: { color: P.olive, fontSize: 12, fontWeight: "700" },
  modalBody: { padding: 20, paddingBottom: 40 }, typeSwitch: { flexDirection: "row", gap: 8, marginBottom: 20 },
  typeOption: { flex: 1, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: P.line, alignItems: "center" },
  typeOptionOn: { backgroundColor: P.olive, borderColor: P.olive }, typeOptionText: { color: P.muted, fontSize: 11, fontWeight: "800" }, typeOptionTextOn: { color: "#FFF" },
  formLabel: { color: P.ink, fontSize: 11, fontWeight: "800", marginBottom: 7, marginTop: 13 },
  formInput: { backgroundColor: P.paper, borderWidth: 1, borderColor: P.line, borderRadius: 13, padding: 14, color: P.ink, fontSize: 14 },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, choice: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: P.line, backgroundColor: P.paper },
  choiceOn: { backgroundColor: P.olive, borderColor: P.olive }, choiceText: { color: P.muted, fontSize: 10, fontWeight: "600" }, choiceTextOn: { color: "#FFF" },
  formHint: { color: P.muted, fontSize: 10, lineHeight: 16, marginVertical: 18 },
  nav: { flexDirection: "row", justifyContent: "space-around", backgroundColor: P.paper, borderTopWidth: 1, borderTopColor: P.line, paddingTop: 10, paddingBottom: 6 },
  navItem: { alignItems: "center", minWidth: 62, gap: 3 }, navGlyph: { color: P.muted, fontSize: 21 }, navText: { color: P.muted, fontSize: 9, fontWeight: "600" }, navActive: { color: P.olive, fontWeight: "800" },
  chat: { backgroundColor: P.paper, borderRadius: 20, padding: 12, minHeight: 430 }, chatHistory: { height: 330 }, welcome: { flex: 1, minHeight: 280, alignItems: "center", justifyContent: "center", padding: 20 },
  welcomeTitle: { color: P.ink, fontSize: 18, fontWeight: "800", textAlign: "center", marginBottom: 8 }, bubble: { maxWidth: "88%", padding: 12, borderRadius: 16 },
  userBubble: { backgroundColor: P.olive, alignSelf: "flex-end", borderBottomRightRadius: 5 }, aiBubble: { backgroundColor: P.bg, alignSelf: "flex-start", borderBottomLeftRadius: 5 },
  bubbleText: { color: P.ink, fontSize: 12, lineHeight: 19 }, composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, borderWidth: 1, borderColor: P.line, borderRadius: 16, padding: 7, marginTop: 10 },
  input: { flex: 1, minHeight: 38, maxHeight: 100, color: P.ink, fontSize: 13, paddingHorizontal: 8, paddingTop: 8 }, send: { width: 38, height: 38, borderRadius: 13, backgroundColor: P.olive, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#FFF", fontSize: 22, fontWeight: "800" }, memoryNote: { color: P.muted, fontSize: 10, lineHeight: 16, marginTop: 12 }
});
