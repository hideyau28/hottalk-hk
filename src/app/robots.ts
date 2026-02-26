import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/topic/", "/platform/", "/about", "/privacy", "/terms", "/report"],
        disallow: ["/admin/", "/api/", "/search"],
      },
      {
        userAgent: "GPTBot",
        disallow: ["/"],
      },
      {
        userAgent: "CCBot",
        disallow: ["/"],
      },
    ],
    sitemap: "https://hottalk.hk/sitemap.xml",
  };
}
