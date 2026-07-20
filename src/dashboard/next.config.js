/** @type {import("next").NextConfig} */
const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  ...(isGitHubPages
    ? {
        assetPrefix: '/krypton-security',
        basePath: '/krypton-security',
      }
    : {}),
};

export default nextConfig;
