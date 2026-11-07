'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  ArrowUp, Bot, Clock3, MessageSquare, Plus,
  Search, Send, Sparkles, Trash2, UserRound, X,
} from 'lucide-react';

type Message = { role: 'user' | 'model'; content: string };
type FiscusAction = 'chat' | 'restore' | 'clear' | 'history' | 'new' | 'select' | 'delete';
type Conversation = {
  id: string;
  title: string;
  status: 'active' | 'archived';
  last_message_at: string;
  created_at: string;
};

const suggestions = [
  'Where did most of my money go this month?',
  'Give me a clear monthly cash-flow breakdown.',
  'Can I afford a ৳10,000 purchase right now?',
  'Find spending patterns I should pay attention to.',
];

async function invokeFiscus(
  getToken: () => Promise<string | null>,
  workspaceId: string,
  action: FiscusAction,
  payload: Record<string, unknown> = {},
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error('Fiscus AI is not connected yet. Supabase frontend settings are missing.');
  }

  const token = await getToken();
  if (!token) throw new Error('Your session has expired. Please sign in again.');

  const response = await fetch(supabaseUrl.replace(/\/$/, '') + '/functions/v1/fiscus-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      apikey: publishableKey,
    },
    body: JSON.stringify({ ...payload, action, workspaceId }),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Fiscus could not complete the request.');
  return data;
}

