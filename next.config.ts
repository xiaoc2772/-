import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const staticImageCacheHeaders = [
  { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
];

const publicImageCacheHeaders = [
  { key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" },
];

const nextConfig: NextConfig = {
  output: "standalone",

  // 启用压缩
  compress: true,

  // 图片优化
  images: {
    formats: ["image/avif", "image/webp"],
    // Zeabur/Gateway 部署下直接服务 public 静态图片，关闭 Next 内置优化。
    unoptimized: true,
  },

  // 实验性优化
  experimental: {
    // 按需导入图标库，减少 bundle 体积
    optimizePackageImports: ["lucide-react"],
  },

  // 统一下发静态安全响应头，避免页面流量经过 middleware
  async headers() {
    return [
      {
        source: "/images-optimized/:path*",
        headers: [...securityHeaders, ...staticImageCacheHeaders],
      },
      {
        source: "/images/:path*",
        headers: [...securityHeaders, ...publicImageCacheHeaders],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

};

export default nextConfig;
