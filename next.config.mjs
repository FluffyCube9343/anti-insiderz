/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { allowedOrigins: [] } },
  // Demo HTML changes ship by zip + restart, so Safari must never pin a stale
  // copy of a page: every HTML document is revalidated on every load.
  async headers() {
    return [
      {
        source: "/:path*.html",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};
export default nextConfig;
