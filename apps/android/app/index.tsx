import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { AuthView, UserButton } from "@clerk/expo/native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaView } from "react-native-safe-area-context";
import { readAllCachedWorkspaces, readCachedWorkspace } from "@/lib/database";
import { pendingOperationCount, syncWorkspace, type SyncResult } from "@/lib/sync";
import { FiscusPanel } from "@/components/fiscus-panel";

type Workspace = { id: string; name: string; type: string };
type Snapshot = { cursor: string; data: Record<string, any[]> };
const API = process.env.EXPO_PUBLIC_MONETRA_API_URL?.replace(/\/+$/, "");
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
  const [tab, setTab] = useState<"overview" | "wallets" | "activity" | "fiscus">("overview");
  const [messages, setMessages] = useState<Array<{ role: "user" | "model"; content: string }>>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

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

  async function sendFiscus() {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setSending(true);
    setError("");
    try {
      const token = await getToken();
      const url = process.env.EXPO_PUBLIC_FISCUS_FUNCTION_URL;
      const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!token || !url || !key) throw new Error("Fiscus is not configured for this installation.");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: key },
        body: JSON.stringify({ action: "chat", workspaceId, messages: next.slice(-12) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Fiscus could not reply.");
      const reply = result.reply ?? result.response ?? result.message;
      if (typeof reply !== "string") throw new Error("Unexpected Fiscus response.");
      setMessages([...next, { role: "model", content: reply }]);
    } catch (e) { setError(e instanceof Error ? e.message : "Fiscus is unavailable."); }
    finally { setSending(false); }
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
          <View style={s.section}><Text style={s.sectionTitle}>Recent activity</Text><Text style={s.muted}>{transactions.length} records</Text></View>
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
        {tab === "fiscus" && <FiscusPanel workspaceId={workspaceId} userId={user?.id ?? ""} getToken={getToken} />}

        <Text style={s.footer}>Pending sync actions: {pending} · {sync.message}</Text>
      </ScrollView>
      <View style={s.nav}>
        {(["overview", "wallets", "activity", "fiscus"] as const).map((name) => <Pressable key={name} style={s.navItem} onPress={() => setTab(name)}><Text style={[s.navGlyph, tab === name && s.navActive]}>{name === "overview" ? "⌂" : name === "wallets" ? "▣" : name === "activity" ? "≡" : "✳"}</Text><Text style={[s.navText, tab === name && s.navActive]}>{name[0].toUpperCase() + name.slice(1)}</Text></Pressable>)}
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
  nav: { flexDirection: "row", justifyContent: "space-around", backgroundColor: P.paper, borderTopWidth: 1, borderTopColor: P.line, paddingTop: 10, paddingBottom: 6 },
  navItem: { alignItems: "center", minWidth: 62, gap: 3 }, navGlyph: { color: P.muted, fontSize: 21 }, navText: { color: P.muted, fontSize: 9, fontWeight: "600" }, navActive: { color: P.olive, fontWeight: "800" },
  chat: { backgroundColor: P.paper, borderRadius: 20, padding: 12, minHeight: 430 }, chatHistory: { height: 330 }, welcome: { flex: 1, minHeight: 280, alignItems: "center", justifyContent: "center", padding: 20 },
  welcomeTitle: { color: P.ink, fontSize: 18, fontWeight: "800", textAlign: "center", marginBottom: 8 }, bubble: { maxWidth: "88%", padding: 12, borderRadius: 16 },
  userBubble: { backgroundColor: P.olive, alignSelf: "flex-end", borderBottomRightRadius: 5 }, aiBubble: { backgroundColor: P.bg, alignSelf: "flex-start", borderBottomLeftRadius: 5 },
  bubbleText: { color: P.ink, fontSize: 12, lineHeight: 19 }, composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, borderWidth: 1, borderColor: P.line, borderRadius: 16, padding: 7, marginTop: 10 },
  input: { flex: 1, minHeight: 38, maxHeight: 100, color: P.ink, fontSize: 13, paddingHorizontal: 8, paddingTop: 8 }, send: { width: 38, height: 38, borderRadius: 13, backgroundColor: P.olive, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#FFF", fontSize: 22, fontWeight: "800" }, memoryNote: { color: P.muted, fontSize: 10, lineHeight: 16, marginTop: 12 }
});
