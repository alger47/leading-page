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
};

export default nextConfig;