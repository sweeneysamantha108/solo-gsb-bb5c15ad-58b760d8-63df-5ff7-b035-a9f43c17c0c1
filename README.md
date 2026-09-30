# 🎭 小剧场网页走词台（Theater Prompter）

一个完全本地化的网页走词台：**Node.js + SQLite + 浏览器 WebSocket 实时连接，无任何外部服务**。

- **编辑者**：在编辑页录入有序字幕条目（序号 + 原文），并可**按语言代码（如 `en`、`ja`、`zh-hans`）逐序号录入译文**；随时保存草稿、发布「演出版本」。发布时**原文与译文在同一事务内整体固化到同一演出版本**。**发布之后的修改只进入草稿，正在演出的版本（含译文）始终保持发布时的原样**。
- **操作员**：输入名字取得**有时限**的控制权后，可推进 / 回退 / 清屏 / 载入版本 / 结束演出。**同一场次同一时刻仅一人持有控制权**；过期、主动释放后，他人可立即接管。多语言对舞台操作完全透明。
- **观众页**：投影或演员设备打开即大字实时显示当前字幕，并可**在本设备上选择该演出版本已发布的语言**；某条缺译文时自动显示原文。**语言切换只改变本设备显示，不改变全场进度、状态版本与操作员控制权**；**断线自动重连、服务重启后自动恢复本设备所选语言与最新已确认字幕**。
- 每个舞台操作都必须基于「页面所见的状态版本」。重复提交、基于旧版本、控制权失效或属于他人的请求一律拒绝，并返回明确中文原因。
- 译文保存/发布同样强校验：**重复语言代码、同一语言内重复字幕序号、空译文、引用不存在的原文序号都会整体拒绝并指出具体原因，绝不产生部分版本或部分草稿**。

## 一、一键启动（Docker Compose，推荐）

前置：已安装 Docker（含 Compose 插件）。

```bash
docker compose up -d --build
```

启动后访问（假设本机 IP 为 `localhost`）：

| 入口 | 地址 |
| --- | --- |
| 场次首页（建场次、进入各角色页） | http://localhost:8080/ |
| 编辑者页 | 首页点「编辑者页」，或 `http://localhost:8080/editor.html?sid=<场次ID>` |
| 操作员页 | `http://localhost:8080/operator.html?sid=<场次ID>` |
| 观众页（投影/演员手机） | `http://localhost:8080/audience.html?sid=<场次ID>` |

停止 / 查看日志：

```bash
docker compose logs -f
docker compose down            # 停止并删除容器（数据卷保留，见下）
docker compose down -v         # 同时删除字幕数据（谨慎）
```

数据保存在 Docker 命名卷 `prompter-data`（容器内 `/data/prompter.db`）中，容器重建、镜像升级后场次与演出版本不丢失。

## 二、不用 Docker 的本地启动

需要 Node.js **≥ 22.5**（使用 Node 内置的 `node:sqlite`，无需编译任何原生模块）。

```bash
npm install        # 仅安装一个纯 JS 依赖 ws
npm start          # 等价于 node --experimental-sqlite server.js
```

> Node 22 中 `node:sqlite` 为实验特性，启动参数 `--experimental-sqlite` 已在 `npm start` 与 Dockerfile 中配置好，仅有一行实验性提示，不影响使用。

## 三、配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 监听端口。Compose 中改宿主机端口请编辑 `docker-compose.yml` 的 `"宿主:8080"` 映射。 |
| `HOST` | `0.0.0.0` | 监听地址。 |
| `DB_PATH` | `./data/prompter.db`（容器内 `/data/prompter.db`） | SQLite 数据库文件路径，所在目录自动创建。 |
| `CONTROL_TTL` | `30` | 控制权默认有效秒数，服务端钳制在 **10～300 秒**；操作员每次取得/续期时也可在页面上自选 10～300 秒。 |

Compose 示例（改端口与默认时长）：

```yaml
ports:
  - "8081:8080"
environment:
  CONTROL_TTL: "60"
```

## 四、使用流程

