import * as cheerio from "cheerio";
import type { Request } from "express";

import { timeRequestPhase } from "../../observability/requestTiming.js";
import { ApiError } from "../../utils/apiError.js";

export type CrawlerInput = {
  baseUrl: string;
  maxPages?: number;
  maxDepth?: number;
  request?: Request;
};

export type CrawlerPage = {
  url: string;
  title?: string;
  content: string;
};

export type CrawlerResult = {
  pages: CrawlerPage[];
};

export class WebCrawlerProvider {
  private visited = new Set<string>();
  private pages: CrawlerPage[] = [];

  private isValidUrl(url: string, baseUrl: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const parsedBase = new URL(baseUrl);
      
      // Must be same domain
      if (parsedUrl.hostname !== parsedBase.hostname) return false;
      
      // Skip unwanted extensions
      const ext = parsedUrl.pathname.split('.').pop()?.toLowerCase();
      const badExts = ["pdf", "zip", "png", "jpg", "jpeg", "gif", "svg", "exe", "dmg", "mp4", "mp3", "doc", "docx"];
      if (ext && badExts.includes(ext)) return false;

      // Skip login/private paths
      const path = parsedUrl.pathname.toLowerCase();
      if (path.includes("login") || path.includes("signin") || path.includes("signup") || path.includes("register") || path.includes("cart") || path.includes("checkout") || path.includes("dashboard")) {
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }

  private normalizeUrl(url: string, baseUrl: string): string {
    try {
      const parsed = new URL(url, baseUrl);
      parsed.hash = ""; // Remove fragments
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private prioritizeLinks(links: string[]): string[] {
    const scoreLink = (link: string) => {
      const lower = link.toLowerCase();
      if (lower.includes("pricing")) return 100;
      if (lower.includes("product") || lower.includes("features")) return 90;
      if (lower.includes("use-case") || lower.includes("customers") || lower.includes("case-study")) return 80;
      if (lower.includes("about")) return 70;
      if (lower.includes("docs") || lower.includes("blog")) return 50;
      return 0;
    };

    return links.sort((a, b) => scoreLink(b) - scoreLink(a));
  }

  async crawl(input: CrawlerInput): Promise<CrawlerResult> {
    this.visited.clear();
    this.pages = [];
    
    const maxPages = input.maxPages ?? 8;
    const maxDepth = input.maxDepth ?? 2;
    
    await this.crawlUrl(input.baseUrl, input.baseUrl, 0, maxPages, maxDepth, input.request);
    
    return { pages: this.pages };
  }

  private async crawlUrl(url: string, baseUrl: string, depth: number, maxPages: number, maxDepth: number, request?: Request) {
    if (this.pages.length >= maxPages) return;
    if (depth > maxDepth) return;
    
    const normalizedUrl = this.normalizeUrl(url, baseUrl);
    if (this.visited.has(normalizedUrl)) return;
    this.visited.add(normalizedUrl);

    try {
      const response = await timeRequestPhase(request, "crawler.fetch", async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout per page
        try {
          const res = await fetch(normalizedUrl, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          return res;
        } finally {
          clearTimeout(timeout);
        }
      });

      if (!response.ok) return;
      
      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract links before removing elements
      const extractedLinks: string[] = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (href) {
          const absoluteUrl = this.normalizeUrl(href, normalizedUrl);
          if (this.isValidUrl(absoluteUrl, baseUrl)) {
            extractedLinks.push(absoluteUrl);
          }
        }
      });

      // Remove unnecessary elements
      $("script, style, noscript, iframe, img, svg, video, audio, nav, footer, header").remove();

      const title = $("title").text().trim() || undefined;
      let content = $("body").text();
      content = content.replace(/\s+/g, " ").trim();

      if (content.length > 50) {
        this.pages.push({
          url: normalizedUrl,
          title,
          content,
        });
      }

      // Crawl prioritized children
      const uniqueLinks = Array.from(new Set(extractedLinks));
      const prioritized = this.prioritizeLinks(uniqueLinks);

      for (const link of prioritized) {
        if (this.pages.length >= maxPages) break;
        await this.crawlUrl(link, baseUrl, depth + 1, maxPages, maxDepth, request);
      }

    } catch (error) {
      // Silently ignore fetch errors for individual pages during crawl
    }
  }
}
