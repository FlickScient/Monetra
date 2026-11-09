import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { readFiscusCache, saveFiscusCache } from "@/lib/database";

type Message = { role: "user" | "model"; content: string };
type Memory = { id: string; memory_type: "preference" | "goal" | "context"; content: string; updated_at: string };
type Conversation = { id: string; title: string; status: string; last_message_at: string };

const URL = process.env.EXPO_PUBLIC_FISCUS_FUNCTION_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const T = { ink: "#20251D", muted: "#788071", olive: "#596344", bg: "#F4F3EC", paper: "#FFFFFF", line: "#E7E8DF", red: "#B64D43" };

export function FiscusPanel({ workspaceId, userId, getToken }: {
  workspaceId: string; userId: string; getToken: () => Promise<string | null>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [memoryType, setMemoryType] = useState<Memory["memory_type"]>("preference");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const token = await getToken();
    if (!token || !URL || !KEY) throw new Error("Fiscus connection or sign-in is unavailable.");
    const response = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: KEY },
      body: JSON.stringify({ action, workspaceId, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Fiscus could not complete the request.");
    return data;
  }, [getToken, workspaceId]);

  const loadMemories = useCallback(async () => {
    const [prefs, list] = await Promise.all([call("preferences"), call("memory-list")]);
    setMemoryEnabled(Boolean(prefs.preferences?.memory_enabled));
    setMemories(Array.isArray(list.memories) ? list.memories : []);
  }, [call]);

  const loadHistory = useCallback(async () => {
    const data = await call("history");
    setHistory(Array.isArray(data.conversations) ? data.conversations : []);
  }, [call]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const local = await readFiscusCache(userId, workspaceId);
        if (alive && local?.messages_json) setMessages(JSON.parse(local.messages_json).slice(-40));
      } catch { /* Keep an empty local view if cache is unreadable. */ }
      try {
        const restored = await call("restore");
        if (!alive) return;
        if (Array.isArray(restored.messages)) {
          setMessages(restored.messages.slice(-40));
          setConversationId(restored.conversationId ?? null);
          await saveFiscusCache(userId, workspaceId, restored.messages.slice(-40));
        }
        await loadMemories();
        await loadHistory();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Fiscus is offline. Your local chat copy is still available.");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [call, loadHistory, loadMemories, userId, workspaceId]);

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    const next = [...messages, { role: "user" as const, content }];
    setDraft(""); setMessages(next); setSending(true); setError("");
    await saveFiscusCache(userId, workspaceId, next);
    try {
      const result = await call("chat", { messages: next.slice(-12) });
      if (typeof result.answer !== "string") throw new Error("Fiscus returned an unexpected response.");
      const completed = [...next, { role: "model" as const, content: result.answer }];
      setMessages(completed);
      setConversationId(result.conversationId ?? conversationId);
      await saveFiscusCache(userId, workspaceId, completed);
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fiscus could not reply. The message remains on this device.");
    } finally { setSending(false); }
  }

  async function newChat() {
    try {
      await call("new");
      setMessages([]); setConversationId(null);
      await saveFiscusCache(userId, workspaceId, []);
      await loadHistory();
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start a new chat."); }
  }

  async function openConversation(id: string) {
    try {
      await call("select", { conversationId: id });
      const restored = await call("restore", { conversationId: id });
      const restoredMessages = Array.isArray(restored.messages) ? restored.messages.slice(-40) : [];
      setMessages(restoredMessages); setConversationId(id);
      await saveFiscusCache(userId, workspaceId, restoredMessages);
      setShowHistory(false); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open that conversation."); }
  }

  async function toggleMemory(value: boolean) {
    setMemoryBusy(true);
    try {
      const result = await call("preferences", { memoryEnabled: value });
      setMemoryEnabled(Boolean(result.preferences?.memory_enabled));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update memory settings."); }
    finally { setMemoryBusy(false); }
  }

  async function addMemory() {
    if (!memoryText.trim() || memoryBusy) return;
    setMemoryBusy(true);
    try {
      await call("memory-add", { memoryType, memoryContent: memoryText.trim() });
      setMemoryText("");
      await loadMemories();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save memory."); }
    finally { setMemoryBusy(false); }
  }

  async function deleteMemory(id: string) {
    Alert.alert("Delete saved memory?", "Fiscus will no longer use this approved memory.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        void (async () => {
          setMemoryBusy(true);
          try { await call("memory-delete", { memoryId: id }); await loadMemories(); }
          catch (e) { setError(e instanceof Error ? e.message : "Could not delete memory."); }
          finally { setMemoryBusy(false); }
        })();
      } }
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={st.root}>
      <View style={st.topRow}>
        <View><Text style={st.title}>Fiscus</Text><Text style={st.subtitle}>Your financial intelligence</Text></View>
        <View style={st.actions}>
          <Pressable onPress={() => { setShowHistory(!showHistory); setShowMemory(false); }} style={st.smallButton}><Text style={st.smallButtonText}>History</Text></Pressable>
          <Pressable onPress={() => { setShowMemory(!showMemory); setShowHistory(false); }} style={st.smallButton}><Text style={st.smallButtonText}>Memory</Text></Pressable>
          <Pressable onPress={() => void newChat()} style={st.newButton}><Text style={st.newText}>＋</Text></Pressable>
        </View>
      </View>

      {showMemory ? <ScrollView style={st.panel} keyboardShouldPersistTaps="handled">
        <Text style={st.panelTitle}>Fiscus memory</Text>
        <Text style={st.note}>Only memories you explicitly approve are used. Memory is separate for each workspace.</Text>
        <View style={st.toggleRow}><View style={{ flex: 1 }}><Text style={st.label}>Use saved memories</Text><Text style={st.note}>Allow Fiscus to personalize future answers.</Text></View><Pressable disabled={memoryBusy} onPress={() => void toggleMemory(!memoryEnabled)} style={[st.toggle, memoryEnabled && st.toggleOn]}><Text style={st.toggleText}>{memoryEnabled ? "ON" : "OFF"}</Text></Pressable></View>
        <Text style={st.label}>Add an approved memory</Text>
        <View style={st.types}>{(["preference", "goal", "context"] as const).map((type) => <Pressable key={type} onPress={() => setMemoryType(type)} style={[st.typeChip, memoryType === type && st.typeOn]}><Text style={[st.typeText, memoryType === type && st.typeTextOn]}>{type}</Text></Pressable>)}</View>
        <TextInput value={memoryText} onChangeText={setMemoryText} placeholder="Example: I prefer weekly budget summaries." multiline maxLength={1200} style={st.memoryInput} />
        <Pressable disabled={memoryBusy || !memoryText.trim()} onPress={() => void addMemory()} style={st.saveButton}><Text style={st.saveText}>{memoryBusy ? "Saving…" : "Save approved memory"}</Text></Pressable>
        <Text style={[st.label, { marginTop: 20 }]}>Saved memories ({memories.length})</Text>
        {memories.map((memory) => <View key={memory.id} style={st.memoryItem}><View style={{ flex: 1 }}><Text style={st.memoryType}>{memory.memory_type.toUpperCase()}</Text><Text style={st.memoryContent}>{memory.content}</Text></View><Pressable onPress={() => deleteMemory(memory.id)}><Text style={st.deleteText}>Delete</Text></Pressable></View>)}
        {!memories.length && <Text style={st.note}>No approved memories saved in this workspace.</Text>}
      </ScrollView> : showHistory ? <ScrollView style={st.panel}>
        <Text style={st.panelTitle}>Conversation history</Text>
        {history.map((item) => <Pressable key={item.id} onPress={() => void openConversation(item.id)} style={st.historyItem}><Text style={st.label}>{item.title || "Conversation"}</Text><Text style={st.note}>{new Date(item.last_message_at).toLocaleString()}</Text></Pressable>)}
        {!history.length && <Text style={st.note}>No previous conversations yet.</Text>}
      </ScrollView> : <>
        <ScrollView style={st.messages} contentContainerStyle={st.messageContent} keyboardShouldPersistTaps="handled">
          {!messages.length && <View style={st.welcome}><Text style={st.welcomeTitle}>Let's make your money make sense.</Text><Text style={st.note}>Ask about spending, cash flow, budgets, debts or financial patterns.</Text></View>}
          {messages.map((message, index) => <View key={index} style={[st.bubble, message.role === "user" ? st.userBubble : st.aiBubble]}><Text style={[st.bubbleText, message.role === "user" && { color: "#FFF" }]}>{message.content}</Text></View>)}
          {sending && <View style={st.thinking}><ActivityIndicator size="small" color={T.olive} /><Text style={st.note}>Fiscus is thinking…</Text></View>}
        </ScrollView>
        <View style={st.composer}><TextInput value={draft} onChangeText={setDraft} placeholder="Message Fiscus…" placeholderTextColor={T.muted} style={st.input} multiline maxLength={3000} /><Pressable disabled={sending || !draft.trim()} onPress={() => void send()} style={[st.sendButton, (!draft.trim() || sending) && { opacity: 0.5 }]}><Text style={st.sendText}>↑</Text></Pressable></View>
      </>}
      {error ? <Text style={st.error}>{error}</Text> : null}
      {loading && <Text style={st.note}>Restoring your conversations…</Text>}
      <Text style={st.footer}>AI responses require internet. Local chat history remains on this device.</Text>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper, borderRadius: 20, padding: 12, minHeight: 480 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.line },
  title: { color: T.ink, fontSize: 19, fontWeight: "800" }, subtitle: { color: T.muted, fontSize: 10, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 5 }, smallButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 12, backgroundColor: T.bg },
  smallButtonText: { color: T.olive, fontSize: 10, fontWeight: "700" }, newButton: { width: 29, height: 29, borderRadius: 11, backgroundColor: T.olive, alignItems: "center", justifyContent: "center" },
  newText: { color: "#FFF", fontSize: 19 }, messages: { flex: 1, maxHeight: 420 }, messageContent: { paddingVertical: 14, gap: 10, flexGrow: 1 },
  welcome: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, welcomeTitle: { color: T.ink, fontSize: 18, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  note: { color: T.muted, fontSize: 10, lineHeight: 16 }, bubble: { maxWidth: "88%", padding: 12, borderRadius: 16 },
  userBubble: { backgroundColor: T.olive, alignSelf: "flex-end", borderBottomRightRadius: 5 }, aiBubble: { backgroundColor: T.bg, alignSelf: "flex-start", borderBottomLeftRadius: 5 },
  bubbleText: { color: T.ink, fontSize: 12, lineHeight: 19 }, thinking: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, borderWidth: 1, borderColor: T.line, borderRadius: 16, padding: 7 },
  input: { flex: 1, minHeight: 40, maxHeight: 110, color: T.ink, fontSize: 13, paddingHorizontal: 8, paddingTop: 8 },
  sendButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: T.olive, alignItems: "center", justifyContent: "center" }, sendText: { color: "#FFF", fontSize: 22, fontWeight: "800" },
  panel: { flex: 1, paddingTop: 14 }, panelTitle: { color: T.ink, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  toggleRow: { flexDirection: "row", alignItems: "center", paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: T.line, marginBottom: 16 },
  label: { color: T.ink, fontSize: 12, fontWeight: "700" }, toggle: { backgroundColor: T.bg, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  toggleOn: { backgroundColor: "#E2EBDD" }, toggleText: { color: T.olive, fontSize: 10, fontWeight: "800" },
  types: { flexDirection: "row", gap: 7, marginVertical: 9 }, typeChip: { borderWidth: 1, borderColor: T.line, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 },
  typeOn: { backgroundColor: T.olive, borderColor: T.olive }, typeText: { color: T.muted, fontSize: 10 }, typeTextOn: { color: "#FFF" },
  memoryInput: { minHeight: 72, textAlignVertical: "top", borderWidth: 1, borderColor: T.line, borderRadius: 12, padding: 10, color: T.ink, fontSize: 12 },
  saveButton: { backgroundColor: T.olive, borderRadius: 12, padding: 12, alignItems: "center", marginTop: 8 }, saveText: { color: "#FFF", fontWeight: "700", fontSize: 11 },
  memoryItem: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.line },
  memoryType: { color: T.olive, fontSize: 9, fontWeight: "800", letterSpacing: 1 }, memoryContent: { color: T.ink, fontSize: 12, marginTop: 4, lineHeight: 17 },
  deleteText: { color: T.red, fontSize: 10, fontWeight: "700" }, historyItem: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: T.line },
  error: { color: T.red, fontSize: 10, lineHeight: 15, marginTop: 8 }, footer: { color: T.muted, fontSize: 9, textAlign: "center", paddingTop: 10 }
});
