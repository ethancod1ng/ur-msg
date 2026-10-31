# Tokyo UR vacancy monitor

每 30 分钟检查一次东京都 UR 空室，并在出现新房间时推送到 Telegram。第一次运行只建立基线，不会把当前全部房源发到 Telegram。

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
| `UR_MAX_RENT_YEN` | `150000` | 最高月租，不含共益费 |

全部留空即监控东京都所有 UR 空室。

## 本地验证

```powershell
python -m unittest discover -s tests -v
python src/ur_monitor.py --dry-run
```

本项目调用 UR 网站页面自身使用的公开 JSON 接口。UR 可能随时调整接口或字段；发生错误时 GitHub Actions 会标红并保留日志，不会覆盖上一次成功快照。