1. 打开首页「新建场次」，得到一个场次及三个角色页链接。
2. **编辑者页**：逐行填写序号与原文 →「保存草稿」可随时暂存；确认无误后「发布为演出版本」。
   - 校验规则：原文序号必须是正整数且**不可重复**；原文文本**不能为空**；空草稿**不能发布**。
   - **多语言译文**：在「语言代码」框输入代码（如 `en`、`ja`、`zh-hans`，大小写不敏感）后「＋ 添加语言列」，每个语言成为表格中的一列，按**字幕序号**在对应格填写译文。
     - **译文允许缺条**：某条没有译文时该格留空即可，观众端选择该语言时自动回退显示原文（不要填空白文本占位）。
     - 校验规则：同一语言代码**不可重复添加**；同一语言内字幕序号**不可重复**；已填写的译文**不能为空**；译文**只能引用草稿中存在的原文序号**。
     - 任一校验失败都会**整体拒绝**本次保存/发布，错误信息指明具体语言、序号与原因，**不会生成部分版本**。
   - 发布后草稿自动清空（含译文），可继续编排下一版；历史版本与其译文永久保留、不可修改。
3. **操作员页**：填写名字、选择时长 →「取得控制权」。
   - 页面显示倒计时，可「续期」或「释放」；到期未续则自动失效，他人点「取得/接管」即可。
   - 「载入版本」选择一个已发布版本开始演出（载入后为清屏，按「推进」显示第一条）。下拉中可看到每个版本包含的语言。
   - 演出中可 推进 / 回退 / 清屏；**演出中不允许切换版本**，需先「结束演出」再载入其他版本。**演出中编辑者发布新版本不会改动已载入版本的任何译文**。
4. **观众页**：打开后无需登录，自动跟随舞台；建议浏览器全屏（F11）。
   - 右上角「显示语言」下拉只列出**当前已载入版本实际发布过的语言**（外加「原文」）。选择后仅本设备生效，偏好记在本机浏览器（localStorage）。
   - 当前字幕在所选语言下缺译文时显示原文，左下角会标注「原文（缺译文）」。
   - 语言切换与推进/回退以任何顺序发生，最终都只显示**最新进度**对应序号、所选语言的文本。

## 五、一致性与冲突处理（设计要点）

- **状态版本 `stateVersion`**：每场演出维护一个单调递增版本号，随每次被接受的舞台操作 +1。操作请求必须携带页面当前所见的版本号：
  - 与服务器一致才执行；不一致返回 `409 STALE_STATE` 并提示「你的页面基于 vN，服务器当前为 vM」——重复点击、网络重试、基于旧页面的提交都不会改变状态。
  - 页面同时通过 WebSocket 实时收到权威状态，冲突后自动与服务器对齐。
- **控制权**：每场最多一条控制权记录（含随机 token、持用人、到期时间）。
  - 仍被他人持有且未过期 → `409 CONTROL_HELD`；token 缺失/错误/已过期 → `403 NO_CONTROL / CONTROL_OTHER / CONTROL_EXPIRED`。
  - 所有校验在 SQLite 事务（`BEGIN IMMEDIATE`）内完成；后台清扫仅按 `(场次, token)` 精确删除到期记录，不会误删并发取得的新控制权。
- **版本不可变（含译文）**：发布时把草稿的原文与译文分别整体复制成独立的 published 版本（同一 `BEGIN IMMEDIATE` 事务）；之后任何编辑都发生在新草稿上。舞台引用的版本 ID 不变，所以「演出中的字幕及其译文保持原版本」。译文表 `entry_translations(version_id, lang, seq, text, UNIQUE(version_id,lang,seq))` 与版本同生命周期（级联删除）。
- **多语言是纯设备端视图**：观众的语言选择只保存在本设备 `localStorage`（键 `prompter:<sid>:lang`），观众端只发起**只读** `GET …/content?lang=`，从不发送舞台操作。因此切换语言不会触碰 `stateVersion`、进度与控制权。观众端按已载入版本缓存译文，渲染恒为「最新已确认状态（WS）× 本设备所选语言缓存」的组合，所以切换语言与推进并发时最终只显示最新进度对应文本；缺译文序号直接回退 `state.current.text`（原文）。
- **持久化与恢复**：当前版本、位置、状态版本、控制权、各版本译文全部在 SQLite（WAL 模式）。WebSocket 每次连接（包括观众断线重连、服务进程重启后的重连）立即下发一次 `hello`，内容即数据库中的最新已确认状态；语言偏好存于观众本机，二者齐备后观众端自动恢复「最新字幕 + 所选语言」。旧版本数据库首次启动会自动补建译文表，历史场次与演出状态不受影响。

