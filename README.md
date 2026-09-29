# 多设备事件对时工具

现场排障用的网页小工具：把多台设备导出的 JSONL 事件流粘贴进来，为每台设备配置若干
“本地时间 → 基准时间”同步锚点（可带 ±误差），系统按相邻锚点做**分段线性校时**，
把所有设备的事件合并到一条统一时间线上，方便跨设备还原故障发生时序。

## 功能

- 多设备管理：任意添加/删除设备，每台设备独立粘贴 JSONL 事件流
- 同步锚点：每行一条 `本地时间, 基准时间[, ±误差毫秒]`（支持 ISO 8601 字符串或 epoch 毫秒）
- 分段线性校时：相邻锚点之间线性插值；单锚点退化为纯平移
- 锚点校验：**本地时间或基准时间倒序/重复的锚点会被拒绝**并给出中文报错；
  误差缺省按 0 处理，**负数或非数字的误差会定位到具体锚点行并拒绝提交**
- 时间不确定性（区间算术）：锚点误差沿当前分段线性插值/外推，为每条事件给出
  校正区间 `[最早, 最晚]`；外推时不确定度随距离自然放大
- 顺序不确定标记：统一时间线仍按中心值排序；**相邻事件的校正区间相交时，
  这一对两侧事件都标为“顺序不确定”**，可一键只看此类事件
- 外推标记：落在锚点区间之外的事件按最近一段斜率外推，并标记“区间前 / 区间后”
- 统一时间线：按校正后时间排序合并，可同时查看原始时间、校正时间与校正区间，
  可隐藏外推事件
- 时间窗检索：输入基准时间起止（ISO 8601 或 epoch 毫秒），按每条事件的校正区间
  与窗口的相交关系分为**确定命中**（完整区间在窗内）、**可能命中**（仅部分相交）、
  **未命中**三类并分别计数；起止缺失、无法解析或起点晚于终点时给出中文错误，
  且不改动上次检索结果
- 跨设备操作耗时：指定**关联字段**（如 `requestId` / `traceId`）、**状态字段**
  （如 `status`）及开始/结束两种状态值，按关联值分组配对一次操作的开始与结束，
  给出跨设备持续时间范围；缺一端标**未配对**、任一端重复标**歧义**、
  结束区间早于开始区间标**时间冲突**，均不输出时长；缺字段或状态不匹配的事件跳过计数
- 导出：一键下载合并后的 JSONL（含原始时间、校正区间、顺序不确定标记与原始事件）
- 时间字段：默认自动探测 `ts` / `time` / `timestamp`，也可逐设备指定字段名

## 快速开始（Docker，单条命令）

```bash
docker compose up --build
```

启动后访问：**http://localhost:8080**（端口 `8080`）。

## 本地开发（Node.js ≥ 18）

```bash
npm install
npm start        # 同样监听 http://localhost:8080
npm test         # 运行核心校时逻辑单元测试
```

端口可通过环境变量覆盖：`PORT=9000 npm start`（Compose 中同步修改 `ports` 映射）。

## 使用说明

1. 点击 **+ 添加设备**，填写设备名称。
2. 在“同步锚点”框中每行填写一条锚点：`本地时间, 基准时间[, ±误差毫秒]`
   （也支持 `->` 或 Tab 分隔，`#` 开头为注释行）。基准时间通常取 NTP 服务器的
   标准时钟或抓包时间。锚点必须按本地时间和基准时间双双递增，否则提交时会被拒绝。
   第三列 ±误差毫秒可选：表示该锚点基准时间的最大不确定度（如 NTP 同步精度），
   留空按 0 处理；填写负数或非数字会在提交时报错并指出具体行号。
3. 在“事件流”框中粘贴该设备的 JSONL 日志（每行一个 JSON 对象）。
4. 点击 **校时并合并**，下方出现统一时间线：
   - 表格同时展示原始（设备本地）时间、校正（基准）时间与校正区间（最早 ~ 最晚）；
   - 相邻事件的校正区间相交时，两侧事件标为“顺序不确定”（红色行），
     勾选 **只看顺序不确定** 可过滤出这些事件重点排查；
   - “外推”列标出锚点区间外的事件（黄色行），可用复选框隐藏；
   - “紧凑模式”隐藏原始时间列，只看校正后时序。
5. 在统一时间线上方的 **时间窗检索** 中输入基准时间起止（ISO 8601 或 epoch 毫秒，
   回车或点击“检索”）：每条事件按校正区间 `[最早, 最晚]` 与窗口的相交关系打上
   “确定命中 / 可能命中 / 未命中”徽标，并显示三类计数；边界相接算相交。
   起止缺失、无法解析或起点晚于终点时仅提示中文错误，上次检索结果保持不变；
   点击 **清除** 可移除检索标记（输入框内容保留）。重新“校时并合并”后检索结果自动失效。
