import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { theme } from '@/src/theme';

type Message = { role: 'user' | 'model'; content: string };
type FiscusAction = 'chat' | 'restore' | 'clear';

const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabasePublishableKey?: string } | undefined;
const SUPABASE_URL = extra?.supabaseUrl ?? 'https://osfitgjwkjhhexgcazwj.supabase.co';
const SUPABASE_KEY = extra?.supabasePublishableKey ?? '';

async function invokeFiscus(
  getToken: () => Promise<string | null>,
  workspaceId: string,
  action: FiscusAction,
  payload: Record<string, unknown> = {},
) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Fiscus AI is not configured in this app build.');
  }
  const token = await getToken();
  if (!token) throw new Error('Your Monetra session has expired. Sign in again.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/fiscus-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({ ...payload, action, workspaceId }),
      signal: controller.signal,
    });
    const data = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      return {};
    });
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Fiscus could not complete the request.');
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Fiscus took too long to respond. Check your connection and try again.');
    throw error instanceof Error ? error : new Error('Fiscus connection failed.');
  } finally {
    clearTimeout(timeout);
  }
}

export function FiscusChat({ workspaceId, getToken }: { workspaceId: string; getToken: () => Promise<string | null> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const restore = useCallback(async () => {
    setReady(false);
    setError('');
    try {
      const data = await invokeFiscus(getToken, workspaceId, 'restore');
      const restored = Array.isArray(data.messages)
        ? data.messages.filter((item: Message) => item && (item.role === 'user' || item.role === 'model') && typeof item.content === 'string').slice(-40)
        : [];
      setMessages(restored);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not restore Fiscus conversation.');
    } finally {
      setReady(true);
    }
  }, [getToken, workspaceId]);

  useEffect(() => { void restore(); }, [restore]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages, loading]);

  async function sendMessage(prompt?: string) {
    const content = (prompt ?? draft).trim();
    if (!content || loading || !ready) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setDraft('');
    setError('');
    setLoading(true);
    try {
      const data = await invokeFiscus(getToken, workspaceId, 'chat', { messages: next.slice(-12) });
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('Fiscus returned an empty answer.');
      setMessages(current => [...current, { role: 'model', content: data.answer }].slice(-40));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Fiscus could not answer. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function clearConversation() {
    if (loading || !messages.length) return;
    setLoading(true);
    setError('');
    try {
      await invokeFiscus(getToken, workspaceId, 'clear');
      setMessages([]);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not clear this conversation.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <View style={styles.identity}>
          <View style={styles.mark}><Text style={styles.markText}>F</Text></View>
          <View style={{flex:1}}>
            <Text style={styles.eyebrow}>WORKSPACE-AWARE FINANCIAL AI</Text>
            <Text style={styles.title}>Fiscus A.I.</Text>
            <Text style={styles.subtitle}>Answers grounded in this workspace’s financial records.</Text>
          </View>
        </View>
        <Pressable onPress={() => void clearConversation()} disabled={!messages.length || loading} style={styles.clearButton}>
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} style={styles.conversation} contentContainerStyle={styles.conversationContent}>
        {!messages.length && ready ? <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Your money has a story. Let’s read it.</Text>
          <Text style={styles.subtitle}>Ask about spending, cash flow, affordability, debts or savings.</Text>
          {['Where did most of my money go this month?','Compare my income and expenses.','Can I afford a ৳10,000 purchase?','Find spending patterns I should watch.'].map(prompt=>
            <Pressable key={prompt} onPress={() => void sendMessage(prompt)} style={styles.suggestion}><Text style={styles.suggestionText}>{prompt}</Text></Pressable>
          )}
        </View> : null}
        {messages.map((message,index)=><View key={index} style={[styles.message,message.role==='user'?styles.userMessage:styles.aiMessage]}>
          <Text style={[styles.messageRole,message.role==='user'?styles.userRole:styles.aiRole]}>{message.role==='user'?'YOU':'FISCUS'}</Text>
          <Text style={styles.messageText}>{message.content}</Text>
        </View>)}
        {loading ? <View style={styles.thinking}><ActivityIndicator size="small" color={theme.colors.green}/><Text style={styles.subtitle}>Reviewing your workspace…</Text></View> : null}
      </ScrollView>
      {!!error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!ready ? <View style={styles.thinking}><ActivityIndicator color={theme.colors.green}/><Text style={styles.subtitle}>Restoring secure conversation…</Text></View> : null}
      <View style={styles.composer}>
        <TextInput value={draft} onChangeText={setDraft} multiline maxLength={3000} editable={ready&&!loading} placeholder="Ask anything about your money…" placeholderTextColor={theme.colors.muted} style={styles.input}/>
        <Pressable onPress={() => void sendMessage()} disabled={!draft.trim()||loading||!ready} style={[styles.sendButton,(!draft.trim()||loading||!ready)&&styles.disabled]}>
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
      <Text style={styles.privacy}>Read-only · Selected workspace only · Conversation synced securely</Text>
    </View>
  );
}

const styles=StyleSheet.create({
  root:{backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.line,borderRadius:18,padding:14,minHeight:480},
  heading:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:12},
  identity:{flex:1,flexDirection:'row',alignItems:'center',gap:10},
  mark:{width:38,height:38,borderRadius:13,backgroundColor:theme.colors.greenDeep,alignItems:'center',justifyContent:'center'},
  markText:{color:'#fff',fontSize:19,fontWeight:'900'},
  eyebrow:{fontSize:8,fontWeight:'900',letterSpacing:1,color:theme.colors.green},
  title:{fontSize:19,fontWeight:'900',color:theme.colors.text,marginTop:2},
  subtitle:{fontSize:10,color:theme.colors.muted,lineHeight:15,marginTop:3},
  clearButton:{paddingHorizontal:11,paddingVertical:8,borderRadius:9,backgroundColor:theme.colors.surfaceSoft},
  clearText:{fontSize:10,fontWeight:'800',color:theme.colors.muted},
  conversation:{height:330,borderTopWidth:1,borderBottomWidth:1,borderColor:theme.colors.line},
  conversationContent:{paddingVertical:12,gap:10},
  empty:{paddingVertical:8},
  emptyTitle:{fontSize:14,fontWeight:'900',color:theme.colors.text,marginBottom:5},
  suggestion:{padding:10,borderRadius:10,borderWidth:1,borderColor:theme.colors.line,marginTop:7,backgroundColor:theme.colors.surfaceSoft},
  suggestionText:{fontSize:10,color:theme.colors.text,fontWeight:'700'},
  message:{padding:11,borderRadius:13,maxWidth:'92%'},
  userMessage:{alignSelf:'flex-end',backgroundColor:theme.colors.greenDeep},
  aiMessage:{alignSelf:'flex-start',backgroundColor:theme.colors.surfaceSoft,borderWidth:1,borderColor:theme.colors.line},
  messageRole:{fontSize:8,fontWeight:'900',letterSpacing:1,marginBottom:5},
  userRole:{color:'#cfe0d4'},
  aiRole:{color:theme.colors.green},
  messageText:{fontSize:12,lineHeight:18,color:theme.colors.text},
  thinking:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:12},
  error:{fontSize:10,color:theme.colors.danger,lineHeight:15,marginTop:8},
  composer:{flexDirection:'row',alignItems:'flex-end',gap:8,marginTop:10},
  input:{flex:1,minHeight:45,maxHeight:100,borderRadius:12,borderWidth:1,borderColor:theme.colors.line,backgroundColor:theme.colors.surfaceSoft,padding:11,color:theme.colors.text,fontSize:12},
  sendButton:{width:44,height:44,borderRadius:13,backgroundColor:theme.colors.greenDeep,alignItems:'center',justifyContent:'center'},
  sendText:{fontSize:22,color:'#fff',fontWeight:'800'},
  disabled:{opacity:.45},
  privacy:{fontSize:8,color:theme.colors.muted,marginTop:10,textAlign:'center'},
});
