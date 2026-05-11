// Test page — embedded FRAX calculator iframe.
// Route: /frax-test
//
// Note: frax.shef.ac.uk may set X-Frame-Options / CSP frame-ancestors that
// blocks embedding. If the iframe renders blank, that's the upstream CSP,
// not a bug in this page — open the URL in a new tab instead.

export default function FraxTestPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="px-4 py-3 border-b border-slate-200 bg-white">
        <h1 className="text-base sm:text-lg font-semibold text-slate-900">
          FRAX calculator (embedded)
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Source: frax.shef.ac.uk · use country code 49 for Ireland · this is a test page only
        </p>
      </div>
      <iframe
        src="https://frax.shef.ac.uk/FRAX/"
        title="FRAX fracture risk assessment tool"
        className="w-full block border-0"
        style={{ height: '800px' }}
        // Permissive sandbox — FRAX needs forms + scripts. Adjust if upstream blocks.
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <p className="text-[11px] text-slate-500 px-4 py-2">
        If the calculator does not load, frax.shef.ac.uk is likely blocking
        embedding via X-Frame-Options / CSP frame-ancestors. Open{' '}
        <a
          href="https://frax.shef.ac.uk/FRAX/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 underline"
        >
          frax.shef.ac.uk
        </a>{' '}
        in a new tab.
      </p>
    </main>
  );
}
