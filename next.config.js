/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  webpack(config) {
    // ws treats these native addons as optional; prevent webpack from
    // trying to bundle them when using the pure-JS fallback on Vercel.
    config.resolve.alias = {
      ...config.resolve.alias,
      bufferutil: false,
      'utf-8-validate': false,
    };
    return config;
  },
};

module.exports = nextConfig;
