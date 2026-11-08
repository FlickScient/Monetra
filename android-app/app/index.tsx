import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth, useClerk, useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { apiGet, Workspace } from '@/src/lib/api';
import { theme } from '@/src/theme';

type Wallet = {
  id: string;
  name: string;
  walletType: string;
  currency: string;
  currentBalanceMinor: number;
};
type Transaction = {
  id: string;
  transactionType: 'income' | 'expense' | 'transfer' | string;
  walletId: string;
  amountMinor: number;
  description: string;
  occurredAt: string;
};
type Summary = {
  incomeMinor: number;
  expenseMinor: number;
};

const money = (minor: number, currency = 'BDT') =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);

export default function HomeScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary>({ incomeMinor: 0, expenseMinor: 0 });
  const [loading, setLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [dashboardError, setDashboardError] = useState('');

  const loadWorkspaces = useCallback(async () => {
    setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Your Monetra session could not be verified. Please sign in again.');
      const result = await apiGet<Workspace[]>('/api/workspaces', token);
      setWorkspaces(result);
      setSelected((current) => result.find((item) => item.id === current?.id) ?? result[0] ?? null);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not load your finance workspaces.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  const loadDashboard = useCallback(async (workspaceId: string) => {
    setDashboardLoading(true);
    setDashboardError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Your session expired. Please sign in again.');
      const [walletRows, transactionRows, monthSummary] = await Promise.all([
        apiGet<Wallet[]>('/api/wallets', token, workspaceId),
        apiGet<Transaction[]>('/api/transactions?limit=8', token, workspaceId),
        apiGet<Summary>('/api/transactions/summary', token, workspaceId),
      ]);
      setWallets(walletRows);
      setTransactions(transactionRows.slice(0, 8));
      setSummary(monthSummary);
    } catch (issue) {
      setDashboardError(issue instanceof Error ? issue.message : 'Unable to load dashboard data.');
    } finally {
      setDashboardLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.replace('/sign-in');
    if (isLoaded && isSignedIn) void loadWorkspaces();
  }, [isLoaded, isSignedIn, loadWorkspaces, router]);

  useEffect(() => {
    if (isSignedIn && selected?.id) void loadDashboard(selected.id);
  }, [isSignedIn, selected?.id, loadDashboard]);

  const totalBalance = useMemo(
    () => wallets.reduce((sum, wallet) => sum + (Number.isSafeInteger(wallet.currentBalanceMinor) ? wallet.currentBalanceMinor : 0), 0),
    [wallets],
  );

  const refresh = () => {
    setRefreshing(true);
    void loadWorkspaces();
    if (selected?.id) void loadDashboard(selected.id);
  };

  if (!isLoaded || (isSignedIn && loading)) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.green} /><Text style={styles.loadingText}>Opening your Monetra workspace…</Text></View>;
  }
  if (!isSignedIn) return <View style={styles.center}><ActivityIndicator color={theme.colors.green} /></View>;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing || dashboardLoading} onRefresh={refresh} tintColor={theme.colors.green} />}>
        <View style={styles.top}>
          <View>
            <Text style={styles.eyebrow}>MONETRA  /  FINANCIAL COMMAND CENTER</Text>
            <Text style={styles.heading}>Good to see you{user?.firstName ? `, ${user.firstName}` : ''}.</Text>
          </View>
          <Pressable onPress={() => signOut()} style={styles.avatar}><Text style={styles.avatarText}>{(user?.firstName?.[0] ?? user?.primaryEmailAddress?.emailAddress?.[0] ?? 'M').toUpperCase()}</Text></Pressable>
        </View>

        <View style={styles.workspacePicker}>
          <Text style={styles.pickerLabel}>ACTIVE WORKSPACE</Text>
          <View style={styles.workspaceTabs}>
            {workspaces.map((workspace) => {
              const active = selected?.id === workspace.id;
              return <Pressable key={workspace.id} onPress={() => setSelected(workspace)} style={[styles.workspaceTab, active && styles.workspaceTabActive]}><Text style={[styles.workspaceTabText, active && styles.workspaceTabTextActive]}>{workspace.name}</Text></Pressable>;
            })}
          </View>
        </View>

        {error ? <View style={styles.errorCard}><Text style={styles.errorTitle}>Couldn’t load workspaces</Text><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void loadWorkspaces()} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}

        <View style={styles.balanceCard}>
          <Text style={styles.heroLabel}>TOTAL WALLET BALANCE</Text>
          {dashboardLoading && wallets.length === 0 ? <ActivityIndicator color="#fff" style={{ alignSelf: 'flex-start', marginTop: 18 }} /> : <Text style={styles.balanceValue}>{money(totalBalance)}</Text>}
          <Text style={styles.heroSub}>Across {wallets.length} wallet{wallets.length === 1 ? '' : 's'} in {selected?.name ?? 'your workspace'}</Text>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceStats}>
            <View style={styles.balanceStat}><Text style={styles.statLabel}>MONTHLY INCOME</Text><Text style={styles.statValue}>{money(summary.incomeMinor)}</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.balanceStat}><Text style={styles.statLabel}>MONTHLY EXPENSE</Text><Text style={styles.statValue}>{money(summary.expenseMinor)}</Text></View>
          </View>
        </View>

        {dashboardError ? <View style={styles.errorCard}><Text style={styles.errorTitle}>Dashboard data unavailable</Text><Text style={styles.errorText}>{dashboardError}</Text><Pressable onPress={() => selected?.id && void loadDashboard(selected.id)} style={styles.retry}><Text style={styles.retryText}>Retry data sync</Text></Pressable></View> : null}

        <View style={styles.sectionHead}>
          <View><Text style={styles.sectionTitle}>Your wallets</Text><Text style={styles.sectionSub}>Live balances from your Monetra account</Text></View>
          <Text style={styles.count}>{wallets.length} TOTAL</Text>
        </View>
        {wallets.length === 0 && !dashboardLoading ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No wallets yet</Text><Text style={styles.emptyText}>Your wallets will appear here as soon as they exist in this workspace.</Text></View> : null}
        {wallets.map((wallet) => (
          <View key={wallet.id} style={styles.walletRow}>
            <View style={styles.walletIcon}><Text style={styles.walletInitial}>{wallet.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.walletCopy}><Text style={styles.walletName}>{wallet.name}</Text><Text style={styles.walletType}>{wallet.walletType.replace('_', ' ').toUpperCase()}</Text></View>
            <Text style={styles.walletBalance}>{money(wallet.currentBalanceMinor, wallet.currency)}</Text>
          </View>
        ))}

        <View style={[styles.sectionHead, { marginTop: 26 }]}>
          <View><Text style={styles.sectionTitle}>Recent activity</Text><Text style={styles.sectionSub}>Latest transactions in this workspace</Text></View>
          <Text style={styles.count}>{transactions.length} RECENT</Text>
        </View>
        {transactions.length === 0 && !dashboardLoading ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Nothing here yet</Text><Text style={styles.emptyText}>Your transactions will show here once added.</Text></View> : null}
        {transactions.map((transaction) => {
          const income = transaction.transactionType === 'income';
          const date = new Date(transaction.occurredAt);
          return (
            <View key={transaction.id} style={styles.transactionRow}>
              <View style={[styles.transactionIcon, income ? styles.incomeIcon : styles.expenseIcon]}><Text style={[styles.transactionSign, income ? styles.incomeSign : styles.expenseSign]}>{income ? '+' : '−'}</Text></View>
              <View style={styles.transactionCopy}><Text numberOfLines={1} style={styles.transactionName}>{transaction.description}</Text><Text style={styles.transactionDate}>{Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}  ·  {transaction.transactionType.toUpperCase()}</Text></View>
              <Text style={[styles.transactionAmount, income ? styles.incomeSign : styles.expenseSign]}>{income ? '+' : '−'}{money(transaction.amountMinor)}</Text>
            </View>
          );
        })}
        <Text style={styles.version}>MONETRA MOBILE  ·  PRIVATE FINANCE</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 20, paddingTop: 26, paddingBottom: 42 },
  center: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: theme.colors.muted, fontSize: 13, marginTop: 14 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  eyebrow: { color: theme.colors.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginBottom: 8 },
  heading: { color: theme.colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.8 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: theme.colors.greenDeep, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  workspacePicker: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 17, padding: 13, marginBottom: 15 },
  pickerLabel: { color: theme.colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.1, marginBottom: 10 },
  workspaceTabs: { flexDirection: 'row', gap: 7 },
  workspaceTab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 10, backgroundColor: theme.colors.surfaceSoft },
  workspaceTabActive: { backgroundColor: theme.colors.greenDeep },
  workspaceTabText: { color: theme.colors.muted, fontSize: 11, fontWeight: '750' },
  workspaceTabTextActive: { color: '#fff' },
  balanceCard: { backgroundColor: theme.colors.greenDeep, borderRadius: 22, padding: 21, marginBottom: 26 },
  heroLabel: { color: '#c6d8c9', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  balanceValue: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -1.2, marginTop: 13 },
  heroSub: { color: '#d4e2d4', fontSize: 10, marginTop: 7 },
  balanceDivider: { height: 1, backgroundColor: '#ffffff30', marginVertical: 18 },
  balanceStats: { flexDirection: 'row', alignItems: 'center' },
  balanceStat: { flex: 1 },
  statLabel: { color: '#d4e2d4b8', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  statValue: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 7 },
  statDivider: { width: 1, height: 34, backgroundColor: '#ffffff30', marginHorizontal: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
  sectionSub: { color: theme.colors.muted, fontSize: 10, marginTop: 4 },
  count: { color: theme.colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  walletRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, padding: 12, marginBottom: 8 },
  walletIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  walletInitial: { color: theme.colors.green, fontSize: 15, fontWeight: '800' },
  walletCopy: { flex: 1, marginLeft: 11 },
  walletName: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  walletType: { color: theme.colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8, marginTop: 4 },
  walletBalance: { color: theme.colors.text, fontSize: 11, fontWeight: '800' },
  transactionRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, padding: 12, marginBottom: 8 },
  transactionIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  incomeIcon: { backgroundColor: '#e9f3eb' },
  expenseIcon: { backgroundColor: '#f8eee8' },
  transactionSign: { fontSize: 19, fontWeight: '700' },
  incomeSign: { color: '#397a54' },
  expenseSign: { color: '#b97852' },
  transactionCopy: { flex: 1, marginLeft: 10, marginRight: 6 },
  transactionName: { color: theme.colors.text, fontSize: 11, fontWeight: '750' },
  transactionDate: { color: theme.colors.muted, fontSize: 8, marginTop: 4 },
  transactionAmount: { fontSize: 10, fontWeight: '800' },
  emptyCard: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, padding: 16 },
  emptyTitle: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  emptyText: { color: theme.colors.muted, fontSize: 10, lineHeight: 16, marginTop: 5 },
  errorCard: { borderWidth: 1, borderColor: '#e8c8bd', borderRadius: 16, padding: 15, marginBottom: 12, backgroundColor: '#fff8f5' },
  errorTitle: { color: theme.colors.danger, fontWeight: '800', fontSize: 13 },
  errorText: { color: theme.colors.text, fontSize: 12, marginTop: 6, lineHeight: 18 },
  retry: { alignSelf: 'flex-start', paddingVertical: 10 },
  retryText: { color: theme.colors.green, fontWeight: '800', fontSize: 12 },
  version: { color: theme.colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginTop: 30 },
});