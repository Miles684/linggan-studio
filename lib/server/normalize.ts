import type { ContentItem } from "../types";

type Obj = Record<string, any>;
const obj = (v: unknown): Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Upstream statistics are nullable; never substitute an unavailable count with zero. */
export function count(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const match = value
    .trim()
    .replace(/,/g, "")
    .match(/^(\d+(?:\.\d+)?)\s*(万|亿|[kKmMwW])?\+?$/);
  if (!match) return null;
  const multiplier =
    match[2] === "亿"
      ? 1e8
      : /^(万|w)$/i.test(match[2] || "")
        ? 1e4
        : /^k$/i.test(match[2] || "")
          ? 1e3
          : /^m$/i.test(match[2] || "")
            ? 1e6
            : 1;
  return Math.round(Number(match[1]) * multiplier);
}

export function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

function imageUrl(value: unknown): string {
  if (typeof value === "string") return httpUrl(value);
  const v = obj(value);
  for (const key of [
    "url_default",
    "urlDefault",
    "original",
    "url",
    "url_size_large",
    "url_pre",
    "url_size_medium",
    "url_size_small",
  ]) {
    const found = httpUrl(v[key]);
    if (found) return found;
  }
  for (const item of [
    ...(Array.isArray(v.url_list) ? v.url_list : []),
    ...(Array.isArray(v.info_list) ? v.info_list : []),
    ...(Array.isArray(v.infoList) ? v.infoList : []),
  ]) {
    const found = imageUrl(item);
    if (found) return found;
  }
  return "";
}

/** Walk a bounded upstream response, supporting App-V2 wrapper variations. */
function candidates(root: unknown, platform: "douyin" | "xiaohongshu"): Obj[] {
  const results: Obj[] = [];
  const queue: unknown[] = [root];
  for (let i = 0; i < queue.length && i < 12000; i++) {
    const value = queue[i];
    if (Array.isArray(value)) {
      queue.push(...value.slice(0, 200));
      continue;
    }
    const v = obj(value);
    if (
      platform === "douyin" &&
      v.aweme_id &&
      (v.desc !== undefined || v.video)
    ) {
      results.push(v);
      continue;
    }
    if (platform === "xiaohongshu") {
      const note = obj(v.note_card ?? v.noteCard ?? v.note);
      if (
        Object.keys(note).length &&
        (v.id || v.note_id || note.note_id || note.id)
      ) {
        results.push({
          ...note,
          id: note.note_id ?? note.id ?? v.note_id ?? v.id,
          xsec_token: v.xsec_token ?? note.xsec_token,
        });
        continue;
      }
      const id = v.note_id ?? v.noteId ?? v.id;
      if (
        id &&
        (v.title !== undefined ||
          v.display_title !== undefined ||
          v.displayTitle !== undefined ||
          v.desc !== undefined ||
          v.content !== undefined) &&
        (v.images_list ||
          v.image_list ||
          v.imageList ||
          v.images ||
          v.cover ||
          v.interact_info ||
          v.interactInfo ||
          v.liked_count !== undefined ||
          v.type === "normal" ||
          v.type === "video")
      ) {
        results.push(v);
        continue;
      }
    }
    for (const [key, child] of Object.entries(v)) {
      if (
        child &&
        typeof child === "object" &&
        ![
          "user",
          "author",
          "music",
          "statistics",
          "interact_info",
          "cover",
          "video",
          "image_list",
          "images_list",
          "images",
          "avatar",
          "avatar_thumb",
        ].includes(key)
      )
        queue.push(child);
    }
  }
  return results;
}

export function normalizeDouyin(payload: unknown): ContentItem[] {
  return candidates(payload, "douyin").map((v) => {
    const id = String(v.aweme_id);
    const stats = obj(v.statistics);
    const video = obj(v.video);
    const content = str(v.desc);
    const title =
      str(v.item_title) ||
      str(v.title) ||
      content.split(/\n/)[0].slice(0, 96) ||
      "未提供标题";
    return {
      id,
      platform: "douyin" as const,
      title,
      content,
      author: str(obj(v.author).nickname) || "作者未提供",
      cover: imageUrl(video.cover) || imageUrl(video.origin_cover),
      images: [],
      url: `https://www.douyin.com/video/${encodeURIComponent(id)}`,
      likes: count(stats.digg_count),
      favorites: count(stats.collect_count),
      comments: count(stats.comment_count),
      plays: count(stats.play_count),
      videoUrl:
        imageUrl(video.play_addr) || imageUrl(video.download_addr) || undefined,
      transcript: { status: "idle" as const },
    };
  });
}

export function normalizeXiaohongshu(payload: unknown): ContentItem[] {
  return candidates(payload, "xiaohongshu").map((v) => {
    const id = String(v.note_id ?? v.noteId ?? v.id);
    const stats = obj(v.interact_info ?? v.interactInfo);
    const rawImages =
      v.images_list ?? v.image_list ?? v.images ?? v.imageList ?? [];
    const images = [
      ...new Set<string>(
        (Array.isArray(rawImages) ? rawImages : [])
          .map(imageUrl)
          .filter(Boolean),
      ),
    ];
    const cover = imageUrl(v.cover) || images[0] || "";
    const url = new URL(
      `https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}`,
    );
    if (str(v.xsec_token)) {
      url.searchParams.set("xsec_token", v.xsec_token);
      url.searchParams.set("xsec_source", "pc_search");
    }
    let sourceUrl = "";
    for (const raw of [obj(v.share_info).link, v.share_url, v.url]) {
      const safe = httpUrl(raw);
      if (
        safe &&
        ["xiaohongshu.com", "xhslink.com", "xhslink.cn"].some(
          (domain) =>
            new URL(safe).hostname === domain ||
            new URL(safe).hostname.endsWith(`.${domain}`),
        )
      ) {
        sourceUrl = safe;
        break;
      }
    }
    return {
      id,
      platform: "xiaohongshu" as const,
      title:
        str(v.title) ||
        str(v.display_title) ||
        str(v.displayTitle) ||
        "未提供标题",
      content: str(v.desc) || str(v.content) || str(v.description),
      author:
        str(obj(v.user ?? v.author).nickname) ||
        str(obj(v.user).nick_name) ||
        "作者未提供",
      cover,
      images: images.length ? images : cover ? [cover] : [],
      url: sourceUrl || url.toString(),
      likes: count(
        stats.liked_count ?? stats.likedCount ?? v.liked_count ?? v.likes,
      ),
      favorites: count(
        stats.collected_count ?? stats.collectedCount ?? v.collected_count,
      ),
      comments: count(
        stats.comment_count ??
          stats.commentCount ??
          v.comments_count ??
          v.comment_count,
      ),
      plays: null,
    };
  });
}

export function topTen(items: ContentItem[]): ContentItem[] {
  const unique = new Map<string, ContentItem>();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()]
    .sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1))
    .slice(0, 10);
}

export function transcriptText(payload: unknown): string {
  const root = obj(payload);
  const transcripts = Array.isArray(root.transcripts) ? root.transcripts : [];
  return transcripts
    .map((t) => {
      const record = obj(t);
      return (
        str(record.text) ||
        (Array.isArray(record.sentences)
          ? record.sentences.map((s) => str(obj(s).text)).join("")
          : "")
      );
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
