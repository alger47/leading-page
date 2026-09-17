/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TS/TSX sources for the renderer and persistence
  // layer; compile them in the Next.js pipeline so the preview uses the SAME
  // components as production (master prompt §5.6).
  transpilePackages: [
    '@landing-ai/ui-components',
    '@landing-ai/design-system',
    '@landing-ai/page-schema',
    '@landing-ai/database',
  ],
  // The visual QA gate pulls in playwright-core; bundling it inside the server
  // bundle would try to compile its optional native deps (chromium-bidi,
  // kerberos). It is loaded lazily only when ENABLE_VISUAL_QA_GATE=1, so keep
  // the whole package external and let Node resolve it at runtime.
  experimental: {
    serverComponentsExternalPackages: ['@landing-ai/visual-qa'],
  },
  async headers() {
    // Security baseline (F18): every response carries the standard hardening
    // headers. The CSP is deliberately permissive where the renderer needs it
    // (inline styles / Next inline scripts / external media), while locking
    // framing, base-uri and form-action to the app itself.
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          // Phase 14 (§12.4): cross-origin isolation hardening.
          // COOP: force top-level / bfcache-friendly same-origin windowing.
          // CORP: only same-origin resources may embed this page.
          // Origin-Agent-Cluster: per-origin memory/thread isolation.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Origin-Agent-Cluster', value: '?1' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Phase 14 note: 'unsafe-inline'/'unsafe-eval' are KEPT because Next's
              // production hydration emits inline bootstrap scripts and evaluates
              // inline modules in dev/SWC path; removing them breaks the published
              // SSR pages. The XSS surface they leave is closed by the L1
              // href-scheme gate + renderer guard + placeholder-SVG escaping and
              // would only widen again if they were replaced naively. Revisit when
              // React 19 + Next stabilized non-inline bootstraps.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;