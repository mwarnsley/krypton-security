/** @type {import("next").NextConfig} */
const isGitHubPages = process.env.KRYPTON_STATIC_EXPORT === 'true';

const nextConfig = {
  images: {
    unoptimized: true,
  },
  ...(isGitHubPages
    ? {
        assetPrefix: '/krypton-security',
        basePath: '/krypton-security',
        output: 'export',
      }
    : {}),
};

export default nextConfig;
