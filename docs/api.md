# 热点采集接口说明

本版完成 TikHub 关键词采集，以及百炼 Paraformer → 千问纠错的服务端调用链。没有密钥时真实采集会明确提示配置，不以演示结果替代真实接口。2026-11-02 已使用用户授权密钥验证双平台真实采集，以及一条抖音视频的 Paraformer 转写和千问纠错。

## 本站接口

所有 POST 使用 JSON；响应设置 `Cache-Control: private, no-store`。请求可附 `credentials: { tikhubKey?, dashscopeKey? }`，仅本次使用；空值回落到服务器环境变量 `TIKHUB_API_KEY` / `DASHSCOPE_API_KEY`。密钥不会写入业务数据或返回客户端。百炼使用北京地域密钥。

| 路径 | 请求 | 返回 |
| --- | --- | --- |
| GET `/api/config` | 无 | `tikhubConfigured`, `dashscopeConfigured`（仅布尔值） |
| POST `/api/collect` | `platform`, `keyword`, `credentials?`, `autoTranscribe?` | `items`, `warnings`, `fetchedAt`, `keyword`, `platform` |
| POST `/api/transcribe` | `videoUrl`, `credentials?` | `taskId` |
| POST `/api/transcribe/status` | `taskId`, `credentials?` | `status`, `rawText?`, `correctedText?`, `warning?`, `error?` |

`autoTranscribe` 由前端控制：采集不等待音频处理，前端针对各视频逐个提交并限并发轮询。状态为 `PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED`；成功后再调用千问。千问失败会保留识别原文并给出警告。24,000 字以上的识别结果保留全文、跳过纠错，以避免长文本被模型截断。

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

私有 Sites 访问控制保护服务器密钥；本版不应在配置共享服务器密钥后直接开放匿名访问。POST 拒绝跨站 Origin / Fetch-Site；仅 JSON、最多 16 KB 请求；转写地址限制为 HTTPS 抖音相关域名；结果地址限制为百炼 OSS 域名。出站响应最大 8 MB、有超时、禁重定向，第三方错误经过脱敏。

运行 `node --test tests/api.test.mjs tests/workerd-services.test.mjs`。测试覆盖 V2 数据结构、未知统计、Top10去重排序、分页、详情失败、HTTP 200 内业务失败、鉴权错误、异步 ASR 全流程、纠错失败保留原文、URL限制和跨站请求校验；测试使用注入的假响应，不访问真实供应商。

Worker 回归测试直接在本地 workerd 运行生产服务函数，拦截全部出站请求并模拟 302，验证请求选项兼容性、跳转阻断及不向目标转发鉴权。Cloudflare Workers 不实现 `redirect:"error"`，会在构造请求时立即抛异常，因此使用 `redirect:"manual"` 并显式拒绝 3xx。[官方 Request 文档](https://developers.cloudflare.com/workers/runtime-apis/request/)；`AbortSignal.timeout()` 在请求上下文中可用，本地相同兼容日期验证通过。[官方 AbortSignal 说明](https://developers.cloudflare.com/changelog/post/2026-08-19-abort-signal-global-scope/)
