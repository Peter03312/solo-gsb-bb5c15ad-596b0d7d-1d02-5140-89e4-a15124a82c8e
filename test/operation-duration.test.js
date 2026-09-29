'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pairOperations } = require('../lib/timesync');

/** 构造一个时间线条目：校正区间 [earliest, latest]，原始事件为 event。 */
function entry(earliest, latest, event, device = 'dev') {
  return {
    device,
    correctedTime: (earliest + latest) / 2,
    correctedEarliest: earliest,
    correctedLatest: latest,
    event,
  };
}

const opts = { correlationField: 'requestId', statusField: 'status', startValue: 'START', endValue: 'END' };

test('pairOperations 正常配对：最短 = max(0, 结束最早 − 开始最晚)，最长 = 结束最晚 − 开始最早', () => {
  const timeline = [
    entry(0, 100, { requestId: 'r1', status: 'START' }, 'dev-A'),
    entry(400, 500, { requestId: 'r1', status: 'END' }, 'dev-B'),
  ];
  const result = pairOperations(timeline, opts);
  assert.equal(result.totalEvents, 2);
  assert.equal(result.groupedEvents, 2);
  assert.equal(result.skipped.total, 0);
  assert.deepEqual(result.counts, { paired: 1, unpaired: 0, ambiguous: 0, timeConflict: 0 });
  const g = result.groups[0];
  assert.equal(g.correlation, 'r1');
  assert.equal(g.status, 'paired');
  assert.equal(g.startCount, 1);
  assert.equal(g.endCount, 1);
  assert.equal(g.start.device, 'dev-A');
  assert.equal(g.end.device, 'dev-B');
  assert.deepEqual(g.durationMs, { min: 300, max: 500 });
});

test('pairOperations 区间相交时最短持续时间保留为 0', () => {
  const timeline = [
    entry(0, 200, { requestId: 'r1', status: 'START' }),
    entry(100, 300, { requestId: 'r1', status: 'END' }),
  ];
  const result = pairOperations(timeline, opts);
  assert.equal(result.counts.paired, 1);
  assert.deepEqual(result.groups[0].durationMs, { min: 0, max: 300 });
});

test('pairOperations 点区间（误差为 0）时长为确定值', () => {
  const timeline = [
    entry(100, 100, { requestId: 'r1', status: 'START' }),
    entry(500, 500, { requestId: 'r1', status: 'END' }),
  ];
  const result = pairOperations(timeline, opts);
  assert.deepEqual(result.groups[0].durationMs, { min: 400, max: 400 });
});

test('pairOperations 结束区间早于开始区间 -> 时间冲突且不输出时长', () => {
  const timeline = [
    entry(400, 500, { requestId: 'r1', status: 'START' }),
    entry(0, 100, { requestId: 'r1', status: 'END' }),
  ];
  const result = pairOperations(timeline, opts);
  assert.equal(result.counts.timeConflict, 1);
  assert.equal(result.groups[0].status, 'time_conflict');
  assert.equal(result.groups[0].durationMs, null);
  // 开始最晚 = 结束最早 的边界（恰好相接）不算冲突
  const timeline2 = [
    entry(100, 200, { requestId: 'r2', status: 'START' }),
    entry(200, 300, { requestId: 'r2', status: 'END' }),
  ];
  const result2 = pairOperations(timeline2, opts);
  assert.equal(result2.groups[0].status, 'paired');
  assert.deepEqual(result2.groups[0].durationMs, { min: 0, max: 200 });
});

test('pairOperations 缺一端（只有开始或只有结束）-> 未配对且不输出时长', () => {
  const timeline = [
    entry(0, 100, { requestId: 'r1', status: 'START' }),
    entry(0, 100, { requestId: 'r2', status: 'END' }),
  ];
  const result = pairOperations(timeline, opts);
  assert.equal(result.counts.unpaired, 2);
  assert.deepEqual(result.groups.map((g) => g.status), ['unpaired', 'unpaired']);
  assert.ok(result.groups.every((g) => g.durationMs === null));
  assert.equal(result.groups[0].startCount, 1);
  assert.equal(result.groups[0].endCount, 0);
  assert.equal(result.groups[0].end, null);
});

