import Head from 'next/head';
import { useRouter } from 'next/router';

const SITE_URL = 'https://ffe-blush.vercel.app';

export default function WhatDoesYourOutfitSay() {
  const router = useRouter();

  return (
    <>
      <Head>
        <title>What Does Your Outfit Say About You? How to Read Fashion Like a Language | FFE</title>
        <meta
          name="description"
          content="Every outfit transmits a code — silhouette, detail, colour, meaning. Learn how to read fashion as a language and develop your visual literacy. Start decoding now."
        />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={`${SITE_URL}/what-does-your-outfit-say`} />

        <meta property="og:type" content="article" />
        <meta property="og:url" content={`${SITE_URL}/what-does-your-outfit-say`} />
        <meta property="og:title" content="What Does Your Outfit Say About You? How to Read Fashion Like a Language | FFE" />
        <meta
          property="og:description"
          content="Every outfit transmits a code — silhouette, detail, colour, meaning. Learn how to read fashion as a language and develop your visual literacy."
        />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:site_name" content="FFE" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="What Does Your Outfit Say About You? | FFE" />
        <meta
          name="twitter:description"
          content="Every outfit transmits a code. Learn how to read fashion as a language and develop your visual literacy."
        />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Article',
              headline: 'What Does Your Outfit Say About You? How to Read Fashion Like a Language',
              description:
                'Every outfit transmits a code — silhouette, detail, colour, meaning. Learn how to read fashion as a language and develop your visual literacy.',
              url: `${SITE_URL}/what-does-your-outfit-say`,
              publisher: {
                '@type': 'Organization',
                name: 'FFE',
                url: SITE_URL,
              },
              inLanguage: 'en',
            }),
          }}
        />
      </Head>

      <div className="min-h-screen bg-black text-white font-sans">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => router.push('/en')}
            className="text-2xl font-serif tracking-wide hover:text-zinc-300 transition-colors"
          >
            FFE
          </button>
          <button
            onClick={() => router.push('/en')}
            className="text-sm text-zinc-400 hover:text-white transition-colors border border-zinc-700 px-3 py-1.5 rounded-full"
          >
            ← Gallery
          </button>
        </header>

        <main className="max-w-2xl mx-auto px-6 py-16">

          <div className="mb-12">
            <p className="text-zinc-500 text-sm tracking-widest uppercase mb-4">Visual Literacy</p>
            <h1 className="text-4xl md:text-5xl font-serif leading-tight mb-6">
              What Does Your Outfit Say About You?
            </h1>
            <p className="text-zinc-400 text-lg leading-relaxed">
              Every outfit transmits a code. Not a metaphor — a literal system of visual signs.
              Silhouette, fabric weight, colour temperature, the proportion of a collar to a lapel.
              Each element is a word. Together they form a sentence. Most people wear that sentence
              without being able to read it.
            </p>
          </div>

          <article className="prose prose-invert prose-zinc max-w-none">

            <h2 className="text-2xl font-serif mt-12 mb-4">Fashion is a language. Most people are illiterate in it.</h2>
            <p className="text-zinc-300 leading-relaxed mb-6">
              That is not an insult. It is an observation. Linguistic literacy — reading words on a
              page — is taught explicitly, practised daily, tested. Visual literacy in fashion is not.
              You absorb it incidentally, through exposure, or you don't absorb it at all.
            </p>
            <p className="text-zinc-300 leading-relaxed mb-6">
              The result: most people can feel when something is off in an outfit without being able
              to say why. They sense a contradiction — a formal blazer over athletic shorts, a
              delicate lace collar on a structured power suit — but cannot locate it precisely.
              That gap between feeling and reading is what visual literacy closes.
            </p>

            <h2 className="text-2xl font-serif mt-12 mb-4">An outfit has five layers of meaning</h2>
            <p className="text-zinc-300 leading-relaxed mb-6">
              Reading an outfit is not about identifying brands or trends. It is about reading
              the structure beneath them. Every outfit communicates across five distinct layers:
            </p>

            <div className="space-y-6 mb-8">
              <div className="border-l-2 border-zinc-700 pl-5">
                <h3 className="text-white font-medium mb-1">Form</h3>
                <p className="text-zinc-400 leading-relaxed text-sm">
                  Silhouette, volume, proportion. A column silhouette transmits restraint. A
                  voluminous skirt transmits drama. The shape makes the first statement — before
                  colour, before detail.
                </p>
              </div>
              <div className="border-l-2 border-zinc-700 pl-5">
                <h3 className="text-white font-medium mb-1">Detail</h3>
                <p className="text-zinc-400 leading-relaxed text-sm">
                  Hardware, seams, closures, embellishment. A single exposed zip can shift a garment
                  from romantic to industrial. Details are where style codes collide — or confirm
                  each other.
                </p>
              </div>
              <div className="border-l-2 border-zinc-700 pl-5">
                <h3 className="text-white font-medium mb-1">Colour</h3>
                <p className="text-zinc-400 leading-relaxed text-sm">
                  Temperature, saturation, contrast. A monochrome palette transmits precision.
                  High-contrast combinations transmit energy. Colour carries emotional weight that
                  works independently of form.
                </p>
              </div>
              <div className="border-l-2 border-zinc-700 pl-5">
                <h3 className="text-white font-medium mb-1">Meaning</h3>
                <p className="text-zinc-400 leading-relaxed text-sm">
                  The cultural codes embedded in garments — tailoring as authority, denim as
                  democracy, white as ceremony. These are not arbitrary. They are inherited,
                  contested, and deliberately deployed.
                </p>
              </div>
              <div className="border-l-2 border-zinc-700 pl-5">
                <h3 className="text-white font-medium mb-1">Associations</h3>
                <p className="text-zinc-400 leading-relaxed text-sm">
                  The world the outfit points toward — a subculture, a decade, a mood, an
                  archetype. Associations are the furthest layer from the garment itself and
                  the most powerful in terms of identity signal.
                </p>
              </div>
            </div>

            <h2 className="text-2xl font-serif mt-12 mb-4">The odd word out</h2>
            <p className="text-zinc-300 leading-relaxed mb-6">
              Here is the practical test of visual literacy: take an outfit and describe each layer
              in one word. Fluid. Ruched. Ivory. Bridal. Romantic. Now introduce a word that
              contradicts the code — Structured. Industrial. Utilitarian. The contradiction is
              immediately felt. Finding it precisely is the skill.
            </p>
            <p className="text-zinc-300 leading-relaxed mb-6">
              This is not a game of taste. You are not being asked whether you like the outfit.
              You are being asked to read it — to identify which element breaks the internal
              logic of the look. A stylist does this in seconds. Visual literacy is the
              difference between dressing by instinct and dressing with intention.
            </p>

            <h2 className="text-2xl font-serif mt-12 mb-4">How to develop visual literacy</h2>
            <p className="text-zinc-300 leading-relaxed mb-6">
              There is no shortcut. Насмотренность — the Russian word for the kind of
              deep visual intelligence that comes from sustained, active looking — has no
              direct English equivalent. It is not taste, not knowledge, not style. It is
              the capacity to read visual information accurately, built through practice.
            </p>
            <p className="text-zinc-300 leading-relaxed mb-6">
              The method is simple. Look at an outfit. Name what you see — not what you feel about
              it, but what is structurally present. Identify the dominant code. Then find what
              contradicts it. Do this repeatedly, across different aesthetics, different eras,
              different bodies. The vocabulary builds.
            </p>
            <p className="text-zinc-300 leading-relaxed mb-6">
              The faster you can isolate the contradiction, the more fluent you are becoming
              in fashion as a language.
            </p>

            <h2 className="text-2xl font-serif mt-12 mb-4">Start reading now</h2>
            <p className="text-zinc-300 leading-relaxed mb-6">
              FFE is a training tool for exactly this. Each round presents an outfit and four
              words — one from each style layer, one intruder. Your task: find the word that
              doesn't belong to the outfit's code.
            </p>
            <p className="text-zinc-300 leading-relaxed mb-8">
              No theory. No lectures. Just reading, layer by layer, until the code opens up.
            </p>

            <div className="border border-zinc-800 rounded-xl p-8 text-center mt-10">
              <p className="text-zinc-400 text-sm tracking-widest uppercase mb-3">The Language of Fashion</p>
              <p className="text-xl font-serif mb-6">Every outfit is a secret code.</p>
              <button
                onClick={() => router.push('/en')}
                className="inline-block px-8 py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 transition-colors"
              >
                Start decoding →
              </button>
            </div>

          </article>
        </main>

        <footer className="border-t border-zinc-800 px-6 py-8 mt-16 text-center text-zinc-600 text-sm">
          © FFE — The Language of Fashion
        </footer>
      </div>
    </>
  );
}

export async function getServerSideProps() {
  return { props: {} };
}
