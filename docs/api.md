# 热点采集接口说明

本版完成 TikHub 关键词采集，以及百炼 Paraformer → 千问纠错的服务端调用链。没有密钥时真实采集会明确提示配置，不以演示结果替代真实接口。2026-11-02 已使用用户授权密钥验证双平台真实采集，以及一条抖音视频的 Paraformer 转写和千问纠错。

## 本站接口

所有 POST 使用 JSON；响应设置 `Cache-Control: private, no-store`。请求可按需附上 `credentials: { tikhubKey?, dashscopeKey?, qwenKey? }`，仅本次使用。采集、语音识别分别使用 TikHub 和百炼密钥，未传时分别读取服务器的 `TIKHUB_API_KEY`、`DASHSCOPE_API_KEY`。千问图片、文案及转写纠错依次尝试请求中的 `qwenKey`、服务器的 `QWEN_API_KEY`、请求中的 `dashscopeKey`、服务器的 `DASHSCOPE_API_KEY`。密钥不会写入业务数据或返回客户端。百炼使用北京地域密钥。

| 路径 | 请求 | 返回 |
| --- | --- | --- |
| GET `/api/config` | 无 | `tikhubConfigured`, `dashscopeConfigured`, `qwenConfigured`（仅布尔值，各自表示服务器是否配置了对应密钥） |
| POST `/api/support` | `question`（最多 800 字符）、`previousTopicIds?`（上轮主题）、`credentials?` | `kind`（answer/refusal/clarify）、`reply`、`topicIds` |
| POST `/api/collect` | `platform`, `keyword`, `credentials?` | `items`, `warnings`, `fetchedAt`, `keyword`, `platform` |
| POST `/api/transcribe` | `videoUrl`, `credentials?` | `taskId` |
| POST `/api/transcribe/status` | `taskId`, `credentials?` | `status`, `rawText?`, `correctedText?`, `warning?`, `error?` |
| POST `/api/images/import` | `url` | 图片二进制（采集图片或百炼生成图片） |
| POST `/api/create/image` | `mode`, `prompt?`, `images?`, `size`, `credentials?` | `taskId`, `status`, `model` |
| POST `/api/create/image/status` | `taskId`, `credentials?` | `status`, `images?`, `error?`, `model` |
| POST `/api/create/copy` | `mode`, `idea?`, `source?`, `requirements?`, `experience?`, `credentials?` | `title`, `content`, `tags`, `model`, `warnings?` |
| POST `/api/create/douyin` | `source: { platform: "douyin", id, title, transcript }`, `direction`, `feedback?`, `previous?`, `credentials?` | `voiceover`、有序 `shots: [{ duration, visual, voiceover }]` |

抖音编辑器一次只引用抖音采集列表中的一条视频。接口需要原口播转写（最多 24,000 个字符）与创作方向；修改意见可在第一稿就填写。继续修订时传回当前稿作为 `previous`，同时保留同一来源和创作方向。服务端使用千问生成每镜的时长、景别、动作和台词，依次计算时间段，并将有台词的镜头合并成完整口播。独立的请求体上限为 256 KiB。生成或修订均由用户主动触发。

用户点击所选抖音作品的「获取语音文案」后，前端为该作品调用 `POST /api/transcribe` 并轮询状态。重复点击正在处理的作品会复用进行中的任务。状态为 `PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED`。成功后调用千问纠错。千问失败会保留识别原文并给出警告。24,000 字以上的识别结果保留全文、跳过纠错，以避免长文本被模型截断。

## TikHub

固定 API 域名 `https://api.tikhub.io`，Bearer 鉴权。

