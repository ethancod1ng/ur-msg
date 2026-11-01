# Cloudflare D1 UR 空房页面设计

## 目标

将公开的 UR 空房页面改为以 Cloudflare D1 为正式数据源，并在保持“找房优先”的前提下展示可信的监控运行状态。页面只展示当前仍可申请的房源；下架房源立即隐藏；首次发现未满 24 小时的房源显示 `NEW`。

## 页面定位

采用公开只读的“单页找房流”，不制作历史页面或面向运维人员的复杂仪表盘。

页面从上到下分为：

1. 品牌区及当前固定筛选条件说明。
2. 紧凑运行状态栏。
3. 实用筛选区。
4. 当前房源卡片列表。
5. 数据声明与 UR 官方入口。

## 运行状态栏

状态栏显示：

- 运行状态。
- 最近一次成功检查时间。
- 当前有效房源数量。
- 过去 24 小时新增数量。

状态判断规则：

- `运行正常`：最近一次成功检查不超过 10 分钟。
- `可能延迟`：最近一次成功检查超过 10 分钟且不超过 30 分钟。
- `监控异常`：超过 30 分钟没有成功检查，或最近一次检查失败。

异常信息使用面向用户的简短说明，不显示 GitHub、Worker、堆栈等内部实现细节。

## 筛选与排序

页面提供以下即时筛选，不需要重新加载：

- 关键词：房源名称、区域或车站。
- 区域。
- 户型。
- 最高月总额。
- 最长通勤时间。
- 排序方式。

默认排序为：24 小时内新增房源优先，其余按月总额从低到高排列。

## 房源卡片

主价格显示 `租金 + 共益费` 的月总额，小字分别列出房租和共益费。卡片同时展示：

- 区域、房源名称和房间号。
- 户型、面积和楼层。
- 到茅场町的预计总时间。
- 换乘次数、使用车站及交通说明。
- UR 官方详情链接。

`first_seen_at` 距当前时间不满 24 小时时显示 `NEW`。已下架房源不出现在公开页面。

## D1 数据模型

### `vacancies`

保存当前和曾经发现的房源：

- `key`：稳定的房源唯一标识，主键。
- `building_id`、`room_id`。
- `building`、`city`、`room`。
- `rent_yen`、`common_fee_yen`、`monthly_total_yen`。
- `layout`、`floor_space`、`floor`。
- `access`、`url`。
- `commute_station`、`commute_minutes`、`commute_train_minutes`、`commute_access_minutes`、`commute_transfers`。
- `first_seen_at`、`last_seen_at`。
- `is_active`。

### `monitor_runs`

保存每次检查结果：

- `id`：运行记录主键。
- `started_at`、`completed_at`。
- `status`：`success` 或 `failure`。
- `vacancy_count`、`new_count`、`removed_count`。
- `error_summary`：经过裁剪和净化的错误摘要。
- `snapshot_id`：用于防止同一快照重复写入。

## 数据流

```text
Cloudflare Cron
  → GitHub workflow_dispatch
  → Python 检查 UR
  → POST /api/snapshots
  → Cloudflare Worker 校验并写入 D1
  → GET /api/dashboard
  → 公开单页渲染当前房源与运行状态
```

成功快照在一个数据库事务中完成：

1. 通过 `snapshot_id` 做幂等检查。
2. 插入本次运行记录。
3. 新增首次出现的房源并保留 `first_seen_at`。
4. 更新仍存在房源的字段和 `last_seen_at`。
5. 将本次完整结果中不再存在的旧房源设为 `is_active = 0`。

失败运行只写入失败记录，不修改现有房源状态。这样 UR 请求失败、GitHub 运行失败或 D1 写入失败都不会把全部房源错误地标记为下架。

## Worker API

### `GET /api/dashboard`

公开接口，一次返回：

- 运行状态及最后成功时间。
- 当前房源数和 24 小时新增数。
- 可用区域和户型选项。
- 当前有效房源。

响应可以缓存 60 秒，减少 D1 读取并保持页面足够及时。

### `POST /api/snapshots`

私有写入接口。使用 `Authorization: Bearer <SNAPSHOT_API_TOKEN>`。Token 分别保存在 Cloudflare Secret 和 GitHub Actions Secret 中，不进入源码、网页或日志。

接口校验：

- Bearer Token。
- Content-Type 和请求体大小。
- 快照 ID、运行时间和房源数组。
- 必填字段、数字范围和 UR 官方 URL。
- 合理的最大房源数量。

任何校验或事务失败均返回错误且不部分更新数据库。

### `GET /health`

仅表示 Worker 可以响应，不替代页面中的监控状态。

## 迁移与上线

1. 创建 D1 数据库和迁移文件。
2. 从现有 `data/state.json` 导入当前房源，使用导入时间作为初始 `first_seen_at` 和 `last_seen_at`。
3. 设置 Cloudflare 和 GitHub 的 `SNAPSHOT_API_TOKEN`。
4. 修改监控脚本，在每次成功检查后提交完整快照；失败时提交失败运行或由独立步骤报告失败。
5. 先验证 D1 API 数据，再切换公开页面。
6. 稳定运行后，停止使用 `state.json` 作为网页数据源；是否保留它作为备份另行决定。

上线顺序保证切换期间页面不会变空。

## 错误处理

- D1 暂时不可用：页面显示读取错误，不展示伪造的空列表。
- 最近检查异常：保留上次成功房源并显示红色监控状态。
- 重复快照：返回成功或幂等响应，不重复计算新增/下架。
- 非法或超大快照：拒绝写入，保留原数据库状态。
- 页面筛选无结果：显示“没有符合当前筛选的房源”，区别于“当前没有有效房源”。

## 验证范围

自动测试覆盖：

- 首次导入和后续增量快照。
- 24 小时 `NEW` 判断。
- 下架房源从公开 API 消失。
- 重复快照幂等。
- 失败运行不修改房源。
- Token、请求体和字段校验。
- 正常、延迟、异常状态边界。
- 月总额计算和默认排序。
- 公开 API 不泄露内部错误与密钥。

视觉验证覆盖桌面和手机端的加载、正常、空结果、筛选无结果和接口错误状态。