test('pairOperations 任一端重复 -> 歧义且不输出时长', () => {
  const timeline = [
    entry(0, 100, { requestId: 'r1', status: 'START' }),
    entry(10, 110, { requestId: 'r1', status: 'START' }),
    entry(400, 500, { requestId: 'r1', status: 'END' }),
    entry(0, 100, { requestId: 'r2', status: 'START' }),
    entry(400, 500, { requestId: 'r2', status: 'END' }),
    entry(410, 510, { requestId: 'r2', status: 'END' }),
  ];
  const result = pairOperations(timeline, opts);
  assert.equal(result.counts.ambiguous, 2);
  assert.deepEqual(result.groups.map((g) => g.status), ['ambiguous', 'ambiguous']);
  assert.ok(result.groups.every((g) => g.durationMs === null));
});

test('pairOperations 缺字段或状态不匹配的事件跳过并分别计数', () => {
  const timeline = [
    entry(0, 100, { requestId: 'r1', status: 'START' }),
    entry(400, 500, { requestId: 'r1', status: 'END' }),
    entry(0, 100, { status: 'START' }), // 缺关联字段
    entry(0, 100, { requestId: 'r2' }), // 缺状态字段
    entry(0, 100, { requestId: 'r3', status: 'BEGIN' }), // 状态不匹配
    entry(0, 100, { requestId: '', status: 'START' }), // 关联值为空串，按缺字段计
    entry(0, 100, { requestId: 'r4', status: 'START', extra: 'x' }),
  ];
  const result = pairOperations(timeline, opts);
  assert.equal(result.totalEvents, 7);
  assert.equal(result.groupedEvents, 3); // r1 两条 + r4 一条（r4 缺结束，未配对）
  assert.equal(result.skipped.missingField, 3);
  assert.equal(result.skipped.statusMismatch, 1);
  assert.equal(result.skipped.total, 4);
  assert.equal(result.counts.paired, 1);
  assert.equal(result.counts.unpaired, 1);
});

test('pairOperations 支持数字型关联值与状态值（按字符串归一分组/比较）', () => {
  const timeline = [
    entry(0, 100, { opId: 42, code: 1 }),
    entry(400, 500, { opId: 42, code: 2 }),
  ];
  const result = pairOperations(timeline, {
    correlationField: 'opId',
    statusField: 'code',
    startValue: '1',
    endValue: '2',
  });
  assert.equal(result.counts.paired, 1);
  assert.equal(result.groups[0].correlation, '42');
  assert.deepEqual(result.groups[0].durationMs, { min: 300, max: 500 });
});

test('pairOperations 字段名空缺或两状态值相同时抛错', () => {
  assert.throws(() => pairOperations([], { ...opts, correlationField: '  ' }), /请填写关联字段名/);
  assert.throws(() => pairOperations([], { ...opts, statusField: '' }), /请填写状态字段名/);
  assert.throws(() => pairOperations([], { ...opts, startValue: '' }), /请填写开始状态值/);
  assert.throws(() => pairOperations([], { ...opts, endValue: '' }), /请填写结束状态值/);
  assert.throws(() => pairOperations([], { ...opts, startValue: 'START', endValue: 'START' }), /不能相同/);
});

test('pairOperations 空时间线返回全零结果', () => {
  const result = pairOperations([], opts);
  assert.deepEqual(result.counts, { paired: 0, unpaired: 0, ambiguous: 0, timeConflict: 0 });
  assert.deepEqual(result.groups, []);
  assert.equal(result.skipped.total, 0);
});

test('pairOperations 不改动传入的时间线条目', () => {
  const timeline = [
    entry(0, 100, { requestId: 'r1', status: 'START' }),
    entry(400, 500, { requestId: 'r1', status: 'END' }),
  ];
  const before = JSON.stringify(timeline);
  pairOperations(timeline, opts);
  assert.equal(JSON.stringify(timeline), before);
});