7. 在统一时间线下方的 **跨设备操作耗时** 中填写：
   - **关联字段名**：日志里标识同一次操作的字段，如 `requestId` / `traceId` / `opId`；
   - **状态字段名**：区分操作阶段的字段，如 `status` / `event`；
   - **开始状态值 / 结束状态值**：一次操作开始与结束对应的两种状态，如 `START` / `END`。
   点击 **分析耗时**，系统按关联值分组：同组**恰有一条开始、一条结束**才配对；
   **缺一端**（只有开始或只有结束）标为“未配对”，**任一端重复**（多条开始或多条结束）
   标为“歧义”，**结束区间早于开始区间**标为“时间冲突”——这三类都不输出时长。
   配对后以两条事件的校正区间 `[最早, 最晚]` 求持续时间范围：
   `最短 = max(0, 结束最早 − 开始最晚)`，`最长 = 结束最晚 − 开始最早`；
   两区间相交时最短为 0。顶部汇总展示各组状态与**跳过数**（缺字段 / 状态不匹配）。
   字段名空缺或两种状态值相同时给出中文错误，**上次分析结果保持不变**；
   重新“校时并合并”后分析结果自动失效。
8. 点击 **导出合并 JSONL** 下载结果，每行格式：

```json
{
  "correctedTime": "2026-09-21T10:05:02.250Z",
  "correctedTimeMs": 1789985102250,
  "correctedEarliest": "2026-09-21T10:05:01.250Z",
  "correctedEarliestMs": 1789985101250,
  "correctedLatest": "2026-09-21T10:05:03.250Z",
  "correctedLatestMs": 1789985103250,
  "uncertaintyMs": 1000,
  "orderUncertain": false,
  "device": "switch-A",
  "rawTime": "2026-09-21T10:05:00.000Z",
  "rawTimeMs": 1789985100000,
  "extrapolated": null,
  "event": { "ts": "2026-09-21T10:05:00.000Z", "msg": "crc rising" }
}
```

页面上的 **载入示例** 按钮可一键填充两台设备的演示数据。

## 校时算法

设设备锚点为 `(L₁,R₁,E₁)…(Lₙ,Rₙ,Eₙ)`（本地→基准→±误差毫秒，时间均已校验严格递增，
误差缺省为 0）。对事件本地时间 `t`，令 `r = (t − Lᵢ) / (Lᵢ₊₁ − Lᵢ)` 为其在当前分段
中的位置：

- 中心值（分段线性）：`R = Rᵢ + r · (Rᵢ₊₁ − Rᵢ)`
  - `Lᵢ ≤ t ≤ Lᵢ₊₁`：分段线性内插
  - `t < L₁`：沿首段斜率外推，标记 `before`
  - `t > Lₙ`：沿末段斜率外推，标记 `after`
  - `n = 1`：纯平移 `R = R₁ + (t − L₁)`，除锚点本身外均标记为外推
- 不确定半宽（区间算术）：把每个锚点基准时间视为区间 `[Rᵢ−Eᵢ, Rᵢ+Eᵢ]`，
  则 `R = (1−r)·Rᵢ + r·Rᵢ₊₁` 的精确区间为 `R ± U`，其中
  `U = |1−r|·Eᵢ + |r|·Eᵢ₊₁`。内插时即两端误差的线性插值；外推时随 `|r|` 增大而
  放大；单锚点平移时 `U = E₁` 保持不变。事件的校正区间为 `[R−U, R+U]`。
- 顺序不确定：统一时间线按中心值 `R` 排序；排序后若相邻两事件满足
  `前一条的最晚值 ≥ 后一条的最早值`（区间相交），则这一对两侧事件都打上
  `orderUncertain` 标记——凭现有校时精度无法断定它们的先后。

## 项目结构

```
server.js            Express 服务（静态页面 + /api/sync、/api/window-search、/api/operation-duration 等接口）
lib/timesync.js      核心校时逻辑（锚点校验、分段线性映射、合并、时间窗分类、操作配对、导出）
public/              原生前端（index.html / app.js / style.css）
test/                node:test 单元测试（校时逻辑 + 操作配对）
Dockerfile           单阶段生产镜像（node:20-alpine）
docker-compose.yml   单服务编排，映射 8080 端口
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/sync` | 提交设备列表（锚点 + JSONL 原文），返回合并时间线与导出 JSONL |
| POST | `/api/parse-anchors` | 解析锚点文本（前端辅助） |
| POST | `/api/window-search` | 时间窗检索：按事件校正区间与窗口的相交关系分类计数 |
| POST | `/api/operation-duration` | 跨设备操作耗时：按关联字段分组配对开始/结束事件，求持续时间范围 |
| GET | `/api/health` | 健康检查 |

