# 店价宝 ShopPrice — 技术说明

本文记录实现结构、数据模型、关键规则和维护注意事项。产品介绍见 [README.md](README.md)。

---

## 1. 设计目标

| 目标 | 做法 |
|---|---|
| 打开即用 | 纯静态页面，无后端、无登录、无构建步骤 |
| 数据可控 | 所有资料保存在浏览器 `localStorage`，可导出 CSV 与完整 JSON 备份 |
| 移动优先 | 390px 起设计，底部导航，表单控件适配触屏 |
| 改动可追溯 | 价格历史独立存储，记录修改前后两项价格 |
| 不静默覆盖 | CSV 导入与备份恢复都先预览、再确认；冲突有明确策略 |
| 可维护 | 按职责拆分 JS 模块，保持原生 ES6+，不使用框架 |

运行时没有 npm 依赖。`assets/vendor/html5-qrcode.min.js` 已随项目本地化，避免 CDN 和网络请求。

---

## 2. 文件与模块

```text
index.html                 页面骨架、SVG symbol、底部导航、脚本顺序
assets/styles.css          CSS 变量、布局、组件、响应式与深色模式
assets/js/core.js          APP/KEYS 常量、格式化、校验工具、存储、迁移、toast/modal
assets/js/views.js         各路由页面渲染、商品行、详情、价格历史、数据管理
assets/js/data-csv.js      CSV 分词、表头映射、预览、导入、导出
assets/js/data-backup.js   JSON 备份、解析校验、合并/覆盖恢复、清空
assets/js/scanner.js       html5-qrcode 初始化、摄像头错误提示、手动条码回退
assets/js/app.js           hash 路由、表单事件、自动保存、删除、全局事件、启动
```

脚本按依赖顺序以 `defer` 加载，全部挂载在全局作用域（无模块打包）。共享状态集中在 `core.js` 的 `state` 对象。

### 公共能力（core.js）

- `esc()`：HTML 转义，所有用户输入进入模板前必须经过它。
- `parsePriceValue()`：兼容 `¥`、`￥`、`元`、空格、千分位和逗号小数点；拒绝负数、多小数点、非数字。
- `normalizeBarcodeValue()`：条码查重时统一比较形式。
- `readStorage()` / `persistAll()`：带异常捕获的读写；保存失败会回滚内存状态并提示。
- `openModal()` / `toast()`：统一弹窗焦点管理和消息提示。
- `APP.version = '2.1.0'`，`schemaVersion = 1`。

### 路由（app.js）

使用 `location.hash`：

| 路由 | 页面 |
|---|---|
| `#/home` | 首页 |
| `#/products` | 商品列表，可带 `?q=关键词` |
| `#/product/:id` | 商品详情与价格历史 |
| `#/new` | 新增商品，可带 `?barcode=...` |
| `#/edit/:id` | 编辑商品 |
| `#/data` | 数据管理 |

渲染入口是 `renderRoute()`。未知路由显示空状态，不会抛错。

---

## 3. 数据模型

### 3.1 `localStorage` 键

| 键 | 类型 | 说明 |
|---|---|---|
| `shopprice_products_v1` | JSON 数组 | 商品 |
| `shopprice_price_history_v1` | JSON 数组 | 价格历史 |
| `shopprice_meta_v1` | JSON 对象 | 初始化、迁移、创建时间等 |

旧版键 `products`、`sales`、`debts`、`paidDebts` 不会被删除。

### 3.2 商品

```json
{
  "id": "crypto-uuid",
  "name": "可口可乐 500ml",
  "barcode": "6901234567890",
  "spec": "500ml",
  "category": "饮料",
  "buyPrice": 2.5,
  "sellPrice": 4,
  "note": "冰柜常备",
  "createdAt": "2026-10-23T00:00:00.000Z",
  "updatedAt": "2026-10-23T00:10:00.000Z"
}
```

约束：

- `id`：UUID；不支持 `crypto.randomUUID` 时使用时间戳随机串。
- `name`：必填，最长 80 字符。
- `barcode`：可选，最长 64 字符；非空时全局唯一（比较前统一格式）。
- `spec` 最长 80，`category` 最长 40，`note` 最长 1000。
- `buyPrice` / `sellPrice`：必填，`0 ≤ 价格 ≤ 99999999.99`，保留两位小数。
- `category` 为空时保存为“未分类”。
- 时间使用 ISO 8601 字符串。

### 3.3 价格历史

```json
{
  "id": "history-uuid",
  "productId": "crypto-uuid",
  "productName": "可口可乐 500ml",
  "beforeBuyPrice": 2.3,
  "beforeSellPrice": 3.8,
  "afterBuyPrice": 2.5,
  "afterSellPrice": 4,
  "changedAt": "2026-10-23T00:10:00.000Z",
  "source": "edit"
}
```

