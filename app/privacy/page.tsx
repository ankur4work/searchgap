import type { CSSProperties } from 'react';
import { env } from '@/lib/env';
import { SearchGapLogo } from '../_components/SearchGapLogo';

export const metadata = {
  title: 'Privacy Policy · SearchGap',
  description: 'What SearchGap collects, why, and how long we keep it.',
  robots: { index: true, follow: true },
};

const UPDATED = '25 June 2026';

const STORED: Array<[string, string, string]> = [
  ['Shop domain', 'Identify your store', 'Install + 30 days'],
  ['Merchant email', 'Send digests & support', 'Install + 30 days'],
  ['Access token (encrypted)', 'Call Shopify on your behalf', 'Deleted on uninstall'],
  ['Product catalog metadata', 'Match searches to products', 'Refreshed every 24h'],
  ['Search terms & counts', 'Detect & rank gaps', '30-day rolling window'],
  ['Order totals (aggregate)', 'Compute average order value', '60 days, aggregates only'],
  ['Gap classifications', 'Power your dashboard', 'Install + 30 days'],
];

const sectionTitle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: '#047857',
  margin: '32px 0 10px',
};
const para: CSSProperties = { margin: '0 0 12px', color: '#3a3f44' };
const li: CSSProperties = { margin: '0 0 8px', color: '#3a3f44' };

export default function PrivacyPage(): JSX.Element {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f6f8fa',
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        padding: '40px 16px',
      }}
    >
      <article
        style={{
          maxWidth: 760,
          margin: '0 auto',
          background: '#fff',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(2,44,34,0.10)',
          color: '#202223',
          lineHeight: 1.6,
        }}
      >
        {/* header band */}
        <header
          style={{
            background: 'radial-gradient(120% 140% at 0% 0%, #059669 0%, #047857 40%, #022c22 100%)',
            color: '#fff',
            padding: '28px 36px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
            <SearchGapLogo size={26} />
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3 }}>
              Search<span style={{ color: '#a3e635' }}>Gap</span>
            </span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: -0.4 }}>
            Privacy Policy
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.85 }}>Last updated {UPDATED}</p>
        </header>

        <div style={{ padding: '8px 36px 40px' }}>
          <p style={{ ...para, marginTop: 20 }}>
            SearchGap analyses the searches shoppers type into your storefront and shows you the
            product gaps and revenue they represent. We are built around data minimisation: we store
            the minimum needed to do that, and never any data that identifies a shopper.
          </p>

          <h2 style={sectionTitle}>What we store</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  {['Data', 'Purpose', 'Retention'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderBottom: '2px solid #d1fae5',
                        color: '#047857',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STORED.map(([d, p, r]) => (
                  <tr key={d}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #eef1f3', fontWeight: 600 }}>
                      {d}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #eef1f3', color: '#5a6168' }}>
                      {p}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #eef1f3', color: '#5a6168' }}>
                      {r}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={sectionTitle}>What we never store</h2>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li style={li}>
              Customer personal data — no names, emails, addresses, phone numbers, cart contents, or
              session IDs.
            </li>
            <li style={li}>Payment data — billing is handled entirely by Shopify.</li>
            <li style={li}>Individual order details — only aggregate order value is computed.</li>
          </ul>

          <h2 style={sectionTitle}>Shopper consent</h2>
          <p style={para}>
            Our storefront tracker respects each shopper&rsquo;s consent decision. Where a consent
            framework is active, it checks Shopify&rsquo;s Customer Privacy API and does not record a
            search unless analytics processing is allowed. It only ever captures the search text,
            the number of results, and a timestamp.
          </p>

          <h2 style={sectionTitle}>How long we keep it</h2>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li style={li}>Active stores: kept for the life of the install.</li>
            <li style={li}>
              After uninstall: deleted within 30 days. Reinstalling in that window restores your
              data.
            </li>
            <li style={li}>
              Shopify <code>shop/redact</code> request: triggers a hard delete. Backups are
              encrypted and expire within 30 days.
            </li>
          </ul>

          <h2 style={sectionTitle}>Who we share data with</h2>
          <p style={para}>We use a small set of sub-processors, each under a data-processing agreement:</p>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li style={li}>
              <strong>Shopify</strong> — source of the store, product and order data we read.
            </li>
            <li style={li}>
              <strong>Coolify (our server host)</strong> — runs the application.
            </li>
            <li style={li}>
              <strong>Resend</strong> — sends the weekly digest email.
            </li>
            <li style={li}>
              <strong>PostHog &amp; Sentry</strong> (optional) — anonymised product analytics and
              error tracking, with access tokens scrubbed.
            </li>
          </ul>

          <h2 style={sectionTitle}>Your rights</h2>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li style={li}>
              <strong>Export</strong> — in-app, Settings &rarr; Privacy &rarr; Export my data (JSON).
            </li>
            <li style={li}>
              <strong>Delete</strong> — uninstall the app, or trigger Shopify&rsquo;s data-redaction
              request.
            </li>
            <li style={li}>
              <strong>Data Processing Addendum</strong> — available on request
              {env.DPA_URL ? <> at {env.DPA_URL}</> : null}.
            </li>
          </ul>

          <h2 style={sectionTitle}>Cookies</h2>
          <p style={para}>
            The embedded app uses Shopify session tokens only — it sets no first-party cookies, and
            neither do our public pages.
          </p>

          <h2 style={sectionTitle}>Contact</h2>
          <p style={para}>
            Email <a href={`mailto:${env.PRIVACY_CONTACT_EMAIL}`} style={{ color: '#047857' }}>
              {env.PRIVACY_CONTACT_EMAIL}
            </a>{' '}
            for any privacy request. We respond within 30 days.
          </p>

          <h2 style={sectionTitle}>Changes</h2>
          <p style={{ ...para, marginBottom: 0 }}>
            We&rsquo;ll notify material changes in-app and by email at least 30 days before they take
            effect.
          </p>
        </div>
      </article>
    </main>
  );
}
