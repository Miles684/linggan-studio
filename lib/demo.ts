import type { ContentItem, Platform } from "./types";
const concepts = [
  [
    "一家小店，也能让人专程而来",
    "把日常，|酿成喜欢",
    "THE DAILY BREW",
    "#e9e2d2",
    "#314c3c",
  ],
  [
    "咖啡店主理人的一天，从这一杯开始",
    "一杯咖啡|一种生活",
    "SLOW MORNING",
    "#d9dfce",
    "#455d42",
  ],
  [
    "让客人记住你的，不止是咖啡",
    "小店经营|灵感手记",
    "SMALL SHOP / BIG IDEAS",
    "#edd4bd",
    "#6a422d",
  ],
  [
    "低预算改造，留住小店的松弛感",
    "把小空间|留给热爱",
    "A ROOM FOR COFFEE",
    "#d3dedb",
    "#365355",
  ],
  [
    "关于菜单设计，我想分享这 5 件小事",
    "好好喝咖啡|好好过日子",
    "EVERYDAY IS A GOOD DAY",
    "#e8dfc8",
    "#65553c",
  ],
  [
    "从一杯拿铁开始，找到小店的节奏",
    "街角的|温柔日常",
    "COFFEE AROUND THE CORNER",
    "#ded0c5",
    "#654f48",
  ],
  [
    "开咖啡店的第 100 天：真实经营记录",
    "第 100 天|仍然热爱",
    "100 DAYS OF BREWING",
    "#d3d9c9",
    "#425440",
  ],
  [
    "能让人停下来的咖啡店门头长什么样？",
    "路过这里|不妨坐坐",
    "STAY FOR A WHILE",
    "#e5cfc1",
    "#715745",
  ],
  [
    "做好这几个细节，客人就会再来",
    "慢一点|也没关系",
    "LITTLE THINGS MATTER",
    "#d5dddf",
    "#415863",
  ],
  [
    "小店的周末，被这些可爱的人填满",
    "分享咖啡|也分享快乐",
    "GOOD COFFEE / GOOD COMPANY",
    "#e7dabd",
    "#645432",
  ],
];
export function poster(index: number, variation = 0) {
  const c = concepts[index % 10];
  const title = c[1].split("|");
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600"><defs><pattern id="p" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".45" fill="#000" opacity=".08"/></pattern><radialGradient id="coffee"><stop stop-color="#b98152"/><stop offset="1" stop-color="#583e2c"/></radialGradient></defs><rect width="480" height="600" fill="${c[3]}"/><rect width="480" height="600" fill="url(#p)"/><rect x="22" y="22" width="436" height="556" fill="none" stroke="${c[4]}" opacity=".28"/><text x="45" y="63" font-size="12" font-family="Arial" letter-spacing="3" fill="${c[4]}">LINGGAN JOURNAL / 0${index + 1}</text><text x="43" y="139" font-size="44" font-family="Microsoft YaHei,sans-serif" font-weight="700" fill="${c[4]}">${title[0]}</text><text x="43" y="197" font-size="44" font-family="Microsoft YaHei,sans-serif" font-weight="700" fill="${c[4]}">${title[1]}</text><path d="M0 445 L480 300 L480 600 L0 600Z" fill="${c[4]}" opacity=".12"/><ellipse cx="250" cy="416" rx="149" ry="41" fill="${c[4]}" opacity=".15"/><ellipse cx="238" cy="405" rx="140" ry="55" fill="#eee9de"/><ellipse cx="238" cy="400" rx="113" ry="43" fill="#d5cabc"/><path d="M320 316 C410 285 410 390 330 388" fill="none" stroke="#f6f1e7" stroke-width="23"/><path d="M138 302 Q130 418 234 423 Q333 423 335 302" fill="#f5f0e6"/><ellipse cx="236" cy="303" rx="100" ry="44" fill="#fdf8ec"/><ellipse cx="236" cy="303" rx="85" ry="34" fill="url(#coffee)"/><path d="M236 325 C190 300 192 282 216 286 Q237 290 236 306 Q239 279 260 285 C288 294 259 312 236 325" fill="#efe3ca"/><path d="M210 251 Q186 228 214 206 M250 254 Q226 226 252 205" fill="none" stroke="${c[4]}" stroke-width="2" opacity=".35"/><text x="45" y="531" font-size="12" font-family="Arial" letter-spacing="2" fill="${c[4]}">${variation ? "ANOTHER LITTLE MOMENT" : c[2]}</text><text x="45" y="554" font-size="11" font-family="Microsoft YaHei,sans-serif" fill="${c[4]}" opacity=".65">创意封面 · 演示素材</text></svg>`,
    )
  );
}
export function getDemo(
  platform: Platform,
  keyword = "咖啡店运营",
): ContentItem[] {
  return concepts.map((c, i) => ({
    id: `demo-${platform}-${encodeURIComponent(keyword)}-${i}`,
    platform,
    demo: true,
    title: keyword === "咖啡店运营" ? c[0] : `${keyword}｜${c[0]}`,
    content: `开一家让人愿意再来的小店，需要的不只是好喝的咖啡。\n\n最近整理了自己的经营笔记，想把这份日常里的小小灵感分享给你：\n① 给空间留一点呼吸感，让每个角落都有自己的温度。\n② 用心记住老客人的喜好，一句问候也能成为再次光顾的理由。\n③ 把真实的店铺日常拍下来，比精心摆拍更能打动人。\n\n愿每一份热爱，都能被好好看见。\n#${keyword} #咖啡日常 #小店经营\n\n（本内容为界面演示示例，并非平台真实笔记。）`,
    author: [
      "山野咖啡手记",
      "阿木的咖啡日常",
      "小林开了家店",
      "留白空间设计",
      "一颗咖啡豆",
      "街角小岛",
      "小周主理人",
      "木木探店",
      "慢慢生活研究所",
      "好天气咖啡",
    ][i],
    cover: poster(i),
    images: [poster(i), poster(i, 1), poster((i + 3) % 10)],
    url: "",
    likes: [32800, 24600, 19200, 15800, 12400, 9200, 8400, 7600, 5900, 4200][i],
    favorites: [12600, 9200, 8100, 6400, 5100, 3800, 2400, 1900, 1300, 900][i],
    comments: [826, 642, 590, 438, 362, 297, 246, 182, 164, 129][i],
    plays:
      platform === "douyin"
        ? [
            823000, 681000, 592000, 428000, 364000, 297000, 241000, 183000,
            167000, 124000,
          ][i]
        : null,
    transcript:
      platform === "douyin"
        ? {
            status: "done",
            rawText:
              "很多人问我开咖啡店最重要的是什么。我想不只是咖啡的味道，更是让每位客人感受到被认真对待。今天分享三个日常经营的小细节。",
            correctedText:
              "很多人问我，开咖啡店最重要的是什么？我想，不只是咖啡的味道，更是让每位客人感受到被认真对待。今天分享三个日常经营的小细节。",
            warning: "演示转写，未调用语音服务。",
          }
        : undefined,
  }));
}
