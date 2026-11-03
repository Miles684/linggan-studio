export const IMAGE_MODELS = [
  { id: "qwen-image-2.1-pro", label: "通义千问 · Qwen Image 2.1 Pro", provider: "qwen" },
  { id: "doubao-seedream-5-0-flash-260915", label: "火山方舟 · Seedream 5.0 Flash", provider: "ark" },
  { id: "doubao-seedream-5-0-pro-260628", label: "火山方舟 · Seedream 5.0 Pro", provider: "ark" },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];
export const DEFAULT_IMAGE_MODEL: ImageModelId = "qwen-image-2.1-pro";

export function getImageModel(value: unknown) {
  return IMAGE_MODELS.find((model) => model.id === value);
}

export function imageModelLabel(value: string): string {
  return getImageModel(value)?.label || value;
}

export type ImageSubmissionResult =
  | { status: "pending"; taskId: string; model: ImageModelId }
  | { status: "done"; images: string[]; model: ImageModelId };
