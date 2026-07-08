import type { Channel } from "@/modules/platform/contracts";
import type {
  ChannelContent,
  InstagramContent,
  NoteContent,
  SiteBlogContent,
  XContent,
} from "@/modules/ai-studio/contracts";

export const CHANNEL_LABELS: Record<Channel, string> = {
  site_blog: "自サイトブログ",
  note: "note",
  x: "X (旧Twitter)",
  instagram: "Instagram",
};

export const ALL_CHANNELS: Channel[] = ["site_blog", "note", "x", "instagram"];

/** 差分表示・プレビュー用にチャネル別 content を平文へ射影する (§10.1 の「元発言 vs draft」用) */
export function channelContentToText(channel: Channel, content: unknown): string {
  if (!content || typeof content !== "object") return "";
  switch (channel) {
    case "site_blog": {
      const c = content as SiteBlogContent;
      return `# ${c.title}\n\n${c.excerpt}\n\n${c.body_md}`;
    }
    case "note": {
      const c = content as NoteContent;
      return `# ${c.title}\n\n${c.body_md}\n\n${(c.hashtags ?? []).map((h) => `#${h}`).join(" ")}`;
    }
    case "x": {
      const c = content as XContent;
      return (c.thread ?? []).map((t, i) => `[${i + 1}/${c.thread.length}] ${t.text}`).join("\n\n");
    }
    case "instagram": {
      const c = content as InstagramContent;
      return `${c.caption}\n\n${(c.hashtags ?? []).map((h) => `#${h}`).join(" ")}`;
    }
  }
}

export function isChannelContentFor<C extends Channel>(_channel: C, content: unknown): content is ChannelContent[C] {
  return Boolean(content) && typeof content === "object";
}
