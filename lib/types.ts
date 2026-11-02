export type Platform = "douyin" | "xiaohongshu";
export type Transcript = {
  status: "idle" | "pending" | "running" | "done" | "error";
  rawText?: string;
  correctedText?: string;
  error?: string;
  warning?: string;
};
export type ContentItem = {
  id: string;
  platform: Platform;
  title: string;
  content: string;
  author: string;
  cover: string;
  images: string[];
  url: string;
  likes: number | null;
  favorites: number | null;
  comments: number | null;
  plays: number | null;
  videoUrl?: string;
  transcript?: Transcript;
  demo?: boolean;
};
export type Credentials = { tikhubKey?: string; dashscopeKey?: string };
