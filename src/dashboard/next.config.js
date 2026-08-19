/** @type {import("next").NextConfig} */
const isStaticExport = process.env.KRYPTON_STATIC_EXPORT === 'true';

const nextConfig = {
  env: {
    NEXT_PUBLIC_KRYPTON_STATIC_EXPORT: isStaticExport ? 'true' : 'false',
  },
  images: {
    unoptimized: true,
  },
  ...(isStaticExport
    ? {
        assetPrefix: '/krypton-security',
        basePath: '/krypton-security',
        output: 'export',
      }
    : {}),
};

export default nextConfig;