## 六、HTTP / WebSocket 接口摘要

REST 前缀 `/api/sessions/:sid`（场次 ID 为 12 位十六进制）：

| 方法与路径 | 作用 |
| --- | --- |
| `POST /api/sessions` | 创建场次 |
| `GET  /api/sessions` | 场次列表 |
| `GET  /api/sessions/:sid` | 场次详情（含当前状态） |
| `GET/PUT /api/sessions/:sid/draft` | 读取 / 替换草稿（`entries` 原文 + `translations` 译文，见下） |
| `POST /api/sessions/:sid/publish` | 发布草稿为新版本（原文+译文同一事务整体固化；空/重复/空译文/引用缺失均拒绝） |
| `GET  /api/sessions/:sid/versions[/:id]` | 已发布版本列表（含每版语言清单 `langs`） / 详情（含全部译文） |
| `GET  /api/sessions/:sid/versions/:id/content?lang=xx` | **观众取词**：某版本在指定语言下的原文 + 该语言译文（缺条不返回，客户端回退原文） |
| `GET  /api/sessions/:sid/state` | 当前已确认状态（`current.text` 始终为原文，语言展示在观众设备本地组合） |
| `POST /api/sessions/:sid/control/grant` | 取得或接管控制权 |
| `POST /api/sessions/:sid/control/renew` | 续期（须本人 token） |
| `POST /api/sessions/:sid/control/release` | 主动释放（须本人 token） |
| `POST /api/sessions/:sid/ops` | 舞台操作 `advance/back/clear/load/end`，须带 `token` 与 `stateVersion` |

> 单语用法完全不变：草稿/发布请求中的 `translations` 可省略（与旧版完全兼容）；原有编辑、发布、舞台操作与 `/state` 接口行为不变。

### 多语言数据格式与调用示例

草稿保存（`PUT /api/sessions/:sid/draft`）与发布（`POST /api/sessions/:sid/publish`）请求体：

```json
{
  "entries": [
    { "seq": 1, "text": "你好" },
    { "seq": 2, "text": "世界" }
  ],
  "translations": [
    { "lang": "en", "entries": [ { "seq": 1, "text": "Hello" } ] },
    { "lang": "ja", "entries": [ { "seq": 1, "text": "こんにちは" }, { "seq": 2, "text": "世界" } ] }
  ]
}
```

- `translations` 为「按语言分组」：每组一个 `lang` + 该语言下的 `entries`。上例英语故意缺第 2 条——**缺条合法**，观众看到第 2 条时回退原文「世界」。
- 也接受扁平按行形态：`"translations": [ { "lang": "en", "seq": 1, "text": "Hello" }, … ]`（同语言多行自然合并；同语言同序号重复仍拒绝）。
- 语言代码：2~3 位小写字母主码，可再带至多两级连字符子码（`en` / `zh-hans` / `pt-br` / `ckb`）；服务端大小写不敏感并统一规范化为小写。

curl 示例：

