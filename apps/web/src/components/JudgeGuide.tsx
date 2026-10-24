import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './JudgeGuide.css';

const PASSWORD = 'BrandGuardAdmin2026!';
const WORKSPACE = '539ad43a-e582-46f0-8d0d-7e483782d5c6';
const ROLES = [
  { id: 'creator', label: 'Creator', purpose: 'Write, check, fix and submit a campaign.' },
  { id: 'manager', label: 'Manager', purpose: 'Manage guideline sources and assign reviewers.' },
  { id: 'reviewer', label: 'Reviewer', purpose: 'Review evidence, complete checks and approve.' },
  { id: 'admin', label: 'Admin', purpose: 'Enable Nebius in Processing policy.' },
] as const;
const DRAFT = 'Lumadesk guarantees 10x productivity. Get your 30-day free trial. Sign up NOW!!!';
const CORRECTED = 'Try LumaDesk free for 14 days. Start your trial.';

export function JudgeGuide() {
  const { user, status } = useAuth();
  const [mode, setMode] = useState<'closed' | 'preview' | 'open'>('closed');
  const [view, setView] = useState<'accounts' | 'walkthrough'>('accounts');
  const [roleStep, setRoleStep] = useState(0);
  const role = ROLES[roleStep];
  const [message, setMessage] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const open = mode !== 'closed';

  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [view, roleStep]);

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
      <p className="judge-guide__intro">Try four roles, in order: create a campaign, understand its rules, review it, then control Nebius.</p>
      {status === 'authenticated' && user && <p className="judge-guide__session">Signed in as <strong>{user.role}</strong></p>}
      <div className="judge-guide__switch" aria-label="Guide sections">
        <button type="button" aria-pressed={view === 'accounts'} onClick={() => { setView('accounts'); setMessage(''); }}>Test accounts</button>
        <button type="button" aria-pressed={view === 'walkthrough'} onClick={() => { setView('walkthrough'); setMessage(''); }}>Walkthrough <span aria-hidden="true">↗</span></button>
      </div>
      <div className="judge-guide__body" ref={body}>
        {view === 'accounts' ? <>
          <div className="judge-guide__section-heading"><h3>{role.label} sign-in</h3><span>HOSTED DEMO</span></div>
          <p className="judge-guide__hint">Choose a role and copy these fields into sign-in. Password and workspace are shared.</p>
          <div className="judge-guide__roles" aria-label="Choose a test role">
            {ROLES.map((account, index) => <button type="button" key={account.id} aria-pressed={role.id === account.id} onClick={() => { setRoleStep(index); setMessage(''); }}>{account.label}</button>)}
          </div>
          <p className="judge-guide__role-purpose">{role.purpose}</p>
          <div className="judge-guide__credentials">
            {field('Email', `${role.id}@lumadesk.test`)}
            {field('Password', PASSWORD)}
            {field('Workspace ID', WORKSPACE)}
          </div>
          <p className="judge-guide__hint judge-guide__tip">Use a separate browser profile or private window for the reviewer to keep both roles open.</p>
          <button type="button" className="judge-guide__next" onClick={() => { setView('walkthrough'); setMessage(''); }}>Open {role.label.toLowerCase()} steps <span aria-hidden="true">→</span></button>
        </> : <>
          <div className="judge-guide__section-heading"><h3>Try the four roles</h3><span>{roleStep + 1} OF 4</span></div>
          <div className="judge-guide__roles" aria-label="Walkthrough role order">
            {ROLES.map((account, index) => <button type="button" key={account.id} aria-label={`Step ${index + 1}: ${account.label}`} aria-pressed={roleStep === index} onClick={() => { setRoleStep(index); setMessage(''); }}><span className="judge-guide__chapter-index">0{index + 1}</span>{account.label}</button>)}
          </div>
          <div className="judge-guide__chapter-account"><code>{role.id}@lumadesk.test</code><button type="button" onClick={() => { setView('accounts'); setMessage(''); }}>View {role.label.toLowerCase()} credentials</button></div>
          {roleStep === 0 && <>
          <p className="judge-guide__lesson"><strong>First, be the creator.</strong> See how a campaign moves from a rough draft to source-backed corrections.</p>
          <ol className="judge-guide__steps">
            <li><span className="judge-guide__step-number" aria-hidden="true">01</span><div><h4>Sign in and start a campaign</h4><p>Use the creator credentials, then click <strong>Sign in</strong>. On Campaigns, click <strong>Review a campaign</strong>. Select LumaDesk, give your campaign a unique title, and choose <strong>reviewer@lumadesk.test</strong> as the reviewer.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">02</span><div><h4>Paste the sample and run it</h4><p>Paste this into <strong>Copy Text</strong>. Keep external semantic review selected if available, then click <strong>Submit for Compliance Review →</strong> and wait for analysis.</p><blockquote>{DRAFT}</blockquote><button type="button" className="judge-guide__copy-text" onClick={() => void copy('Sample draft', DRAFT)}>Copy sample draft</button><p>Expect brand-spelling and trial-duration findings. When Nebius is enabled, also inspect performance-claim and tone findings; model wording and counts may vary. If you see “Local processing only”, continue with local findings—we will explore the admin switch last.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">03</span><div><h4>Follow the evidence, then fix it</h4><p>Click <strong>Evidence ↗</strong> on a finding to read its approved source. Close the evidence drawer. Try <strong>Apply available fixes</strong>, or click <strong>Edit draft</strong> and replace the text with:</p><blockquote>{CORRECTED}</blockquote><button type="button" className="judge-guide__copy-text" onClick={() => void copy('Corrected draft', CORRECTED)}>Copy corrected draft</button><p>Click <strong>Save all &amp; recheck</strong>. This saves a new revision and checks the corrected copy.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">04</span><div><h4>Submit, or note what is still needed</h4><p>When coverage and blockers permit, click <strong>Submit for Review →</strong>, then <strong>Confirm Submission →</strong>. If a coverage notice blocks submission, keep this campaign for the reviewer’s manual checks. Copy its page URL or remember its unique title before switching roles.</p></div></li>
          </ol>
          </>}
          {roleStep === 1 && <>
          <p className="judge-guide__lesson"><strong>Why were those phrases detected?</strong> Managers define the approved rules that make the review specific to this brand.</p>
          <ol className="judge-guide__steps">
            <li><span className="judge-guide__step-number" aria-hidden="true">01</span><div><h4>Open the brand’s source of truth</h4><p>Click <strong>Sign out</strong> in the top bar, then sign in as manager. On <strong>Campaigns</strong>, scroll to <strong>Your brand library</strong> and open LumaDesk. Select <strong>Active</strong>, then click <strong>View Rules</strong> on the approved guideline source.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">02</span><div><h4>Match each finding to a rule</h4><dl className="judge-guide__rule-explanations"><dt>“Lumadesk” → “LumaDesk”</dt><dd>The terminology rule sets the approved product spelling and capitalization.</dd><dt>“30-day” → “14 days”</dt><dd>The approved fact says the free trial lasts 14 days. The sample contradicts it.</dd><dt>“10x productivity”</dt><dd>The claim policy requires approved evidence for performance claims. Nebius can flag the unsupported promise.</dd><dt>“Sign up NOW!!!”</dt><dd>The tone guidance asks for calm language. Nebius can flag the pressure and suggest a calmer alternative.</dd></dl><p>Read <strong>Evidence Quote</strong> beside each rule. These are literal passages from the source, so judges can trace findings back to the manager’s guidelines.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">03</span><div><h4>Explore how managers author rules</h4><p>Click <strong>＋ Add guideline source</strong> to inspect the source text and rule fields. A manager supplies a key, title, effective date, approved values and exact evidence quotes. Saving creates a draft; <strong>Activate Source</strong> then requires a rationale and explicit verification before <strong>Activate &amp; Advance Epoch</strong>.</p><p>For this walkthrough, inspect the seeded active rules and cancel any unfinished source form. Activating a changed source makes earlier reviews stale and requires a recheck.</p></div></li>
          </ol>
          </>}
          {roleStep === 2 && <>
          <p className="judge-guide__lesson"><strong>Now be the independent reviewer.</strong> A creator prepares the campaign; the assigned reviewer checks and approves the exact revision.</p>
          <ol className="judge-guide__steps">
            <li><span className="judge-guide__step-number" aria-hidden="true">01</span><div><h4>Open the creator’s campaign</h4><p>Sign out, then sign in as <strong>reviewer@lumadesk.test</strong>. On Campaigns, search for the unique title you used, or paste the saved campaign URL. Confirm you are looking at the corrected, current revision.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">02</span><div><h4>Complete any missing checks</h4><p>If <strong>Manual category review</strong> appears, select an outstanding category. Read the approved source, choose the relevant source checkbox, enter a rationale of at least 20 characters, and click <strong>Record manual check</strong>. Repeat for the remaining categories. Use <strong>Not applicable to this revision</strong> only when no approved rule applies.</p><p>If blockers remain, inspect their evidence and use the available reviewer actions, or return to the creator to correct and recheck the copy.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">03</span><div><h4>Make sure the creator has submitted</h4><p>If the campaign is not yet <strong>IN_REVIEW</strong>, return as creator, open the same campaign, click <strong>Submit for Review →</strong> and <strong>Confirm Submission →</strong>. Then switch back to reviewer. A separate browser profile or private window makes this handoff easier.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">04</span><div><h4>Approve and export the evidence</h4><p>Click <strong>✓ Approve Exact Revision</strong>, write your rationale, then <strong>✓ Confirm Approval</strong>. Once the campaign is <strong>APPROVED</strong>, click <strong>⬇ View Approved Export</strong>. Download the approved text and <strong>Download Audit Record (.json)</strong>. The text should match the revision you approved.</p></div></li>
          </ol>
          </>}
          {roleStep === 3 && <>
          <p className="judge-guide__lesson"><strong>Finally, control Nebius as admin.</strong> The workspace decides whether campaign copy can be sent for external semantic review.</p>
          <ol className="judge-guide__steps">
            <li><span className="judge-guide__step-number" aria-hidden="true">01</span><div><h4>Find the processing switch</h4><p>Sign out and sign in as admin. Click <strong>Processing policy</strong> in the top bar. Inspect the configured provider, model and current policy.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">02</span><div><h4>Try the Nebius toggle</h4><p>Toggle <strong>Enable external semantic processing via hosted provider</strong>. Enter a <strong>Creator Disclosure Notice</strong> explaining that draft text, context and relevant guideline passages go to Nebius. Enter an <strong>Administrative Audit Rationale</strong>, then click <strong>Save Policy Changes</strong>.</p><p>When disabled, supported local checks still run; semantic coverage needs manual review. When enabled, creators can include Nebius for tone, messaging and claims where approved rules apply. A server-side provider key is also required, and provider charges may apply.</p></div></li>
            <li><span className="judge-guide__step-number" aria-hidden="true">03</span><div><h4>See the difference in a new review</h4><p>Return as creator and start a fresh campaign with the original sample. With policy enabled, select external semantic review and submit. With it disabled, the review reports local processing and explains incomplete coverage. Changing the switch does not rerun earlier reviews or change an approved export.</p><p>Finish with external processing enabled so the next judge can try Nebius too.</p></div></li>
          </ol>
          </>}
          <p className="judge-guide__hint judge-guide__tip">To switch roles, save your work, click Sign out, and use the next role’s Test accounts details. This guide stays available on the sign-in page.</p>
          <div className="judge-guide__chapter-actions">
            {roleStep > 0 && <button type="button" onClick={() => { setRoleStep(roleStep - 1); setMessage(''); }}>← Previous role</button>}
            {roleStep < ROLES.length - 1 ? <button type="button" className="judge-guide__next" onClick={() => { setRoleStep(roleStep + 1); setMessage(''); }}>Next: {ROLES[roleStep + 1].label} <span aria-hidden="true">→</span></button>
              : <button type="button" className="judge-guide__next" onClick={() => { setRoleStep(0); setMessage(''); }}>Start again with Creator <span aria-hidden="true">↗</span></button>}
          </div>
        </>}
      </div>
      <footer className="judge-guide__footer"><span role="status" aria-live="polite">{message || 'Shared evaluation workspace · use fictional campaign copy.'}</span></footer>
    </aside>}
  </div>;
}
