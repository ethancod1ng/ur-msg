# Tokyo UR vacancy monitor

每 5 分钟检查一次符合个人条件的东京 UR 空室：月租不超过 100,000 日元，且到工作地点茅場町的保守估算通勤不超过 60 分钟。GitHub Actions 的计划任务可能因排队延迟，并不保证精确到分钟。租金上限不含共益费。第一次运行只建立基线，不会把当前全部房源发到 Telegram。

通勤时间采用 UR 官方车站间数据，并加上房源交通说明中步行和巴士区间的最大值。无法可靠匹配车站的数据会被排除，以免推送过远房源。

除每 5 分钟的新增监控外，系统每天 08:30 JST 发送一次当前全部符合条件的空室汇总。每日汇总不修改新增监控的去重状态；如果没有符合条件的房源，会发送一条简短的“暂无空室”消息。

Cloudflare Worker 同时提供公开只读网页，展示 Cloudflare D1 中的当前空房和监控状态。网页支持手机访问、区域与户型筛选、最高月总额与最长通勤筛选，以及新增/月总额/通勤/面积排序，每 5 分钟自动刷新；最终房源状态仍以 UR 官方详情页为准。

D1 保存房源首次发现、最后发现和是否仍有效的信息，并记录每次检查结果。公开页面只显示当前仍有效的房源，首次发现 24 小时内标记为 `NEW`。`data/state.json` 暂时继续保留，作为 Telegram 增量通知和回滚数据。

## GitHub 设置

1. 在 Telegram 中联系 `@BotFather`，用 `/newbot` 创建机器人并取得 token。
2. 给机器人发送一条消息，然后访问：
   `https://api.telegram.org/bot<你的TOKEN>/getUpdates`
   从返回结果的 `message.chat.id` 取得 chat ID。
3. 将本项目推送到 GitHub 仓库。
4. 打开仓库 **Settings → Secrets and variables → Actions → Secrets**，添加：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
5. 打开 **Actions → Monitor Tokyo UR vacancies → Run workflow** 手动运行一次。成功后会生成并提交 `data/state.json`；后续只有新增空室才推送。

Telegram token 属于密码，不要写入代码、日志或提交到仓库。

## 可选筛选

在 **Settings → Secrets and variables → Actions → Variables** 中按需添加：

| 变量 | 示例 | 说明 |
|---|---|---|
| `UR_CITIES` | `新宿区,渋谷区` | 仅保留指定市区，逗号分隔 |
| `UR_LAYOUTS` | `1LDK,2LDK` | 仅保留指定户型 |
| `UR_MAX_RENT_YEN` | `85000` | 覆盖默认的 100,000 日元最高月租，不含共益费 |
| `UR_MAX_COMMUTE_MINUTES` | `50` | 覆盖默认的茅場町 60 分钟通勤上限 |

市区和户型留空表示不限制；租金上限默认为 100,000 日元，通勤上限默认为 60 分钟。

## 本地验证

```powershell
python -m unittest discover -s tests -v
python src/ur_monitor.py --dry-run
```

本项目调用 UR 网站页面自身使用的公开 JSON 接口。UR 可能随时调整接口或字段；发生错误时 GitHub Actions 会标红并保留日志，不会覆盖上一次成功快照。
