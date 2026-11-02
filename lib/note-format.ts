const characters = new Intl.Segmenter("zh", { granularity: "grapheme" });
const words = new Intl.Segmenter("zh", { granularity: "word" });
const emoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const lineBreak = /^[\r\n]+$/;

export function countCharacters(text: string): number {
  let count = 0;
  for (const { segment } of characters.segment(text)) {
    if (!lineBreak.test(segment)) count++;
  }
  return count;
}

export function withoutEmoji(text: string): string {
  return Array.from(characters.segment(text), ({ segment }) => emoji.test(segment) ? "" : segment).join("");
}

function bodySpacingIsValid(content: string): boolean {
  let sinceEmoji = 0;
  for (const { segment } of characters.segment(content)) {
    if (lineBreak.test(segment)) continue;
    if (emoji.test(segment)) {
      if (sinceEmoji < 30 || sinceEmoji > 40) return false;
      sinceEmoji = 0;
    } else if (++sinceEmoji > 40) {
      return false;
    }
  }
  return sinceEmoji < 30;
}

export function noteFormatError(title: string, content: string, tags: string[]): string {
  const heading = Array.from(characters.segment(title.trim()), ({ segment }) => segment);
  if (!heading.length || heading.length > 20 || /[\r\n]/.test(title))
    return "标题请写在一行内，最多 20 个字符（含表情）。";
  if (heading.filter((part) => emoji.test(part)).length !== 1 ||
      !heading.some((part) => !emoji.test(part) && part.trim()))
    return "标题需要文字和恰好 1 个 emoji 表情。";
  if (!content.trim() || countCharacters(content) > 2000)
    return "正文需要 1–2000 个字符。";
  if (/[#＃][\p{L}\p{N}_]/u.test(content))
    return "请把正文中的话题移至热门标签。";
  if (!bodySpacingIsValid(content))
    return "正文每 30–40 个字符需带 1 个 emoji，不足 30 个字符的尾段可不加。";
  if (tags.length !== 5 || tags.some((tag) => !tag.trim() || countCharacters(tag) > 30 || /[#＃\s]/u.test(tag)))
    return "请填写 5 个热门标签，每个 1–30 个字符，用空格分隔。";
  if (new Set(tags.map((tag) => tag.normalize("NFKC").toLowerCase())).size !== 5)
    return "请使用 5 个不同的热门标签。";
  return "";
}

// A model cannot reliably count graphemes. Move its emoji without changing
// wording, preferring punctuation and word boundaries within each allowed span.
export function spaceBodyEmoji(content: string): string {
  if (bodySpacingIsValid(content)) return content;
  const icons: string[] = [];
  let plain = "";
  for (const { segment } of characters.segment(content)) {
    if (emoji.test(segment)) icons.push(segment);
    else plain += segment;
  }
  const visible = Array.from(characters.segment(plain)).filter(({ segment }) => !lineBreak.test(segment));
  const boundaries = new Set(Array.from(words.segment(plain), ({ index, segment }) => index + segment.length));
  let offset = 0, lastEnd = 0, iconIndex = 0;
  let result = "";
  while (visible.length - offset >= 30) {
    const limit = Math.min(offset + 40, visible.length);
    let position = limit, bestScore = -1;
    for (let i = limit; i >= offset + 30; i--) {
      const { segment, index } = visible[i - 1];
      const end = index + segment.length;
      let score = 0;
      if (i === visible.length || /[。！？；，、.!?;,:：”」）)]/u.test(segment)) score = 3;
      else if (/\s/u.test(plain[end] ?? "")) score = 2;
      else if (boundaries.has(end)) score = 1;
      if (score > bestScore) {
        position = i;
        bestScore = score;
      }
    }
    const last = visible[position - 1];
    const end = last.index + last.segment.length;
    result += plain.slice(lastEnd, end) + (icons[iconIndex++] ?? "✨");
    lastEnd = end;
    offset = position;
  }
  return (result + plain.slice(lastEnd)).trim();
}
