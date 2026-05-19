const SITE = 'https://ffe-blush.vercel.app';

export default function Sitemap() {
  return null;
}

export async function getServerSideProps({ res }) {
  let outfitIds = [];
  try {
    const base = process.env.NEXT_PUBLIC_API_URL || '';
    const data = await fetch(`${base}/api/outfits?lang=ru&page=1&limit=1000`).then((r) =>
      r.ok ? r.json() : { outfits: [] }
    );
    outfitIds = (data.outfits || [])
      .filter((o) => o.status === 'ready')
      .map((o) => o.id);
  } catch {
    // sitemap still works without dynamic URLs
  }

  const staticUrls = [
    { loc: `${SITE}/`, priority: '1.0', changefreq: 'daily', ru: `${SITE}/`, en: `${SITE}/en` },
    { loc: `${SITE}/en`, priority: '0.9', changefreq: 'daily', ru: `${SITE}/`, en: `${SITE}/en` },
    { loc: `${SITE}/what-does-your-outfit-say`, priority: '0.8', changefreq: 'monthly', ru: `${SITE}/what-does-your-outfit-say`, en: `${SITE}/what-does-your-outfit-say` },
  ];

  const outfitUrls = outfitIds.flatMap((id) => [
    {
      loc: `${SITE}/outfit/${id}`,
      priority: '0.7',
      changefreq: 'monthly',
      ru: `${SITE}/outfit/${id}`,
      en: `${SITE}/en/outfit/${id}`,
    },
    {
      loc: `${SITE}/en/outfit/${id}`,
      priority: '0.6',
      changefreq: 'monthly',
      ru: `${SITE}/outfit/${id}`,
      en: `${SITE}/en/outfit/${id}`,
    },
  ]);

  const allUrls = [...staticUrls, ...outfitUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
>
${allUrls
  .map(
    ({ loc, priority, changefreq, ru, en }) => `  <url>
    <loc>${loc}</loc>
    <xhtml:link rel="alternate" hreflang="ru" href="${ru}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${ru}"/>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
  res.write(xml);
  res.end();

  return { props: {} };
}