function renderInlineMarkdown(value: string) {
  return value.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function MessageMarkdown({ content }: { content: string }) {
  const blocks = content.trim().split(/\n\s*\n/);
  return <div className="fiscus-markdown">
    {blocks.map((block, index) => {
      const lines = block.split('\n');
      const heading = lines[0].match(/^(#{1,3})\s+(.+)$/);
      const bodyLines = heading ? lines.slice(1) : lines;
      const headingNode = heading ? <h3>{renderInlineMarkdown(heading[2])}</h3> : null;
      if (bodyLines.length && bodyLines.every(line => /^\s*[-*]\s+/.test(line))) {
        return <div key={index}>{headingNode}<ul>{bodyLines.map((line, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul></div>;
      }
      if (bodyLines.length && bodyLines.every(line => /^\s*\d+[.)]\s+/.test(line))) {
        return <div key={index}>{headingNode}<ol>{bodyLines.map((line, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>)}</ol></div>;
      }
      return <div key={index}>{headingNode}{bodyLines.length > 0 && <p>{bodyLines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br />}{renderInlineMarkdown(line)}</span>)}</p>}</div>;
    })}
  </div>;
}

function formatConversationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function MonetraAIChat({ workspaceId }: { workspaceId: string }) {
  const { getToken, isLoaded } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const refreshHistory = useCallback(async () => {
    const data = await invokeFiscus(getToken, workspaceId, 'history');
    setConversations(Array.isArray(data.conversations) ? data.conversations : []);
  }, [getToken, workspaceId]);

  const restoreConversation = useCallback(async (conversationId?: string) => {
    const data = await invokeFiscus(
      getToken,
      workspaceId,
      'restore',
      conversationId ? { conversationId } : {},
    );
    const restored = Array.isArray(data.messages)
      ? data.messages.filter((item: Message) =>
          item &&
          (item.role === 'user' || item.role === 'model') &&
          typeof item.content === 'string',
        ).slice(-40)
      : [];
    setMessages(restored);
    setActiveConversationId(typeof data.conversationId === 'string' ? data.conversationId : null);
  }, [getToken, workspaceId]);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    async function initialize() {
      try {
        await restoreConversation();
        await refreshHistory();
      } catch (err) {
        if (!cancelled) {
          const cached = localStorage.getItem('monetra-ai-chat:' + workspaceId);
          if (cached) {
            try { setMessages(JSON.parse(cached).slice(-40)); } catch { /* Ignore stale local cache. */ }
          }
          setError(err instanceof Error ? err.message : 'Fiscus could not load your chat.');
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [isLoaded, workspaceId, restoreConversation, refreshHistory]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem('monetra-ai-chat:' + workspaceId, JSON.stringify(messages.slice(-40)));
    } catch {
      // Server-side conversation history remains the source of truth.
    }
  }, [messages, ready, workspaceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function sendMessage(event?: FormEvent, prompt?: string) {
    event?.preventDefault();
    const content = (prompt ?? draft).trim();
    if (!content || loading || !ready) return;

    const nextMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setLoading(true);
    try {
      const data = await invokeFiscus(getToken, workspaceId, 'chat', {
        messages: nextMessages.slice(-12),
      });
      if (typeof data.answer !== 'string' || !data.answer.trim()) {
        throw new Error('Fiscus returned an empty response.');
      }
      const assistantMessage: Message = { role: 'model', content: data.answer };
      setMessages((current) => [...current, assistantMessage].slice(-40));
      if (typeof data.conversationId === 'string') setActiveConversationId(data.conversationId);
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection issue. Please try again.');
    } finally {
      setLoading(false);
      composerRef.current?.focus();
    }
  }

  async function startNewChat() {
    if (loading) return;
    setError('');
    setHistoryLoading(true);
    try {
      await invokeFiscus(getToken, workspaceId, 'new');
      setMessages([]);
      setActiveConversationId(null);
      localStorage.removeItem('monetra-ai-chat:' + workspaceId);
      await refreshHistory();
      composerRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a new chat.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openConversation(conversationId: string) {
    if (loading || historyLoading || conversationId === activeConversationId) return;
    setHistoryLoading(true);
    setError('');
    try {
      await invokeFiscus(getToken, workspaceId, 'select', { conversationId });
      await restoreConversation(conversationId);
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversation could not be opened.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteConversation(conversationId: string) {
    if (loading || historyLoading) return;
    if (!window.confirm('Delete this conversation permanently?')) return;
    setHistoryLoading(true);
    setError('');
    try {
      await invokeFiscus(getToken, workspaceId, 'delete', { conversationId });
      if (conversationId === activeConversationId) {
        setMessages([]);
        setActiveConversationId(null);
        localStorage.removeItem('monetra-ai-chat:' + workspaceId);
      }
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversation could not be deleted.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function clearAllHistory() {
    if (loading || historyLoading || !conversations.length) return;
    if (!window.confirm('Delete all Fiscus conversations in this workspace? This cannot be undone.')) return;
    setHistoryLoading(true);
    setError('');
    try {
      await invokeFiscus(getToken, workspaceId, 'clear');
      setMessages([]);
      setConversations([]);
      setActiveConversationId(null);
      localStorage.removeItem('monetra-ai-chat:' + workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat history could not be cleared.');
    } finally {
      setHistoryLoading(false);
    }
  }

  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="surface-card monetra-ai-card monetra-ai-chatgpt">
      <header className="monetra-ai-topbar">
        <div className="monetra-ai-identity">
          <span className="monetra-ai-mark"><Bot size={21} /></span>
          <div>
            <p className="eyebrow">MONETRA INTELLIGENCE</p>
            <h2>Fiscus</h2>
            <p className="section-subtitle">Your personal financial thinking partner</p>
          </div>
        </div>
        <div className="monetra-ai-top-actions">
          <span className="monetra-ai-status"><i /> AI online</span>
          <button type="button" className="monetra-ai-icon-btn mobile-history-toggle" onClick={() => setShowHistory((value) => !value)} aria-label="Toggle chat history">
            {showHistory ? <X size={17} /> : <Clock3 size={17} />}
          </button>
          <button type="button" className="monetra-ai-new-chat" onClick={startNewChat} disabled={!ready || loading || historyLoading}>
            <Plus size={15} /><span>New chat</span>
          </button>
        </div>
      </header>

      <div className={'monetra-ai-shell' + (showHistory ? '' : ' history-collapsed')}>
        <aside className="monetra-ai-history">
          <div className="monetra-ai-history-head">
            <span>YOUR CHATS</span>
            <button type="button" onClick={startNewChat} disabled={!ready || loading || historyLoading} aria-label="New chat"><Plus size={16} /></button>
          </div>
          <label className="monetra-ai-history-search">
            <Search size={14} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" />
          </label>
          <div className="monetra-ai-history-list">
            {filteredConversations.length ? filteredConversations.map((conversation) => (
              <div className={'monetra-ai-history-item' + (conversation.id === activeConversationId ? ' active' : '')} key={conversation.id}>
                <button type="button" className="monetra-ai-history-open" onClick={() => openConversation(conversation.id)} disabled={loading || historyLoading}>
                  <MessageSquare size={14} />
                  <span><b>{conversation.title || 'New conversation'}</b><small>{formatConversationDate(conversation.last_message_at)}</small></span>
                </button>
                <button type="button" className="monetra-ai-history-delete" onClick={() => deleteConversation(conversation.id)} disabled={loading || historyLoading} aria-label="Delete conversation"><Trash2 size={13} /></button>
              </div>
            )) : (
              <div className="monetra-ai-history-empty">{search ? 'No matching chats.' : 'Your conversations will appear here.'}</div>
            )}
          </div>
          <button type="button" className="monetra-ai-clear-history" onClick={clearAllHistory} disabled={!conversations.length || loading || historyLoading}>
            <Trash2 size={13} /> Clear all chats
          </button>
        </aside>

        <div className="monetra-ai-main">
          <div className="monetra-ai-conversation" aria-live="polite">
            {!messages.length && (
              <div className="monetra-ai-empty">
                <span className="monetra-ai-welcome-icon"><Sparkles size={21} /></span>
                <p className="monetra-ai-welcome-kicker">A LITTLE CLARITY GOES A LONG WAY</p>
                <strong>What are we figuring out today?</strong>
                <p>Ask about your spending, cash flow, debts, savings goals, or a financial decision. Fiscus will use the records in this workspace.</p>
                <div className="monetra-ai-suggestions">
                  {suggestions.map((suggestion) => (
                    <button type="button" key={suggestion} onClick={() => void sendMessage(undefined, suggestion)} disabled={loading || !ready || historyLoading}>
                      <span>{suggestion}</span><ArrowUp size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <article className={'monetra-ai-message ' + (message.role === 'user' ? 'from-user' : 'from-ai')} key={index}>
                {message.role === 'model' && <span className="monetra-ai-avatar"><Bot size={15} /></span>}
                <div className="monetra-ai-message-content">
                  <span className="monetra-ai-message-label">{message.role === 'user' ? 'You' : 'Fiscus'}</span>
                  <div className="monetra-ai-bubble"><MessageMarkdown content={message.content} /></div>
                </div>
                {message.role === 'user' && <span className="monetra-ai-avatar user-avatar"><UserRound size={15} /></span>}
              </article>
            ))}
            {loading && (
              <article className="monetra-ai-message from-ai">
                <span className="monetra-ai-avatar"><Bot size={15} /></span>
                <div className="monetra-ai-message-content">
                  <span className="monetra-ai-message-label">Fiscus</span>
                  <div className="monetra-ai-bubble monetra-ai-thinking"><span className="monetra-ai-thinking-dots"><i /><i /><i /></span>Thinking through your numbers…</div>
                </div>
              </article>
            )}
            {historyLoading && <p className="monetra-ai-loading-note">Loading conversation…</p>}
            <div ref={bottomRef} />
          </div>

          {error && <div className="monetra-ai-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
          <form className="monetra-ai-composer" onSubmit={sendMessage}>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Message Fiscus…"
              rows={2}
              maxLength={3000}
              disabled={loading || !ready || historyLoading}
            />
            <div className="monetra-ai-composer-footer">
              <small><Sparkles size={12} /> Enter to send · Shift + Enter for a new line</small>
              <button type="submit" disabled={!draft.trim() || loading || !ready || historyLoading} aria-label="Send message">
                {loading ? <span className="monetra-ai-send-spinner" /> : <Send size={16} />}
              </button>
            </div>
          </form>
          <p className="monetra-ai-privacy">Fiscus can make mistakes. Verify important financial decisions against your records. <span>·</span> Workspace-isolated</p>
        </div>
      </div>
    </section>
  );
}
