import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './JudgeGuide.css';

const PASSWORD = 'BrandGuardAdmin2026!';
const WORKSPACE = '539ad43a-e582-46f0-8d0d-7e483782d5c6';
const ROLES = [
  { id: 'creator', label: 'Creator', purpose: 'Write, check, fix and submit a campaign.' },
  { id: 'reviewer', label: 'Reviewer', purpose: 'Review evidence, complete checks and approve.' },
  { id: 'manager', label: 'Manager', purpose: 'Manage guideline sources and assign reviewers.' },
  { id: 'admin', label: 'Admin', purpose: 'Enable Nebius in Processing policy.' },
] as const;
const DRAFT = 'Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!';
const CORRECTED = 'Try LumaDesk free for 14 days. Start your trial.';

export function JudgeGuide() {
  const { user, status } = useAuth();
  const [mode, setMode] = useState<'closed' | 'preview' | 'open'>('closed');
  const [view, setView] = useState<'accounts' | 'walkthrough'>('accounts');
  const [role, setRole] = useState<typeof ROLES[number]>(ROLES[0]);
  const [message, setMessage] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = mode !== 'closed';

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const focusInside = root.current?.contains(document.activeElement);
      setMode('closed');
      if (focusInside) trigger.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setMode('closed');
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setMessage('Copy unavailable. Select the text and copy it manually.');
    }
  };

  const field = (label: string, value: string) => <div className="judge-guide__field" key={label}>
    <div><span>{label}</span><code>{value}</code></div>
    <button type="button" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copy(label, value)}>Copy</button>
  </div>;

  return <div className="judge-guide" ref={root}>
    <button type="button" className="judge-guide__trigger" ref={trigger} aria-expanded={open} aria-controls="judge-guide-panel"
      onPointerEnter={event => { if (event.pointerType === 'mouse' && !document.querySelector('[aria-modal="true"]')) setMode(current => current === 'closed' ? 'preview' : current); }}
      onClick={() => setMode(current => current === 'open' ? 'closed' : 'open')}>
      <span className="judge-guide__trigger-icon" aria-hidden="true">?</span><span>Judge guide</span><span aria-hidden="true">{open ? '−' : '↗'}</span>
    </button>
    {open && <aside className="judge-guide__panel" id="judge-guide-panel" aria-labelledby="judge-guide-title">
      <header className="judge-guide__header">
        <div><p className="judge-guide__eyebrow">ROUND 2 · HACKATHON</p><h2 id="judge-guide-title">Your judging companion<span>.</span></h2></div>
        <button type="button" className="judge-guide__close" aria-label="Close judge guide" onClick={() => { setMode('closed'); trigger.current?.focus(); }}>×</button>
      </header>
      <p className="judge-guide__intro">From first sign-in to an approved campaign. Everything you need to try BrandGuard yourself.</p>
      {status === 'authenticated' && user && <p className="judge-guide__session">Signed in as <strong>{user.role}</strong></p>}
      <div className="judge-guide__switch" aria-label="Guide sections">
        <button type="button" aria-pressed={view === 'accounts'} onClick={() => { setView('accounts'); setMessage(''); }}>Test accounts</button>
        <button type="button" aria-pressed={view === 'walkthrough'} onClick={() => { setView('walkthrough'); setMessage(''); }}>Walkthrough <span aria-hidden="true">↗</span></button>
      </div>
      <div className="judge-guide__body">
        {view === 'accounts' ? <>
          <div className="judge-guide__section-heading"><h3>{role.label} sign-in</h3><span>HOSTED DEMO</span></div>
          <p className="judge-guide__hint">Choose a role and copy these fields into sign-in. Password and workspace are shared.</p>
          <div className="judge-guide__roles" aria-label="Choose a test role">
            {ROLES.map(account => <button type="button" key={account.id} aria-pressed={role.id === account.id} onClick={() => { setRole(account); setMessage(''); }}>{account.label}</button>)}
          </div>
          <p className="judge-guide__role-purpose">{role.purpose}</p>
          <div className="judge-guide__credentials">
            {field('Email', `${role.id}@lumadesk.test`)}
            {field('Password', PASSWORD)}
            {field('Workspace ID', WORKSPACE)}
          </div>
          <p className="judge-guide__hint judge-guide__tip">Use a separate browser profile or private window for the reviewer to keep both roles open.</p>
          <button type="button" className="judge-guide__next" onClick={() => { setView('walkthrough'); setMessage(''); }}>See the test workflow <span aria-hidden="true">→</span></button>
        </> : <>
          <div className="judge-guide__section-heading"><h3>Draft → evidence → approval</h3><span>5 STEPS</span></div>
          <ol className="judge-guide__steps">
            <li><span className="judge-guide__step-number" aria-hidden="true">01</span><div><span className="judge-guide__role-tag">CREATOR</span><h4>Bring a draft</h4><p>Sign in as creator. Choose <strong>Review a campaign</strong>, select LumaDesk and assign reviewer@lumadesk.test. Give the campaign a unique title and paste this copy:</p><blockquote>{DRAFT}</blockquote><button type="button" className="judge-guide__copy-text" onClick={() => void copy('Sample draft', DRAFT)}>Copy sample draft</button></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">02</span><div><span className="judge-guide__role-tag">CREATOR</span><h4>Check it with Nebius</h4><p>Keep external semantic review selected and submit the draft. Wait for analysis to finish. Inspect the brand name, trial duration, performance claim and tone findings. Open <strong>Evidence ↗</strong> to see the approved source behind a finding.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">03</span><div><span className="judge-guide__role-tag">CREATOR</span><h4>Fix, save and recheck</h4><p>Try applying a suggestion, or choose <strong>Edit draft</strong> and use the corrected copy below. Choose <strong>Save all &amp; recheck</strong>. Findings update for the new revision.</p><blockquote>{CORRECTED}</blockquote><button type="button" className="judge-guide__copy-text" onClick={() => void copy('Corrected draft', CORRECTED)}>Copy corrected draft</button></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">04</span><div><span className="judge-guide__role-tag">REVIEWER → CREATOR</span><h4>Finish checks and submit</h4><p>Open the same campaign as the assigned reviewer. Resolve outstanding findings and complete any <strong>Manual category review</strong> with relevant source evidence. Return as creator and choose <strong>Submit for Review</strong>, then confirm.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">05</span><div><span className="judge-guide__role-tag">REVIEWER</span><h4>Approve and take the evidence</h4><p>As reviewer, reopen the submitted campaign, approve it with a rationale, then export the text and JSON audit record. Check that the exported text matches the approved revision.</p></div></li>
          </ol>
          <details className="judge-guide__recovery"><summary>Need help with setup or incomplete checks?</summary><p><strong>Local processing only?</strong> Sign in as admin, open <strong>Processing policy</strong>, enable external processing and save a notice and rationale. Return as creator, refresh, select external review and run the compliance check again. Nebius requests may incur provider charges.</p><p><strong>No active guidelines?</strong> As manager, open LumaDesk in the brand library. Add and activate the approved source before rechecking: the product is <strong>LumaDesk</strong>, the trial lasts <strong>14 days</strong>, performance claims need evidence, and tone should be calm.</p><p><strong>Still incomplete?</strong> Read the coverage notice. The assigned reviewer can record outstanding manual checks. Zero findings alone does not mean every category was checked.</p></details>
          <button type="button" className="judge-guide__next" onClick={() => { setView('accounts'); setMessage(''); }}>Back to test accounts <span aria-hidden="true">↗</span></button>
        </>}
      </div>
      <footer className="judge-guide__footer"><span role="status" aria-live="polite">{message || 'Shared evaluation workspace · use fictional campaign copy.'}</span></footer>
    </aside>}
  </div>;
}
