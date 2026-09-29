'use strict';

const path = require('path');
const express = require('express');
const {
  parseJsonl,
  mergeTimeline,
  toJsonl,
  normalizeWindow,
  classifyWindow,
  pairOperations,
  AUTO_TIME_FIELDS,
} = require('./lib/timesync');

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/sync
 * body: { devices: [{ name, timeField?, anchors: [{local, ref}], eventsText }] }
 * eventsText 为 JSONL 原文；服务端解析、校时、合并后返回统一时间线与可下载的 JSONL。
 */
app.post('/api/sync', (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.devices) || body.devices.length === 0) {
    return res.status(400).json({ error: '至少需要 1 台设备' });
  }
  if (body.devices.length > 50) {
    return res.status(400).json({ error: '设备数量超过上限（50）' });
  }

  // 先解析各设备 JSONL，解析错误不阻断，随结果返回
  const devices = [];
  const parseErrors = [];
  for (const d of body.devices) {
    const name = (d && typeof d.name === 'string' ? d.name.trim() : '') || '未命名设备';
    const { events, errors } = parseJsonl(d && d.eventsText);
    for (const e of errors) parseErrors.push({ device: name, ...e });
    devices.push({
      name,
      timeField: typeof d.timeField === 'string' && d.timeField.trim() ? d.timeField.trim() : undefined,
      anchors: Array.isArray(d.anchors) ? d.anchors : [],
      events,
    });
  }

  let merged;
  try {
    merged = mergeTimeline(devices);
  } catch (err) {
    return res.status(422).json({ error: err.message, parseErrors });
  }

  merged.parseErrors = parseErrors;
  merged.jsonl = toJsonl(merged);
  res.json(merged);
});

/** POST /api/parse-anchors：前端实时校验锚点文本（每行 "本地时间, 基准时间[, ±误差毫秒]"）。 */
app.post('/api/parse-anchors', (req, res) => {
  const text = (req.body && req.body.text) || '';
  const anchors = [];
  const errors = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) return;
      const parts = trimmed.split(/\s*(?:,|->|\t)\s*/);
      if (parts.length < 2 || parts.length > 3) {
        errors.push({ line: idx + 1, message: '格式应为：本地时间, 基准时间[, ±误差毫秒]' });
        return;
      }
      const anchor = { local: parts[0], ref: parts[1] };
      if (parts.length === 3) {
        const errText = parts[2].replace(/^[±+]\s*/, '').trim();
        if (!/^\d+(\.\d+)?$/.test(errText)) {
          errors.push({ line: idx + 1, message: `误差须为非负毫秒数（得到 "${parts[2]}"）` });
          return;
        }
        anchor.err = Number(errText);
      }
      anchors.push(anchor);
    });
  res.json({ anchors, errors });
});

/**
 * POST /api/window-search
 * body: { windowStart, windowEnd, timeline: [{ correctedEarliest, correctedLatest, ... }] }
 * 时间窗检索：把每条事件的校正区间与窗口做区间相交判断，返回三类计数
 * （确定命中/可能命中/未命中）及每条事件（按提交顺序）的类别。
 * 窗口起止缺失、无法解析或起点晚于终点时返回 400 及中文错误，调用方不应改动已有结果。
 */
app.post('/api/window-search', (req, res) => {
  const body = req.body || {};
  let window;
  try {
    window = normalizeWindow(body.windowStart, body.windowEnd);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const timeline = Array.isArray(body.timeline) ? body.timeline : [];
  const { counts, results } = classifyWindow(timeline, window.startMs, window.endMs);
  res.json({
    window: { startMs: window.startMs, endMs: window.endMs },
    counts,
    classes: results.map((r) => r.windowClass),
  });
});

/**
 * POST /api/operation-duration
 * body: { timeline: [...], correlationField, statusField, startValue, endValue }
 * 跨设备操作耗时分析：按关联字段分组，同组恰有一条开始、一条结束才配对；
 * 缺一端（未配对）或任一端重复（歧义）均不输出时长。配对后以校正区间求持续时间：
 * 最短 = max(0, 结束最早 − 开始最晚)，最长 = 结束最晚 − 开始最早；
 * 结束最晚早于开始最早时标记时间冲突且不输出时长。缺字段/状态不匹配的事件跳过并计数。
 * 字段名空缺、状态值空缺或两状态值相同时返回 400 及中文错误，调用方不应改动已有结果。
 */
app.post('/api/operation-duration', (req, res) => {
  const body = req.body || {};
  try {
    const result = pairOperations(Array.isArray(body.timeline) ? body.timeline : [], {
      correlationField: body.correlationField,
      statusField: body.statusField,
      startValue: body.startValue,
      endValue: body.endValue,
    });
    res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, autoTimeFields: AUTO_TIME_FIELDS }));

app.listen(PORT, () => {
  console.log(`多设备事件对时工具已启动: http://localhost:${PORT}`);
});