`POST /api/sync` 请求体示例：

```json
{
  "devices": [
    {
      "name": "switch-A",
      "timeField": "ts",
      "anchors": [
        { "local": "2026-09-21T10:00:00Z", "ref": "2026-09-21T10:00:02.5Z", "err": 100 },
        { "local": "2026-09-21T10:10:00Z", "ref": "2026-09-21T10:10:02Z" }
      ],
      "eventsText": "{\"ts\":\"2026-09-21T10:05:00Z\",\"msg\":\"crc rising\"}"
    }
  ]
}
```

锚点字段 `err`（±误差毫秒）可选，缺省为 0；锚点倒序或误差为负数/非数字时返回
`422` 及中文错误说明（含锚点序号）；JSONL 坏行、缺时间字段的事件不阻断合并，
在响应的 `parseErrors` / `errors` 字段中列出。响应中每条时间线条目额外携带
`uncertaintyMs`、`correctedEarliest` / `correctedLatest`（校正区间，epoch 毫秒）与
`orderUncertain`（顺序不确定标记），顶层 `orderUncertainCount` 为被标记事件总数。

`POST /api/window-search` 请求体为 `{ windowStart, windowEnd, timeline }`：起止支持
ISO 8601 或 epoch 毫秒，`timeline` 取 `/api/sync` 响应中的时间线数组。响应：

```json
{
  "window": { "startMs": 1789984800000, "endMs": 1789985160000 },
  "counts": { "hit": 2, "partial": 0, "miss": 1 },
  "classes": ["hit", "hit", "miss"]
}
```

`classes` 与提交的 `timeline` 同序：`hit` 确定命中（事件区间完整在窗内）、
`partial` 可能命中（仅部分相交）、`miss` 未命中。起止缺失、无法解析或起点晚于
终点时返回 `400` 及中文错误说明。

`POST /api/operation-duration` 请求体为
`{ timeline, correlationField, statusField, startValue, endValue }`：
`timeline` 取 `/api/sync` 响应中的时间线数组（复用既有合并结果），
`correlationField` / `statusField` 为日志中的关联字段名与状态字段名，
`startValue` / `endValue` 为开始与结束两种状态值。字段名空缺、状态值空缺或两状态值
相同时返回 `400` 及中文错误说明。调用示例：

```bash
curl -s -X POST http://localhost:8080/api/operation-duration \
  -H 'Content-Type: application/json' \
  -d '{
    "timeline": [
      { "correctedEarliest": 900,  "correctedLatest": 1100, "device": "dev-A",
        "event": { "requestId": "req-1", "status": "START" } },
      { "correctedEarliest": 4900, "correctedLatest": 5100, "device": "dev-B",
        "event": { "requestId": "req-1", "status": "END" } },
      { "correctedEarliest": 1900, "correctedLatest": 2100, "device": "dev-A",
        "event": { "requestId": "req-2", "status": "START" } }
    ],
    "correlationField": "requestId",
    "statusField": "status",
    "startValue": "START",
    "endValue": "END"
  }'
```

响应：

```json
{
  "correlationField": "requestId",
  "statusField": "status",
  "startValue": "START",
  "endValue": "END",
  "totalEvents": 3,
  "groupedEvents": 3,
  "skipped": { "missingField": 0, "statusMismatch": 0, "total": 0 },
  "counts": { "paired": 1, "unpaired": 1, "ambiguous": 0, "timeConflict": 0 },
  "groups": [
    {
      "correlation": "req-1",
      "status": "paired",
      "startCount": 1,
      "endCount": 1,
      "start": { "device": "dev-A", "correctedTime": 1000, "correctedEarliest": 900, "correctedLatest": 1100 },
      "end": { "device": "dev-B", "correctedTime": 5000, "correctedEarliest": 4900, "correctedLatest": 5100 },
      "durationMs": { "min": 3800, "max": 4200 }
    },
    {
      "correlation": "req-2",
      "status": "unpaired",
      "startCount": 1,
      "endCount": 0,
      "start": { "device": "dev-A", "correctedTime": 2000, "correctedEarliest": 1900, "correctedLatest": 2100 },
      "end": null,
      "durationMs": null
    }
  ]
}
```

各组 `status` 取值：`paired`（已配对，输出 `durationMs = { min, max }`，
`min = max(0, 结束最早 − 开始最晚)`、`max = 结束最晚 − 开始最早`，区间相交时 `min` 为 0）、
`unpaired`（缺开始或结束一端）、`ambiguous`（任一端重复，`startCount` / `endCount`
给出条数）、`time_conflict`（结束最晚早于开始最早）；后三种均不输出时长（`durationMs: null`）。
`skipped` 为跳过事件计数：`missingField`（缺关联或状态字段）与 `statusMismatch`
（状态值既非开始也非结束）。
