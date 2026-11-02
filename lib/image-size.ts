export type ImageResolution = "1K" | "2K";

export function optimizedImageSize(
  width: number,
  height: number,
  resolution: ImageResolution,
): string {
  const pixels = (resolution === "2K" ? 2048 : 1024) ** 2;
  let divisor = width;
  let remainder = height;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];

  // Prefer exact integer multiples of the original aspect ratio when they
  // fit the requested resolution. Large coprime dimensions need rounding.
  const unitWidth = width / divisor;
  const unitHeight = height / divisor;
  const multiple = Math.floor(Math.sqrt(pixels / (unitWidth * unitHeight)));
  if (multiple * multiple * unitWidth * unitHeight >= pixels * 0.9)
    return `${multiple * unitWidth}*${multiple * unitHeight}`;

  const ratio = Math.max(width, height) / Math.min(width, height);
  const shortEdge = Math.floor(Math.sqrt(pixels / ratio));
  const longEdge = Math.min(Math.round(shortEdge * ratio), Math.floor(pixels / shortEdge));
  return width >= height ? `${longEdge}*${shortEdge}` : `${shortEdge}*${longEdge}`;
}
