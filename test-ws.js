/* WS 行为验证：
 *  1) 连接即收 hello（含最新已确认字幕）；
 *  2) 操作员推进时观众收到 state 广播（观众从不发送任何状态变更）；
 *  3) 模拟“切换语言与推进同时发生”：先切语言（本地只 GET content），随后立刻收到推进广播，
 *     最终渲染依据最后到达的 state × 语言缓存——脚本以接收顺序断言最终文本属于最新进度。
 */
'use strict';
const WebSocket = require('ws');
const BASE = 'http://127.0.0.1:8080';

async function api(method, urlPath, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(BASE + urlPath, opt);
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openWS(sid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:8080/ws?sid=${sid}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
/** 连接后持续收集消息；waitFor 轮询直到出现指定类型消息 */
function collect(ws) {
  const msgs = [];
  ws.on('message', (buf) => msgs.push(JSON.parse(buf.toString())));
  const waitFor = async (type, pred) => {
    for (let i = 0; i < 50; i++) {
      const m = msgs.find((x) => x.type === type && (!pred || pred(x)));
      if (m) return m;
      await sleep(100);
    }
    throw new Error('等待消息超时: ' + type);
  };
  return { msgs, waitFor };
}

(async () => {
  let fail = 0;
  const ok = (name, cond, extra) => {
    console.log(cond ? `  ✅ ${name}` : `  ❌ ${name} ${extra || ''}`);
    if (!cond) fail++;
  };

  const { json: s } = await api('POST', '/api/sessions', { name: 'WS恢复场' });
  const sid = s.id;
  const pub = await api('POST', `/api/sessions/${sid}/publish`, {
    entries: [{ seq: 1, text: '第一' }, { seq: 2, text: '第二' }],
    translations: [{ lang: 'en', entries: [{ seq: 1, text: 'First' }, { seq: 2, text: 'Second' }] }],
  });
  const vid = pub.json.id;
  const grant = await api('POST', `/api/sessions/${sid}/control/grant`, { operator: 'wsop', ttl: 60 });
  const token = grant.json.token;
  let st = (await api('POST', `/api/sessions/${sid}/ops`,
    { action: 'load', versionId: vid, token, stateVersion: 1 })).json;
  st = (await api('POST', `/api/sessions/${sid}/ops`,
    { action: 'advance', token, stateVersion: st.stateVersion })).json;
  ok('演出推进到第1条，原文为「第一」', st.current.text === '第一');

  // 观众连接：hello 即最新已确认字幕
  const ws = await openWS(sid);
  const { waitFor } = collect(ws);
  const hello = await waitFor('hello');
  ok('hello 下发最新已确认字幕（原文）',
    hello.state.current.seq === 1 && hello.state.current.text === '第一',
    JSON.stringify(hello.state.current));

  // 观众“切换语言”：只发起只读 GET，不通过 WS 发送任何东西
  const c1 = await api('GET', `/api/sessions/${sid}/versions/${vid}/content?lang=en`);
  const enMap = new Map(c1.json.translations.map((t) => [t.seq, t.text]));
  ok('本地取得英文缓存 #1=First', enMap.get(1) === 'First');

  // 切换语言与推进“同时发生”：语言 GET 与操作员 advance 并行
  const results = await Promise.all([
    api('GET', `/api/sessions/${sid}/versions/${vid}/content?lang=en`),
    api('POST', `/api/sessions/${sid}/ops`, { action: 'advance', token, stateVersion: st.stateVersion }),
  ]);
  const broadcast = await waitFor('state', (m) => m.state.pos === 2);
  ok('收到推进广播：最新进度第2条', broadcast.state.pos === 2 && broadcast.state.current.seq === 2,
    JSON.stringify(broadcast.state.current));
  const finalEn = new Map(results[0].json.translations.map((t) => [t.seq, t.text]));
  // 最终渲染 = 最新 state(seq2) × en 缓存 => Second（而非切换瞬间的 First）
  const finalShown = finalEn.get(broadcast.state.current.seq) || broadcast.state.current.text;
  ok('并发后最终只显示最新进度对应文本（seq2 → Second）', finalShown === 'Second', finalShown);
  ok('推进操作后 stateVersion 单调递增（广播为准）',
    broadcast.state.stateVersion === st.stateVersion + 1, String(broadcast.state.stateVersion));
  ws.close();

  console.log(fail ? `\nWS 测试失败 ${fail} 项` : '\nWS 行为全部符合预期');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('WS 测试异常', e); process.exit(1); });
