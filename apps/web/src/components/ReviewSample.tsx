import { useState } from 'react';

/** An explicitly fictional, local-only introduction to the review interaction. */
export function ReviewSample() {
  const [corrected, setCorrected] = useState(false);
  return (
    <section className="review-sample" aria-label="Interactive fictional review example">
      <div className="review-sample__bar">
        <span><span className="sample-dot" /> THE REVIEW, IN PRACTICE</span>
        <span>FICTIONAL EXAMPLE / 01</span>
      </div>
      <div className="sample-paper">
        <div className="sample-paper__meta"><span>LumaDesk®</span><span>LAUNCH CAMPAIGN</span></div>
        <p className="sample-paper__headline">A little more space<br />for your best work.</p>
        <p className="sample-paper__copy">
          Meet your next workspace. Start with a{' '}
          <button className={`sample-claim ${corrected ? 'sample-claim--corrected' : ''}`} onClick={() => setCorrected(!corrected)} aria-describedby="sample-source">
            {corrected ? '14-day' : '30-day'} free trial<span aria-hidden="true">↗</span>
          </button>.
        </p>
        <div className="sample-paper__footer"><span>EMAIL / ACQUISITION</span><span aria-hidden="true">↗</span></div>
      </div>
      <div className="sample-evidence" id="sample-source">
        <div className="sample-evidence__icon" aria-hidden="true">{corrected ? '✓' : '!'}</div>
        <div>
          <span className="eyebrow">{corrected ? 'CORRECTION APPLIED' : 'CHECK THE CLAIM'}</span>
          <p aria-live="polite">{corrected ? 'The draft now matches the approved source.' : 'The approved trial is 14 days.'}</p>
          <span className="sample-evidence__source">Source: fictional LumaDesk product guidelines</span>
        </div>
        <button className="sample-apply" onClick={() => setCorrected(!corrected)}>{corrected ? 'Reset' : 'Apply fix'} <span aria-hidden="true">↗</span></button>
      </div>
    </section>
  );
}