- 抖音：POST `/api/v1/douyin/search/fetch_video_search_v2`，发送 `keyword`、`cursor:0`、`sort_type:"1"`、`publish_time:"0"`、`content_type:"1"`、`filter_duration:"0"`、空 `search_id` / `backtrace`。识别 `data.business_data[].data.aweme_info` 中的文案、作者、`statistics` 和 `video.play_addr`。[官方视频搜索文档](https://docs.tikhub.io/370212780e0)
- 小红书：GET `/api/v1/xiaohongshu/app_v2/search_notes`，`keyword`、`page:1`、`sort_type:popularity_descending`，随后对选中笔记 GET `/api/v1/xiaohongshu/app_v2/get_image_note_detail?note_id=…` 获取全文与图集。图文详情端点也支持视频笔记，但只返回视频封面；本任务不额外获取小红书视频。[官方搜索文档](https://docs.tikhub.io/420136398e0)、[官方详情文档](https://docs.tikhub.io/420136391e0)

“Top 10”是本次关键词搜索返回内容中按点赞量排序的前十条，并非全网完整排行。搜索不足十条且还有下一页时最多采集三页，再去重取十条；小红书最多并发三个详情请求。平台可能返回不足十条；详情失败保留搜索结果并标记。缺失统计为 `null`，不伪造为 0。真实接口计费依供应商账户与套餐执行。

## 百炼和千问

固定北京地域兼容域名 `https://dashscope.aliyuncs.com`。官方目前推荐业务空间专属域名，但明确现有域名继续可用。

1. POST `/api/v1/services/audio/asr/transcription`，头 `X-DashScope-Async: enable`，模型 `paraformer-v2`，`input.file_urls` 每次一个公开可下载视频 URL，`channel_id:[0]`。获取 `output.task_id`。
2. GET `/api/v1/tasks/{taskId}` 查询 `output.task_status`，检查 `results[].subtask_status`，不能仅凭整体成功判定视频成功。方法依据[最新官方异步任务管理 API](https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks)及[英文 Paraformer 文档](https://help.aliyun.com/en/model-studio/paraformer-recorded-speech-recognition-restful-api)；中文 Paraformer 页的表格/部分示例写 POST，与其 cURL、英文页及通用接口文档冲突，本版采用 GET。
3. 成功后 GET 阿里云签名 `transcription_url`，读取 `transcripts[].text`；该请求不附密钥且禁重定向。结果 URL 一般 24 小时失效。[官方 Paraformer HTTP 文档](https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api)
4. POST `/compatible-mode/v1/chat/completions`，模型 `qwen-plus`、`enable_thinking:false`。只校正明显错别字与标点，原始转写同时保留。[官方千问兼容接口文档](https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope)

视频直链可能带有效期或防盗链，百炼服务必须能够自行下载；失败时请重新采集再试。代码不会尝试绕过平台限制，也不会把背景音乐链接当成口播音轨。无法公开下载的视频可在后续版本加入授权下载和 OSS 中转。

## 安全边界与验证

本机 `npm run dev` 通过开发中间件提供 `/api/local-keys`：GET 只返回文件路径和四项配置状态；POST 同源 JSON 的 `credentials` 非空字段增量写入用户目录 `LingganStudio/api-keys.json`。文件 schema 为 `{version:1,keys:{...}}`，仅允许现有四项密钥。文件创建和保存不会发生在项目目录，损坏文件不会被覆盖。

每次本机 API 请求都从文件读取密钥。中间件清除外来桥接头，只有环回地址、本机 Host、合法来源的请求才注入带随机启动令牌的内部头；Worker 验证令牌后合并本机默认值，合法非空会话值优先。不向前端返回已保存密钥，生产构建无桥接令牌。图片下载等无关路由不会合并凭据。

私有 Sites 访问控制保护服务器密钥；本版不应在配置共享服务器密钥后直接开放匿名访问。POST 拒绝跨站 Origin / Fetch-Site；仅 JSON、默认最多 16 KB 请求，图片生成单独允许 8 MB、文案生成允许 144 KB；转写地址限制为 HTTPS 抖音相关域名；生成结果地址限制为百炼 OSS 或方舟专用输出桶域名。出站响应有大小上限、超时、禁重定向，第三方错误经过脱敏。

## 小红书内容创作

- 图片使用 `qwen-image-2.1-pro`。图片优化接收一张产品效果图、重绘提示词、原图宽高和 1K 或 2K 分辨率。服务端核对图片比例后按原比例计算输出尺寸。图生图使用固定提示词，接收 2–10 张参考图，支持 1:1、3:4、4:3、2:3、3:2、16:9 和 9:16。新增 2:3 / 3:2 分别使用 832×1248 / 1248×832，适用于全部三个生图模型。两个模式均支持 JPEG、PNG 和 WebP，单张压缩后最多 1.5 MB，整次请求最多 8 MB。[官方图像生成与编辑 API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- 图片提交 `POST /api/v1/services/aigc/image-generation/generation`，使用 `X-DashScope-Async: enable`；状态通过 `GET /api/v1/tasks/{taskId}` 查询。客户端保存任务编号，暂停或刷新后继续查询相同任务，不自动重新提交生成。成功从 `output.choices[].message.content[].image` 取得结果；生成 URL 通常有效 24 小时，存入资料库时会下载实际文件。[2.1 Pro 模型信息](https://help.aliyun.com/zh/model-studio/qwen-image-2-1-pro)
- 图片请求的 `model` 还支持 `doubao-seedream-5-0-flash-260915`、`doubao-seedream-5-0-pro-260628`；省略时保持千问默认值。两种 Seedream 均使用火山方舟北京地域 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，仅发送独立 `arkKey` / `ARK_API_KEY`，不回退到百炼或千问密钥。设置页可配置会话密钥，服务器配置仅返回是否已配置。[官方模型说明](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh)
- Seedream 接收按原顺序排列的 `image` 数组与原始创作提示词，使用 `response_format:url`、PNG 输出，单次等待最多 180 秒；成功直接返回 `{status:"done",images,model}`，无需任务轮询。超时或连接中断时保留未确认状态，不自动重提。参考图须能解码且宽高至少 15 像素；3:4 / 4:3 输出适配为 864×1152 / 1152×864，其余画幅保持原比例，图片优化保留 1K / 2K 与原图比例。[官方图片 API](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-api)
- Seedream 预览和下载共用输出域名校验，同时接受官方北京图片桶 `ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com` 和共用 AIGC 桶 `ark-acg-cn-beijing.tos-cn-beijing.volces.com`；保留原始 URL 签名参数。下载时检查图片类型、文件头和大小，不附带服务密钥，不接受任意 TOS 桶或跳转。[官方输出源站列表](https://docs.byteplus.com/en/docs/iga/ai_acceleration_overview_en-us)
- 文案使用 `qwen-plus` 的非思考 JSON 模式，服务端固定语气、真实性规则和输出结构。输入的原稿和用户要求作为 JSON 数据发送，不能改写系统消息。`idea` 模式根据想法创作，`rewrite` 模式根据原稿重新组织，原作者的经历不当作创作者本人经历；未提供真实体验时返回单独提醒，并检查明显的已发生亲历声明。命中检查时拒绝该次结果，不自动重新调用收费服务；此检查不能代替人工事实核对。输出标题最多 20 个可见字符，含 1 个表情；正文每 30–40 个字符配 1 个表情，另附 5 个不同的相关热门标签。修订时附上原来的创作资料、当前草稿及修改意见，仍经过相同的事实与格式检查。[结构化输出](https://help.aliyun.com/en/model-studio/qwen-structured-output)

运行 `node --test tests/api.test.mjs tests/workerd-services.test.mjs`。测试覆盖 V2 数据结构、未知统计、Top10去重排序、分页、详情失败、HTTP 200 内业务失败、鉴权错误、异步 ASR 全流程、纠错失败保留原文、URL限制和跨站请求校验；测试使用注入的假响应，不访问真实供应商。

Worker 回归测试直接在本地 workerd 运行生产服务函数，拦截全部出站请求并模拟 302，验证请求选项兼容性、跳转阻断及不向目标转发鉴权。Cloudflare Workers 不实现 `redirect:"error"`，会在构造请求时立即抛异常，因此使用 `redirect:"manual"` 并显式拒绝 3xx。[官方 Request 文档](https://developers.cloudflare.com/workers/runtime-apis/request/)；`AbortSignal.timeout()` 在请求上下文中可用，本地相同兼容日期验证通过。[官方 AbortSignal 说明](https://developers.cloudflare.com/changelog/post/2026-08-19-abort-signal-global-scope/)
