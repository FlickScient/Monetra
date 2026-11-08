import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth, useClerk, useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { apiGet, Workspace } from '@/src/lib/api';
import { theme } from '@/src/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
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

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.replace('/sign-in');
    if (isLoaded && isSignedIn) void load();
  }, [isLoaded, isSignedIn, load, router]);

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  if (!isLoaded || (isSignedIn && loading)) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.green} /><Text style={styles.loadingText}>Opening your Monetra workspace…</Text></View>;
  }
  if (!isSignedIn) return <View style={styles.center}><ActivityIndicator color={theme.colors.green} /></View>;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.green} />}>
        <View style={styles.top}>
          <View>
            <Text style={styles.eyebrow}>MONETRA  /  FINANCIAL COMMAND CENTER</Text>
            <Text style={styles.heading}>Good to see you{user?.firstName ? `, ${user.firstName}` : ''}.</Text>
          </View>
          <Pressable onPress={() => signOut()} style={styles.avatar}><Text style={styles.avatarText}>{(user?.firstName?.[0] ?? user?.primaryEmailAddress?.emailAddress?.[0] ?? 'M').toUpperCase()}</Text></Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>YOUR FINANCES, IN ONE PLACE</Text>
          <Text style={styles.heroTitle}>Clear view. Better decisions.</Text>
          <Text style={styles.heroSub}>Your account is connected. Choose a workspace to continue.</Text>
        </View>

        <View style={styles.sectionHead}>
          <View><Text style={styles.sectionTitle}>Your workspaces</Text><Text style={styles.sectionSub}>Separate spaces, one secure account</Text></View>
          <Text style={styles.count}>{workspaces.length} SPACES</Text>
        </View>

        {error ? <View style={styles.errorCard}><Text style={styles.errorTitle}>Couldn’t load Monetra</Text><Text style={styles.errorText}>{error}</Text><Pressable onPress={refresh} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}

        {workspaces.map((workspace) => {
          const active = selected?.id === workspace.id;
          return (
            <Pressable key={workspace.id} onPress={() => setSelected(workspace)} style={[styles.workspace, active && styles.workspaceActive]}>
              <View style={[styles.workspaceIcon, active && styles.workspaceIconActive]}><Text style={[styles.workspaceInitial, active && styles.workspaceInitialActive]}>{workspace.name.slice(0, 1)}</Text></View>
              <View style={styles.workspaceCopy}><Text style={styles.workspaceName}>{workspace.name}</Text><Text style={styles.workspaceType}>{workspace.type.toUpperCase()} WORKSPACE</Text></View>
              <Text style={[styles.chevron, active && styles.chevronActive]}>{active ? '✓' : '›'}</Text>
            </Pressable>
          );
        })}

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Native app foundation</Text>
          <Text style={styles.noticeText}>Secure Clerk sign-in and live workspace discovery are being connected first. Wallets, transactions, reports and the remaining Monetra modules will use the existing finance APIs — no duplicate database.</Text>
        </View>
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
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  eyebrow: { color: theme.colors.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginBottom: 8 },
  heading: { color: theme.colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.8 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: theme.colors.greenDeep, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  hero: { backgroundColor: theme.colors.greenDeep, borderRadius: 22, padding: 22, marginBottom: 26 },
  heroLabel: { color: '#c6d8c9', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  heroTitle: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.6, marginTop: 14 },
  heroSub: { color: '#d4e2d4', fontSize: 12, lineHeight: 19, marginTop: 8, maxWidth: 270 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
  sectionSub: { color: theme.colors.muted, fontSize: 11, marginTop: 4 },
  count: { color: theme.colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  workspace: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 17, padding: 14, marginBottom: 10 },
  workspaceActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.greenSoft },
  workspaceIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: theme.colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  workspaceIconActive: { backgroundColor: theme.colors.greenDeep },
  workspaceInitial: { color: theme.colors.green, fontSize: 17, fontWeight: '800' },
  workspaceInitialActive: { color: '#fff' },
  workspaceCopy: { flex: 1, marginLeft: 13 },
  workspaceName: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  workspaceType: { color: theme.colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 5 },
  chevron: { color: theme.colors.muted, fontSize: 22, paddingHorizontal: 6 },
  chevronActive: { color: theme.colors.green, fontWeight: '800' },
  notice: { backgroundColor: theme.colors.surface, borderRadius: 17, borderWidth: 1, borderColor: theme.colors.line, padding: 17, marginTop: 18 },
  noticeTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  noticeText: { color: theme.colors.muted, fontSize: 11, lineHeight: 18, marginTop: 7 },
  errorCard: { borderWidth: 1, borderColor: '#e8c8bd', borderRadius: 16, padding: 15, marginBottom: 12, backgroundColor: '#fff8f5' },
  errorTitle: { color: theme.colors.danger, fontWeight: '800', fontSize: 13 },
  errorText: { color: theme.colors.text, fontSize: 12, marginTop: 6, lineHeight: 18 },
  retry: { alignSelf: 'flex-start', paddingVertical: 10 },
  retryText: { color: theme.colors.green, fontWeight: '800', fontSize: 12 },
  version: { color: theme.colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginTop: 30 },
});