/* 多语言能力端到端测试：覆盖录入、校验、发布、固化、观众取词与演出中不可变。
   需先以 Node22 启动 server.js（默认 8080）。 */
'use strict';

const BASE = 'http://127.0.0.1:8080';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra || ''); }
}
async function api(method, urlPath, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(BASE + urlPath, opt);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
async function expectFail(name, method, urlPath, body, expectedCode) {
  const r = await api(method, urlPath, body);
  ok(name, r.status >= 400 && r.json.error && r.json.error.code === expectedCode,
    `got ${r.status} ${JSON.stringify(r.json.error)} expected ${expectedCode}`);
  return r;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let r = await api('POST', '/api/sessions', { name: '多语测试场' });
  ok('创建场次', r.status === 200 && !!r.json.id);
  const sid = r.json.id;

  const trilingual = {
    entries: [
      { seq: 1, text: '你好' },
      { seq: 2, text: '世界' },
      { seq: 3, text: '谢谢' },
    ],
    translations: [
      { lang: 'en', entries: [{ seq: 1, text: 'Hello' }, { seq: 2, text: 'World' }] }, // 缺第 3 条
      { lang: 'ja', entries: [{ seq: 1, text: 'こんにちは' }, { seq: 3, text: 'ありがとう' }] },
    ],
  };

  // 1. 保存含译文草稿
  r = await api('PUT', `/api/sessions/${sid}/draft`, trilingual);
  ok('保存多语草稿（允许缺条）', r.status === 200 && r.json.count === 3 && r.json.langs.join(',') === 'en,ja',
    JSON.stringify(r.json));

  r = await api('GET', `/api/sessions/${sid}/draft`);
  ok('读取草稿含译文（按 lang、seq 排序）', r.status === 200 &&
    r.json.entries.length === 3 &&
    r.json.translations.length === 4 &&
    r.json.translations[0].lang === 'en' && r.json.translations[0].seq === 1 &&
    r.json.translations[0].text === 'Hello');

  // 2. 四类拒绝 + 具体原因；且失败不得产生部分版本/部分草稿
  await expectFail('重复语言代码拒绝', 'PUT', `/api/sessions/${sid}/draft`, {
    entries: trilingual.entries,
    translations: [
      { lang: 'en', entries: [{ seq: 1, text: 'A' }] },
      { lang: 'EN', entries: [{ seq: 2, text: 'B' }] } // 大小写规范化后同语言
    ],
  }, 'DUPLICATE_LANG');
  await expectFail('同语言重复字幕序号拒绝', 'PUT', `/api/sessions/${sid}/draft`, {
    entries: trilingual.entries,
    translations: [{ lang: 'en', entries: [{ seq: 1, text: 'A' }, { seq: 1, text: 'B' }] }],
  }, 'DUPLICATE_TSEQ');
  await expectFail('空译文拒绝（缺条应省略而非留空）', 'PUT', `/api/sessions/${sid}/draft`, {
    entries: trilingual.entries,
    translations: [{ lang: 'en', entries: [{ seq: 1, text: '   ' }] }],
  }, 'EMPTY_TRANSLATION');
  await expectFail('引用不存在原文序号拒绝', 'PUT', `/api/sessions/${sid}/draft`, {
    entries: trilingual.entries,
    translations: [{ lang: 'en', entries: [{ seq: 9, text: 'Ghost' }] }],
  }, 'TSEQ_NOT_FOUND');
  await expectFail('非法语言代码拒绝', 'PUT', `/api/sessions/${sid}/draft`, {
    entries: trilingual.entries,
    translations: [{ lang: '中文!', entries: [{ seq: 1, text: 'A' }] }],
  }, 'INVALID_LANG');
  await expectFail('译文非正整数序号拒绝', 'PUT', `/api/sessions/${sid}/draft`, {
    entries: trilingual.entries,
    translations: [{ lang: 'en', entries: [{ seq: -2, text: 'A' }] }],
  }, 'INVALID_TSEQ');
  // 原文校验仍然生效
  await expectFail('原文重复序号仍拒绝', 'PUT', `/api/sessions/${sid}/draft`, {
    entries: [{ seq: 1, text: '一' }, { seq: 1, text: '二' }],
  }, 'DUPLICATE_SEQ');

  r = await api('GET', `/api/sessions/${sid}/draft`);
  ok('失败后草稿保持上次成功状态（无部分写入）',
    r.json.entries.length === 3 && r.json.translations.length === 4,
    JSON.stringify({ e: r.json.entries.length, t: r.json.translations.length }));

  // 3. 发布多语版本（整体固化）
  r = await api('POST', `/api/sessions/${sid}/publish`, trilingual);
  ok('发布 v1（原文+译文一起固化）', r.status === 200 &&
    r.json.versionNo === 1 && r.json.count === 3 && r.json.langs.join(',') === 'en,ja',
    JSON.stringify(r.json));
  const v1 = r.json.id;
  r = await api('GET', `/api/sessions/${sid}/draft`);
  ok('发布后草稿清空（含译文）', r.json.entries.length === 0 && r.json.translations.length === 0);

  r = await api('GET', `/api/sessions/${sid}/versions`);
  ok('版本列表带语言清单', r.json.versions[0].langs.join(',') === 'en,ja', JSON.stringify(r.json.versions[0]));

  r = await api('GET', `/api/sessions/${sid}/versions/${v1}`);
  ok('版本详情含原文与译文', r.json.entries.length === 3 && r.json.translations.length === 4 &&
    r.json.langs.join(',') === 'en,ja');

  // 4. 观众取词接口
  r = await api('GET', `/api/sessions/${sid}/versions/${v1}/content?lang=en`);
  ok('取英文版（仅已译条目）', r.status === 200 && r.json.lang === 'en' &&
    r.json.languages.join(',') === 'en,ja' &&
    r.json.translations.map((t) => t.seq).join(',') === '1,2' &&
    r.json.translations[0].text === 'Hello');
  r = await api('GET', `/api/sessions/${sid}/versions/${v1}/content?lang=EN`);
  ok('语言代码大小写不敏感（EN→en）', r.status === 200 && r.json.lang === 'en');
  r = await api('GET', `/api/sessions/${sid}/versions/${v1}/content?lang=ja`);
  ok('取日文版（缺第2条，客户端回退原文）', r.json.lang === 'ja' &&
    r.json.translations.map((t) => t.seq).join(',') === '1,3');
  r = await api('GET', `/api/sessions/${sid}/versions/${v1}/content`);
  ok('不带 lang：返回原文，translations 为空', r.json.lang === null && r.json.translations.length === 0 &&
    r.json.entries.length === 3);
  r = await api('GET', `/api/sessions/${sid}/versions/${v1}/content?lang=fr`);
  ok('选未发布语言：lang=null 且译文为空（回退原文）', r.status === 200 && r.json.lang === null &&
    r.json.translations.length === 0);
  await expectFail('非法 lang 参数拒绝', 'GET',
    `/api/sessions/${sid}/versions/${v1}/content?lang=${encodeURIComponent('bad lang!')}`, undefined, 'INVALID_LANG');
  await expectFail('不存在版本的 content 404', 'GET',
    `/api/sessions/${sid}/versions/999999/content?lang=en`, undefined, 'VERSION_NOT_FOUND');

  // 5. 扁平形态（{lang,seq,text} 按行）也可用
  r = await api('PUT', `/api/sessions/${sid}/draft`, {
    entries: [{ seq: 1, text: '一' }],
    translations: [
      { lang: 'fr', seq: 1, text: 'un' },
      { lang: 'fr', seq: 1, text: 'deux' }, // 扁平形态同语言同行序号重复 → 仍拒绝
    ],
  });
  ok('扁平形态同样校验重复序号', r.status === 409 && r.json.error.code === 'DUPLICATE_TSEQ');
  r = await api('PUT', `/api/sessions/${sid}/draft`, {
    entries: [{ seq: 1, text: '一' }],
    translations: [
      { lang: 'fr', seq: 1, text: 'un' },
      { lang: 'de', seq: 1, text: 'eins' },
    ],
  });
  ok('扁平形态合法多语言可保存', r.status === 200 && r.json.langs.join(',') === 'de,fr');

  // 6. 演出中发布新版本：已载入版本译文不可变；语言切换不触碰状态版本/控制权
  // 重新发一个干净的 v2 多语版本并载入
  r = await api('POST', `/api/sessions/${sid}/publish`, trilingual);
  const v2 = r.json.id;
  r = await api('POST', `/api/sessions/${sid}/control/grant`, { operator: '多语操作员', ttl: 60 });
  const token = r.json.token;
  const sv0 = (await api('GET', `/api/sessions/${sid}/state`)).json.stateVersion;
  r = await api('POST', `/api/sessions/${sid}/ops`, { action: 'load', versionId: v2, token, stateVersion: sv0 });
  ok('载入 v2', r.status === 200);
  const svAfterLoad = r.json.stateVersion;
  r = await api('POST', `/api/sessions/${sid}/ops`, { action: 'advance', token, stateVersion: svAfterLoad });
  ok('推进到第1条（state 中 current.text 始终为原文）',
    r.json.current.text === '你好' && r.json.current.seq === 1);
  const svAfterAdvance = r.json.stateVersion;

  // 演出中改草稿并发布 v3（英译文变化、新增 fr）
  const v3Body = {
    entries: [{ seq: 1, text: '你好' }, { seq: 2, text: '世界' }],
    translations: [
      { lang: 'en', entries: [{ seq: 1, text: 'CHANGED HELLO' }] },
      { lang: 'fr', entries: [{ seq: 1, text: 'Bonjour' }] },
    ],
  };
  r = await api('POST', `/api/sessions/${sid}/publish`, v3Body);
  ok('演出中可发布 v3', r.status === 200);
  const v3 = r.json.id;
  r = await api('GET', `/api/sessions/${sid}/versions/${v2}/content?lang=en`);
  ok('已载入 v2 的译文不被新版本改动',
    r.json.translations[0].text === 'Hello' && r.json.languages.join(',') === 'en,ja');
  r = await api('GET', `/api/sessions/${sid}/state`);
  ok('观众侧只读取词不改变进度与状态版本（仍停在 v2 第1条）',
    r.json.activeVersionId === v2 && r.json.pos === 1 && r.json.stateVersion === svAfterAdvance);

  // 操作员预览/舞台状态不携带译文（语言是纯设备本地选择）
  ok('state.current 不含翻译字段', r.json.current && Object.keys(r.json.current).sort().join(',') === 'seq,text');

  // 结束演出后才能载入 v3
  r = await api('POST', `/api/sessions/${sid}/ops`, { action: 'end', token, stateVersion: svAfterAdvance });
  ok('结束演出', r.status === 200);
  r = await api('POST', `/api/sessions/${sid}/ops`,
    { action: 'load', versionId: v3, token, stateVersion: r.json.stateVersion });
  ok('载入 v3', r.status === 200 && r.json.activeVersionId === v3);
  r = await api('GET', `/api/sessions/${sid}/versions/${v3}/content?lang=en`);
  ok('v3 英文为新译文且缺条回退由客户端处理（只返回第1条）',
    r.json.translations.length === 1 && r.json.translations[0].text === 'CHANGED HELLO');
  r = await api('GET', `/api/sessions/${sid}/versions/${v3}/content?lang=fr`);
  ok('v3 可选择新发布的 fr 语言', r.json.lang === 'fr' && r.json.translations[0].text === 'Bonjour');

  // 7. 发布空版本/无原文仍拒绝（不能只有译文）
  const onlyTr = await api('POST', `/api/sessions/${sid}/publish`, {
    entries: [],
    translations: [{ lang: 'en', entries: [{ seq: 1, text: 'A' }] }],
  });
  ok('仅译文无原文拒绝发布（EMPTY_VERSION 或更精确的 TSEQ_NOT_FOUND）',
    onlyTr.status === 400 && ['EMPTY_VERSION', 'TSEQ_NOT_FOUND'].includes(onlyTr.json.error && onlyTr.json.error.code),
    JSON.stringify(onlyTr.json));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常', e); process.exit(1); });
