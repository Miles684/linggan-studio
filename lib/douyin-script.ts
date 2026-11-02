import type { Credentials } from "./types";

export const DOUYIN_TRANSCRIPT_LIMIT = 24_000;
export const DOUYIN_DIRECTION_LIMIT = 2_000;
export const DOUYIN_FEEDBACK_LIMIT = 2_000;

export type DouyinSource = {
  platform: "douyin";
  id: string;
  title: string;
  transcript: string;
};

export type DouyinShot = {
  duration: string;
  visual: string;
  voiceover: string;
};

export type DouyinScript = { voiceover: string; shots: DouyinShot[] };

export type DouyinScriptRequest = {
  source: DouyinSource;
  direction: string;
  feedback?: string;
  previous?: DouyinScript;
  credentials?: Credentials;
};