```bash
SID=0123abcd4567

# 保存含英语、日语译文的草稿（英语缺第 2 条）
curl -X PUT "http://localhost:8080/api/sessions/$SID/draft" \
  -H 'Content-Type: application/json' -d '{
    "entries":[{"seq":1,"text":"你好"},{"seq":2,"text":"世界"}],
    "translations":[
      {"lang":"en","entries":[{"seq":1,"text":"Hello"}]},
      {"lang":"ja","entries":[{"seq":1,"text":"こんにちは"},{"seq":2,"text":"世界"}]}
    ]}'

# 发布：原文与译文整体固化为同一版本，返回 {id, versionNo, count, langs:["en","ja"]}
curl -X POST "http://localhost:8080/api/sessions/$SID/publish" \
  -H 'Content-Type: application/json' -d '{
    "entries":[{"seq":1,"text":"你好"},{"seq":2,"text":"世界"}],
    "translations":[{"lang":"en","entries":[{"seq":1,"text":"Hello"}]}]}'

# 观众设备选择英语取词（只读，不影响进度/状态版本/控制权）
curl "http://localhost:8080/api/sessions/$SID/versions/1/content?lang=en"
# => languages:["en","ja"], lang:"en",
#    entries:[{seq:1,text:"你好"},{seq:2,text:"世界"}],
#    translations:[{seq:1,text":"Hello"}]      # 只有已译条目；seq 2 缺，客户端显示原文

# 不带 lang（或该版本没有的语言）：lang=null、translations=[]，观众显示原文
curl "http://localhost:8080/api/sessions/$SID/versions/1/content"
```

译文校验失败示例（**整体拒绝**，无部分写入）：

```json
// 重复语言代码（规范化后 en 与 EN 相同）
{ "error": { "code": "DUPLICATE_LANG",
  "message": "语言代码 en 重复：同一语言只能提交一组译文，拒绝保存" } }

// 同一语言内字幕序号重复 → 409
{ "error": { "code": "DUPLICATE_TSEQ",
  "message": "语言 en 的字幕序号 1 重复，拒绝保存" } }

// 空译文 → 400
{ "error": { "code": "EMPTY_TRANSLATION",
  "message": "语言 en 序号 3 的译文为空，拒绝保存；该条不翻译请直接缺省（允许缺条），不要提交空译文" } }

// 引用不存在的原文序号 → 400
{ "error": { "code": "TSEQ_NOT_FOUND",
  "message": "语言 en 的译文引用了不存在的原文序号 9，拒绝保存；译文只能对应本次草稿中的原文序号" } }
```

其余可能的译文错误码：`INVALID_LANG`（语言代码格式不合法）、`INVALID_TSEQ`（译文序号非正整数）、`INVALID_TRANSLATIONS` / `INVALID_TRANSLATION`（整体/单条不是对象）。原文侧沿用 `INVALID_SEQ / DUPLICATE_SEQ / EMPTY_TEXT`。

WebSocket：`ws://<host>:8080/ws?sid=<场次ID>`，服务端消息 `hello` / `state` / `control`；消息体只承载**全场权威状态**（进度、`stateVersion`、当前原文），**不含语言切换**——语言是观众设备本地行为。客户端断线指数退避自动重连。

错误响应统一形如：

```json
{ "error": { "code": "STALE_STATE", "message": "状态版本过期：你的页面基于 v3，服务器当前为 v4，请刷新页面状态后重试（本次操作被忽略）" } }
```

## 七、目录结构

```
.
├── Dockerfile            # Node 22 精简镜像，含依赖安装与初始化
├── docker-compose.yml    # 一键启动 + 数据卷 + 健康检查
├── package.json          # 唯一运行时依赖 ws；start 已带 --experimental-sqlite
├── server.js             # HTTP API + WebSocket + SQLite 全部服务逻辑
├── public/
│   ├── index.html        # 场次首页
│   ├── editor.html       # 编辑者页
│   ├── operator.html     # 操作员页
│   ├── audience.html     # 观众页
│   ├── common.js         # API 封装 / WS 自动重连 / 通用 UI
│   └── style.css
├── test-e2e.js           # 原有单语接口端到端测试（33 项）
├── test-i18n.js          # 多语言能力端到端测试（35 项：校验、固化、不可变、取词、缺条）
├── test-ws.js            # WebSocket 行为测试（hello 恢复、推进广播、切换语言与推进并发的最终一致）
└── README.md
```

自检（需先启动服务，Node ≥ 22）：

```bash
node test-e2e.js   # 原有单语能力回归
node test-i18n.js  # 多语言能力
node test-ws.js    # 实时与恢复行为
```

局域网内其他设备访问时，把 `localhost` 换为运行机器的内网 IP 即可（同一剧场 Wi-Fi/内网）。
