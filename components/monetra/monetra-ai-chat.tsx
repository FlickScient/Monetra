'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bot, ArrowUp, Sparkles, Trash2, ShieldCheck, LoaderCircle, UserRound } from 'lucide-react';

type Message = { role: 'user' | 'model'; content: string };

const suggestions = [
  'Where did most of my money go this month?',
  'Compare my income and expenses over time.',
  'Can I afford a ৳10,000 purchase right now?',
  'Find spending patterns I should pay attention to.',
];

export function MonetraAIChat({ workspaceId }: { workspaceId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`monetra-ai-chat:${workspaceId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(parsed.filter((item) =>
          item && (item.role === 'user' || item.role === 'model') && typeof item.content === 'string',
        ).slice(-40));
      }
    } catch {
      localStorage.removeItem(`monetra-ai-chat:${workspaceId}`);
    }
    setReady(true);
  }, [workspaceId]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(`monetra-ai-chat:${workspaceId}`, JSON.stringify(messages.slice(-40)));
    } catch {
      setError('Chat history could not be saved on this device.');
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
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ messages: nextMessages.slice(-12) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Monetra AI could not respond. Please try again.');
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('Monetra AI returned an empty response.');
      const assistantMessage: Message = { role: 'model', content: data.answer };
      setMessages(current => [...current, assistantMessage].slice(-40));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection issue. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    setMessages([]);
    setError('');
  }

  return (
    <section className="surface-card monetra-ai-card">
      <div className="monetra-ai-heading">
        <div className="monetra-ai-identity">
          <span className="monetra-ai-mark"><Bot size={21} /></span>
          <div>
            <p className="eyebrow">GEMINI-POWERED · WORKSPACE AWARE</p>
            <h2>Ask Monetra AI</h2>
            <p className="section-subtitle">Your financial records, understood in plain language.</p>
          </div>
        </div>
        <button type="button" className="monetra-ai-clear" onClick={clearConversation} disabled={!messages.length || loading} title="Clear this workspace chat">
          <Trash2 size={14} /><span>Clear</span>
        </button>
      </div>

      <div className="monetra-ai-conversation" aria-live="polite">
        {!messages.length && (
          <div className="monetra-ai-empty">
            <span className="monetra-ai-welcome-icon"><Sparkles size={20} /></span>
            <strong>Your money has a story. Let's read it.</strong>
            <p>Ask about spending, monthly cash flow, affordability, debts, or savings goals.</p>
            <div className="monetra-ai-suggestions">
              {suggestions.map((suggestion) => (
                <button type="button" key={suggestion} onClick={() => sendMessage(undefined, suggestion)} disabled={loading || !ready}>
                  {suggestion}<ArrowUp size={13} />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div className={`monetra-ai-message ${message.role === 'user' ? 'from-user' : 'from-ai'}`} key={index}>
            <span className="monetra-ai-avatar">{message.role === 'user' ? <UserRound size={14} /> : <Bot size={14} />}</span>
            <div className="monetra-ai-bubble">{message.content}</div>
          </div>
        ))}
        {loading && <div className="monetra-ai-message from-ai"><span className="monetra-ai-avatar"><Bot size={14} /></span><div className="monetra-ai-bubble monetra-ai-thinking"><LoaderCircle size={14} /> Reviewing your workspace…</div></div>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="monetra-ai-error" role="alert">{error}</p>}
      <form className="monetra-ai-composer" onSubmit={sendMessage}>
        <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
        }} placeholder="Ask anything about your money…" rows={2} maxLength={3000} disabled={loading || !ready} />
        <div className="monetra-ai-composer-footer">
          <small>Enter to send · Shift + Enter for a new line</small>
          <button type="submit" disabled={!draft.trim() || loading || !ready} aria-label="Send message">
            {loading ? <LoaderCircle size={16} className="monetra-ai-spin" /> : <ArrowUp size={17} />}
          </button>
        </div>
      </form>
      <p className="monetra-ai-privacy"><ShieldCheck size={13} /> Read-only · Uses only this selected workspace · Chat history stays in this browser</p>
    </section>
  );
}
