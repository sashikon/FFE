const { i18n } = require('./next-i18next.config');

/** @type {import('next').NextConfig} */
const nextConfig = {
  i18n,
  images: {
    domains: ['res.cloudinary.com', 'placehold.co'],
  },
  async rewrites() {
    return [
      {
        source: '/pinterest-site-verification=79c5757f6080fdfebdab8167d6cfb483.html',
        destination: '/api/pinterest-verify',
      },
    ];
  },
};

module.exports = nextConfig;
