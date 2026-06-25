import Head from 'next/head';

export default function PrivacyPolicy() {
  return (
    <>
      <Head>
        <title>Privacy Policy — FFE</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-black text-zinc-300 font-sans">
        <div className="max-w-2xl mx-auto px-6 py-16">
          <h1 className="text-2xl font-serif mb-2">Privacy Policy</h1>
          <p className="text-xs text-zinc-600 mb-10">Last updated: June 25, 2026</p>

          <div className="space-y-8 text-sm leading-relaxed text-zinc-400">

            <section>
              <h2 className="text-base font-medium text-zinc-200 mb-2">1. About this app</h2>
              <p>FFE (Fashion Fluency Exercise) is a fashion literacy game at <a href="https://ffe-blush.vercel.app" className="text-zinc-300 underline">ffe-blush.vercel.app</a>. Players decode fashion outfits by identifying the odd word out across five semantic layers. The app is operated by FFE is a Fashion Game for personal and educational use.</p>
            </section>

            <section>
              <h2 className="text-base font-medium text-zinc-200 mb-2">2. Data we collect</h2>
              <ul className="space-y-2 list-disc list-inside">
                <li><span className="text-zinc-300">Game sessions</span> — anonymous session ID (stored in localStorage), score, answers, language. No name, email, or account required.</li>
                <li><span className="text-zinc-300">Page views</span> — outfit URL, approximate timestamp. We do not use cookies for tracking.</li>
                <li><span className="text-zinc-300">Technical data</span> — IP address and user-agent, used only to forward conversion events to Pinterest Conversions API for ad attribution.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-medium text-zinc-200 mb-2">3. How we use data</h2>
              <ul className="space-y-2 list-disc list-inside">
                <li>To measure aggregate game engagement (scores, completion rates).</li>
                <li>To report conversion events to Pinterest Conversions API so that Pinterest can attribute ad campaign performance. IP addresses are forwarded to Pinterest and are subject to <a href="https://policy.pinterest.com/privacy-policy" className="text-zinc-300 underline" target="_blank" rel="noreferrer">Pinterest's Privacy Policy</a>.</li>
                <li>We do not sell, share, or use personal data for any purpose other than those stated above.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-medium text-zinc-200 mb-2">4. Data storage</h2>
              <p>Game session data is stored in a PostgreSQL database hosted on Railway. The anonymous session ID is stored locally in your browser's localStorage and is not linked to any personal identity.</p>
            </section>

            <section>
              <h2 className="text-base font-medium text-zinc-200 mb-2">5. Third-party services</h2>
              <ul className="space-y-2 list-disc list-inside">
                <li><span className="text-zinc-300">Pinterest Conversions API</span> — receives page visit and game completion events including IP address and user-agent.</li>
                <li><span className="text-zinc-300">Cloudinary</span> — hosts outfit images and renders.</li>
                <li><span className="text-zinc-300">Vercel</span> — hosts the frontend application.</li>
                <li><span className="text-zinc-300">Railway</span> — hosts the backend and database.</li>
                <li><span className="text-zinc-300">Anthropic Claude</span> — generates game content from outfit sketches. Images may be processed by Anthropic's API.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-medium text-zinc-200 mb-2">6. Your rights</h2>
              <p>Since we collect no personal accounts, there is no personal profile to delete. If you have questions about data collected via Pinterest, you may contact Pinterest directly. For any other questions, contact us at <a href="mailto:sashikon@gmail.com" className="text-zinc-300 underline">sashikon@gmail.com</a>.</p>
            </section>

            <section>
              <h2 className="text-base font-medium text-zinc-200 mb-2">7. Changes</h2>
              <p>We may update this policy as the app evolves. The date at the top of this page reflects the most recent revision.</p>
            </section>

          </div>
        </div>
      </div>
    </>
  );
}
