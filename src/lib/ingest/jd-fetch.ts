import * as cheerio from "cheerio";

export type JdFetchResult = {
  text: string;
  url: string | null;
  portal: string;
  /** True when the page came back but clearly is not the job description. */
  blocked: boolean;
  blockReason: string | null;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function portalOf(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("naukri")) return "Naukri";
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("indeed")) return "Indeed";
    if (host.includes("greenhouse")) return "Greenhouse";
    if (host.includes("lever")) return "Lever";
    if (host.includes("workday")) return "Workday";
    if (host.includes("wellfound") || host.includes("angel.co")) return "Wellfound";
    return host;
  } catch {
    return "unknown";
  }
}

/**
 * Most job boards and ATS-hosted careers pages publish schema.org JobPosting
 * JSON-LD. When it is there it is far cleaner than scraping the rendered DOM,
 * so it is tried first.
 */
function jobPostingFromJsonLd($: cheerio.CheerioAPI): string | null {
  const blocks = $('script[type="application/ld+json"]').toArray();
  for (const block of blocks) {
    const raw = $(block).contents().text();
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      const node = c as Record<string, unknown>;
      const graph = (node["@graph"] as Record<string, unknown>[] | undefined) ?? [];
      for (const item of [node, ...graph]) {
        if (item?.["@type"] !== "JobPosting") continue;
        const parts = [
          `Job title: ${item.title ?? ""}`,
          `Company: ${(item.hiringOrganization as Record<string, unknown>)?.name ?? ""}`,
          `Employment type: ${item.employmentType ?? ""}`,
          `Location: ${JSON.stringify(item.jobLocation ?? "")}`,
          `Date posted: ${item.datePosted ?? ""}`,
          "",
          cheerio.load(String(item.description ?? "")).text(),
        ];
        const text = parts.join("\n").trim();
        if (text.length > 300) return text;
      }
    }
  }
  return null;
}

function visibleText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, svg, header, footer, nav, form").remove();
  const scoped = $("main").text().trim() || $("article").text().trim() || $("body").text();
  return scoped.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
}

const WALL_MARKERS = [
  "sign in to continue",
  "join linkedin",
  "please enable javascript",
  "are you a robot",
  "captcha",
  "access denied",
  "enable cookies",
  "this page isn't available",
];

export async function fetchJd(url: string): Promise<JdFetchResult> {
  const portal = portalOf(url);
  let html: string;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        text: "",
        url,
        portal,
        blocked: true,
        blockReason: `${portal} returned HTTP ${res.status}.`,
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      text: "",
      url,
      portal,
      blocked: true,
      blockReason: `Could not reach the page (${(err as Error).message}).`,
    };
  }

  const $ = cheerio.load(html);
  const text = jobPostingFromJsonLd($) ?? visibleText($);
  const lower = text.toLowerCase();
  const wall = WALL_MARKERS.find((m) => lower.includes(m));

  // A real JD is long. A login wall or a client-rendered shell is not.
  if (text.length < 600 || wall) {
    return {
      text,
      url,
      portal,
      blocked: true,
      blockReason: wall
        ? `${portal} served a sign-in or bot-check page instead of the job description.`
        : `${portal} returned too little text to be the job description — the page is probably rendered client-side.`,
    };
  }

  return { text, url, portal, blocked: false, blockReason: null };
}
