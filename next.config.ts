import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          /**
           * Cross-origin isolation, for one reason: `SharedArrayBuffer`.
           *
           * Without it the speech model runs on a single WASM thread, which
           * is several times slower than the machine can actually manage and
           * is most of what makes a spoken reply feel like waiting. These two
           * headers are what the browser wants in exchange.
           *
           * `credentialless` rather than `require-corp` because the model is
           * fetched cross-origin from the Hugging Face CDN, which sends no
           * CORP header — under `require-corp` that fetch is blocked and the
           * voice never arrives. Credential-less requests are exempt, and
           * this one carries no credentials.
           *
           * Safe here because the app embeds nothing cross-origin: no remote
           * scripts, images, fonts or frames. The only outbound links are
           * `target="_blank"`, which COOP does not affect beyond the
           * `noopener` behaviour they should have had anyway.
           */
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
};

export default nextConfig;
