'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Copy, History, Minus, X, Delete } from 'lucide-react';

type Calculation = { expression: string; result: string };

function evaluateExpression(source: string): number {
  const compact = source.replace(/\s+/g, '');
  const tokens = compact.match(/\d*\.?\d+|[()+\-*/%]/g);
  if (!tokens || tokens.join('') !== compact) throw new Error('Invalid expression');
  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];

  function primary(): number {
    const token = consume();
    if (token === '(') {
      const value = expression();
      if (consume() !== ')') throw new Error('Missing closing bracket');
      return value;
    }
    if (!token || !/^\d*\.?\d+$/.test(token)) throw new Error('Expected a number');
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return value;
  }
  function unary(): number {
    if (peek() === '+') { consume(); return unary(); }
    if (peek() === '-') { consume(); return -unary(); }
    let value = primary();
    while (peek() === '%') { consume(); value /= 100; }
    return value;
  }
  function term(): number {
    let value = unary();
    while (peek() === '*' || peek() === '/') {
      const operator = consume();
      const right = unary();
      if (operator === '/' && right === 0) throw new Error('Cannot divide by zero');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }
  function expression(): number {
    let value = term();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const right = term();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = expression();
  if (position !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid calculation');
  return result;
}

function formatResult(value: number): string {
  if (!Number.isFinite(value)) return 'Error';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 }).format(Number(value.toPrecision(12)));
}

export function FloatingCalculator() {
  const [open, setOpen] = useState(false);
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState('0');
  const [history, setHistory] = useState<Calculation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const preview = useMemo(() => {
    if (!expression || /[+\-*/.(]$/.test(expression)) return '';
    try { return formatResult(evaluateExpression(expression)); } catch { return ''; }
  }, [expression]);

  function append(value: string) {
    setExpression((current) => {
      if (/[+\-*/]$/.test(current) && /[+\-*/]/.test(value)) return current.slice(0, -1) + value;
      return current + value;
    });
    setCopied(false);
  }
  function clear() { setExpression(''); setResult('0'); setCopied(false); }
  function backspace() { setExpression((current) => current.slice(0, -1)); setCopied(false); }
  function calculate() {
    if (!expression.trim()) return;
    try {
      const value = evaluateExpression(expression);
      const formatted = formatResult(value);
      setResult(formatted);
      setHistory((items) => [{ expression, result: formatted }, ...items].slice(0, 12));
      setExpression(String(Number(value.toPrecision(12))));
      setCopied(false);
    } catch { setResult('Error'); }
  }
  function toggleSign() {
    setExpression((current) => {
      if (!current) return '-';
      const match = current.match(/(\d*\.?\d+)$/);
      if (!match || match.index === undefined) return current.startsWith('-') ? current.slice(1) : '-' + current;
      const before = current.slice(0, match.index);
      const number = match[0];
      if (before.endsWith('-') && (before.length === 1 || /[+*/(]$/.test(before.slice(0, -1)))) {
        return before.slice(0, -1) + number;
      }
      return before + '-' + number;
    });
  }

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (event.key === 'Escape') setOpen(false);
        return;
      }
      if (/^[0-9.]$/.test(event.key)) { event.preventDefault(); append(event.key); }
      else if (['+', '-', '*', '/', '%'].includes(event.key)) { event.preventDefault(); append(event.key); }
      else if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); calculate(); }
      else if (event.key === 'Backspace') { event.preventDefault(); backspace(); }
      else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    }
    function handleOutside(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setShowHistory(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open, expression]);

  async function copyResult() {
    const value = preview || result;
    if (!value || value === 'Error') return;
    try { await navigator.clipboard.writeText(value.replace(/,/g, '')); setCopied(true); }
    catch { setCopied(false); }
  }

  const keys = [
    { label: 'AC', action: clear, kind: 'utility' },
    { label: '⌫', action: backspace, kind: 'utility' },
    { label: '%', action: () => append('%'), kind: 'utility' },
    { label: '÷', action: () => append('/'), kind: 'operator' },
    { label: '7', action: () => append('7'), kind: 'number' },
    { label: '8', action: () => append('8'), kind: 'number' },
    { label: '9', action: () => append('9'), kind: 'number' },
    { label: '×', action: () => append('*'), kind: 'operator' },
    { label: '4', action: () => append('4'), kind: 'number' },
    { label: '5', action: () => append('5'), kind: 'number' },
    { label: '6', action: () => append('6'), kind: 'number' },
    { label: '−', action: () => append('-'), kind: 'operator' },
    { label: '1', action: () => append('1'), kind: 'number' },
    { label: '2', action: () => append('2'), kind: 'number' },
    { label: '3', action: () => append('3'), kind: 'number' },
    { label: '+', action: () => append('+'), kind: 'operator' },
    { label: '±', action: toggleSign, kind: 'utility' },
    { label: '0', action: () => append('0'), kind: 'number' },
    { label: '.', action: () => append('.'), kind: 'number' },
    { label: '=', action: calculate, kind: 'equals' },
  ];

  return (
    <div className="floating-calculator-root" ref={rootRef}>
      {open && (
        <section className="floating-calculator-panel" aria-label="Quick calculator">
          <header className="calculator-header">
            <div className="calculator-title"><span><Calculator size={16} /></span><div><strong>Quick Calculator</strong><small>Calculations stay outside your ledger</small></div></div>
            <div className="calculator-header-actions">
              <button type="button" onClick={() => setShowHistory((value) => !value)} aria-label="Calculation history" title="History"><History size={16} /></button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close calculator"><X size={17} /></button>
            </div>
          </header>
          {showHistory ? (
            <div className="calculator-history">
              <div className="calculator-history-heading"><strong>Recent calculations</strong><button type="button" onClick={() => setHistory([])} disabled={history.length === 0}>Clear history</button></div>
              {history.length === 0 ? <p className="calculator-history-empty">Your calculations will appear here.</p> : history.map((item, index) => (
                <button className="calculator-history-item" type="button" key={index} onClick={() => { setExpression(item.result.replace(/,/g, '')); setResult(item.result); setShowHistory(false); }}>
                  <span>{item.expression}</span><strong>{item.result}</strong>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="calculator-display">
                <div className="calculator-expression">{expression || '0'}</div>
                <div className="calculator-result-row"><strong>{preview || result}</strong><button type="button" onClick={() => void copyResult()} aria-label="Copy result" title="Copy result"><Copy size={14} />{copied ? 'Copied' : 'Copy'}</button></div>
              </div>
              <div className="calculator-keypad">
                {keys.map((key) => <button key={key.label} type="button" className={\`calculator-key calculator-key-\${key.kind}\`} onClick={key.action}>{key.label === '⌫' ? <Delete size={17} /> : key.label}</button>)}
              </div>
              <p className="calculator-footnote">Keyboard supported · Press Esc to close</p>
            </>
          )}
        </section>
      )}
      <button className={\`floating-calculator-trigger \${open ? 'is-open' : ''}\`} type="button" onClick={() => { setOpen((value) => !value); setShowHistory(false); }} aria-label={open ? 'Close calculator' : 'Open calculator'} aria-expanded={open}>
        {open ? <Minus size={21} /> : <Calculator size={21} />}
      </button>
    </div>
  );
}