`source` 取值：`create`（初始）、`migration`（旧版迁移）、`edit`（编辑）、`import`（CSV 导入）、`restore`（备份恢复）。

初始记录的 `beforeBuyPrice` 和 `beforeSellPrice` 均为 `null`。历史只追加，不提供单条编辑或删除；删除商品时由用户选择是否一并清理。

### 3.4 元数据

```json
{
  "initialized": true,
  "createdAt": "2026-10-23T00:00:00.000Z",
  "migration": {
    "from": "Mini POS Market",
    "at": "2026-10-23T00:00:00.000Z",
    "count": 12
  }
}
```

---

## 4. 关键业务规则

### 4.1 新增

1. 读取并校验表单。
2. 生成商品 ID 与时间戳。
3. 商品入数组，同时追加一条 `source = create` 的历史（before 为 `null`）。
4. 一次写入商品与历史；任一写入失败则回滚两处内存变更。

### 4.2 编辑自动保存

- 编辑页监听 `input`，600ms 防抖后调用 `saveEditForm({ auto: true, silent: true })`。
- 提交按钮、`beforeunload`、页面隐藏时立即 flush。
- 校验失败时暂停自动保存，保留用户输入并显示字段错误。
- 对比所有字段；无变化不更新时间、不写历史。
- 任一价格变化才生成历史，`before` 取保存前的两项价格，`after` 取新值。
- 持久化失败会恢复原商品并移除刚加入的历史。

### 4.3 删除

`openDeleteModal()` 显示历史条数，要求：

1. 用户可选择“同时删除价格历史”（默认关闭）。
2. 必须勾选确认框，确认按钮才可用。

删除商品后：

- 未勾选清理：历史保留，形成“孤立历史”，详情页不可见，但计入总数、可导出。
- 勾选清理：删除该 `productId` 的全部历史。

### 4.4 搜索、筛选、排序

在内存中对 `state.products` 过滤：

- 搜索：名称或条码 `toLowerCase().includes()`。
- 分类：精确匹配。
- 排序：`updated`（默认）、`name`（`localeCompare('zh-Hans-CN')`）、`sell-asc`、`sell-desc`（同价按名称）。

### 4.5 旧版迁移

触发条件（全部满足）：

1. `shopprice_products_v1` 不存在；
2. `shopprice_meta_v1.initialized` 不为真；
3. 旧版 `products` 存在、可读、为非空数组。

迁移规则：

- `code`/`barcode` → `barcode`；重复条码清空并在备注说明。
- 缺失名称 → `未命名商品 N`。
- 无法识别的价格 → 0，并在备注记录原值。
- 旧 `stock`、`description` 写入备注。
- 原 `createdAt/updatedAt` 可用则保留，否则按顺序生成。
- 每个商品生成 `source = migration` 的初始历史。
- 写入新键并记录 `meta.migration`，不删除旧键。
- 只迁移一次；之后即使旧键仍在也不会重复导入。

### 4.6 存储异常

- 读取失败或结构异常时设置 `state.loadError`，页面显示警告，**暂停写入**，避免覆盖原始数据。
- 用户仍可通过“覆盖恢复”从备份重建。
- 写入失败（如配额满、无痕模式）时回滚内存状态，并提示先导出备份。
- 所有 JSON 解析都包在 `try/catch` 中。

---

## 5. CSV 设计

### 5.1 解析

- 去除 BOM；检测首个非空行的分隔符（`,`、`;`、`\t`）。
- 手写状态机支持引号、转义引号、CRLF/LF、字段内换行。
- 表头归一化：去重音、大小写、空格、标点，再查别名表。
- 必识别列：名称、进货价、售价；其他列可选。
- 旧版 `Cod/Nume/Preț Cumpărare/Preț Vânzare` 自动映射；库存/销量列标记为忽略。
- 遇到以 `Istoric`、`SalesHistory` 或“价格历史”开头的行时停止读取，避免把销售历史当商品。
- 上限：5000 行、5 MB（读取前检查文件大小）。
- 空行跳过；数据行号保留用于错误定位。

### 5.2 预览与冲突

每行计算状态：

| 状态 | 含义 |
|---|---|
| 新增 | 条码不存在（或为空） |
| 更新 | 按条码匹配到现有商品，且用户选择更新模式 |
| 无变化 | 匹配到商品但字段完全一致 |
| 条码重复 | 文件内或与现有商品重复，跳过 |
| 错误 | 缺名称、非法价格等 |

默认模式 `skip`：已有条码跳过。选择 `update` 才允许更新，并在价格变化时写历史。

### 5.3 导出

- 商品 CSV：UTF-8 BOM + CRLF，按名称排序，字段带引号转义。
- 历史 CSV：按时间升序，包含商品 ID、名称、前后价格、时间、来源。
- 文件名带日期：`shopprice-products-YYYYMMDD.csv`、`shopprice-price-history-YYYYMMDD.csv`。
- 通过 `Blob` + 临时 `<a download>` 下载，无网络请求。

