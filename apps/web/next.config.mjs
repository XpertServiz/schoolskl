/** @type {import('next').NextConfig} */
export default {
  // workspace packages ship TypeScript source
  transpilePackages: ['@ilmora/assistant', '@ilmora/comms', '@ilmora/core', '@ilmora/i18n', '@ilmora/providers', '@ilmora/ui', '@ilmora/validation'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // children's-privacy rule: no third-party trackers, no ads, no embedded camera/mic/geolocation by default
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()' },
        ],
      },
    ];
  },
};