---

## 6. 备份与恢复

### 6.1 备份格式

```json
{
  "app": "店价宝 ShopPrice",
  "format": "shopprice-backup",
  "schemaVersion": 1,
  "exportedAt": "2026-10-23T00:00:00.000Z",
  "counts": { "products": 10, "priceHistory": 24 },
  "products": [],
  "priceHistory": [],
  "meta": {}
}
```

### 6.2 解析与清洗

- 必须是对象；`format` 若存在必须为 `shopprice-backup`。
- `schemaVersion` 高于当前版本时拒绝，提示升级。
- 兼容 `data.products`、`price_history` 等旧字段位置。
- 逐条校验名称、价格、ID、时间；无效项跳过并记录原因，最多展示前 20 条。
- 备份内重复 ID 跳过后一条；重复条码清空后一条并在 `invalid` 中说明。
- 历史要求 `productId` 和两项 after 价格；来源非法时按有无 before 推断。

### 6.3 恢复模式

- **合并（默认）**：现有 ID 或条码冲突的商品跳过；历史按 ID 去重后加入。
- **覆盖**：整体替换商品和历史；若当前读取异常则强制使用此模式。
- 两种模式都需在确认弹窗中勾选确认。
- 覆盖模式可先调用 `exportBackup({ silent: true })` 下载当前数据。
- 恢复失败时回滚商品和历史两处内存状态。

### 6.4 清空

`clearAllData()` 先弹确认，提供“先下载备份”选项，二次确认后删除新键并重置内存状态；不会动旧版键。

---

## 7. 扫码实现

- 使用本地 `html5-qrcode@2.3.8`，`facingMode: 'environment'`，10fps，横向取景框。
- 开启 `useBarCodeDetectorIfSupported`，支持的浏览器使用原生 `BarcodeDetector`，否则走库内解码。
- 启动前检查：`window.isSecureContext`、`navigator.mediaDevices.getUserMedia`、`window.Html5Qrcode`。
- 常见错误（权限拒绝、无摄像头、被占用、不支持）转为中文提示。
- 关闭弹窗时停止轨道并清理 DOM，避免摄像头常亮。
- 手动输入始终可用，是扫码失败时的正式回退路径。
- 条码处理：
  - 全局：匹配商品 → 详情；未匹配 → `#/new?barcode=...`。
  - 编辑表单：填入条码并提示是否与其他商品冲突。
  - 新增表单：若条码已存在，提示并跳转已有商品详情。
- 扫码不发起任何网络请求，也不推断商品名称或价格。

---

## 8. 界面与可访问性

- CSS 变量定义颜色、圆角、阴影；`prefers-color-scheme` 切换深色变量。
- 移动优先；桌面端限制内容宽度，底部导航固定，页面预留安全区内边距。
- 商品列表、详情、编辑和添加页使用全高工作区：顶部操作栏和底部操作栏固定，仅中间内容滚动；商品列表只让结果区域滚动。
- 编辑/添加页聚焦输入框时自动隐藏底部导航，失焦后恢复，避免移动端键盘把导航顶起。
- 所有按钮使用 `<button type="button">` 或表单提交按钮，避免误触发表单。
- 弹窗打开时聚焦首个控件，关闭时归还焦点；`Esc` 关闭。
- 图标为内联 SVG symbol，带 `aria-hidden`；图标按钮提供 `aria-label`。
- 表单错误通过 `aria-invalid` 和错误文本提示；价格使用 `inputmode="decimal"`。
- Toast 区域使用 `aria-live="polite"`。
- 用户内容统一 `esc()`，模板不拼接未转义值。

---

## 9. 测试与调试

浏览器控制台可使用只读调试接口：

```js
ShopPrice.version
ShopPrice.storageKeys
ShopPrice.getProducts()
ShopPrice.getHistory()
ShopPrice.getMeta()
ShopPrice.findProduct(id)
ShopPrice.findByBarcode('6901234567890')
```

端到端测试说明见 [docs/TESTING.md](docs/TESTING.md)。

---

## 10. 维护注意事项

1. 修改数据结构时同步提升 `APP.schemaVersion`，并在备份解析中处理旧版本。
2. 不要把用户输入直接插入 `innerHTML`，先 `esc()`；数值先走 `parsePriceValue()`。
3. 任何写操作都要考虑 `persistAll()` 失败后的回滚。
4. 新增价格写入路径时复用 `buildPriceHistory()`，保持来源和时间字段一致。
5. 修改自动保存逻辑后，检查 `beforeunload`、`visibilitychange` 和提交三条 flush 路径。
6. 修改存储键会影响升级迁移，务必保留旧键读取逻辑。
7. 调整脚本拆分时同步修改 `index.html` 的加载顺序；模块之间依赖全局函数。
8. 保持扫码库本地化，避免引入 CDN 或运行时网络依赖。
