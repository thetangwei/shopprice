# 测试说明

## 1. 测试范围

自动化测试覆盖店价宝的核心用户流程，不测试真实摄像头硬件识别。

| 分组 | 数量 | 内容 |
|---|---:|---|
| 首页、新增与持久化 | 5 | 品牌标题、空状态、新增商品、新存储键、刷新后数据仍在 |
| 首页快捷跳转 | 2 | 商品总数跳转列表并高亮、价格记录跳转最近历史并高亮 |
| 表单校验 | 2 | 重复条码、负数价格被拦截 |
| 自动保存与历史 | 6 | 防抖自动保存、价格变化写历史、只改备注不写历史、刷新保留、详情倒序、输入时底部导航保持显示 |
| 查询 | 4 | 按条码搜索、按名称搜索、分类筛选、售价排序 |
| 扫码回退 | 3 | 手动输入入口、已有条码打开详情、未知条码进入新增并填入 |
| CSV | 9 | 商品导出、预览与错误检查、有效项导入、更新模式、价格历史、旧版表头、旧销售历史忽略、文件内重复条码、历史导出 |
| 备份恢复 | 10 | 备份内容、冲突摘要、确认门槛、合并去重、合并新增、损坏文件、删除取消、默认保留历史、同时删除历史、覆盖恢复 |
| 移动布局 | 4 | 首页/商品/新增/数据管理在 390px 下无横向溢出 |
| 清空数据 | 2 | 取消不删除、确认后清空 |
| 旧版迁移 | 3 | 自动迁移、迁移历史、无脚本错误 |
| 全局 | 1 | 全流程无 pageerror / console error |

合计 **51 项检查**。

---

## 2. 测试环境

- 日期：2026-10-23
- 浏览器：Google Chrome（Playwright `channel: 'chrome'`，无头模式）
- 视口：390 × 844（移动端）
- 系统：Windows
- 服务：`python -m http.server 8123 --bind 127.0.0.1 --directory shopprice`
- 地址：<http://127.0.0.1:8123/>
- Playwright：`^1.55.0`

---

## 3. 运行测试

### 3.1 安装测试依赖

仅测试需要 Node.js 和 Playwright，应用本身没有运行时依赖。

```bash
npm install
```

如果本机没有 Google Chrome，可安装 Playwright 自带 Chromium，并把 `tests/e2e.js` 中的 `channel: 'chrome'` 改为不带 `channel` 的启动方式，或先安装 Chrome。

### 3.2 启动本地服务器

另开一个终端，在项目根目录执行：

```bash
python -m http.server 8123
```

### 3.3 执行

```bash
npm run test:e2e
```

或：

```bash
node tests/e2e.js
```

默认地址是 `http://127.0.0.1:8123/`。端口不同可覆盖：

```bash
# Windows PowerShell
$env:SHOPRICE_URL='http://127.0.0.1:8080/'; node tests/e2e.js

# macOS / Linux
SHOPRICE_URL=http://127.0.0.1:8080/ node tests/e2e.js
```

测试会清空当前测试浏览器上下文的 `localStorage`，请勿指向包含真实数据的日常浏览器配置。脚本使用独立的 Playwright context，不会影响你正在使用的浏览器数据。

### 3.4 产物

运行后在 `tests/.artifacts/` 生成：

- `export-products.csv`、`export-history.csv`
- `import.csv`、`update.csv`、`legacy.csv`、`duplicate.csv`
- `backup.json`、`merge-backup.json`、`bad-backup.json`
- `mobile-home.png`、`mobile-products.png`、`mobile-data.png`、`migration-products.png`
- 失败时额外生成 `failure.png`

该目录已被 `.gitignore` 忽略。

---

## 4. 本次结果

```text
PASS 首页品牌标题和空状态
PASS 新增商品后进入详情
PASS 商品保存到新的 localStorage 键
PASS 创建时记录初始价格
PASS 刷新页面后商品仍在
PASS 重复条码被拦截
PASS 负数价格被拦截
PASS 编辑价格自动保存
PASS 价格变化生成历史记录
PASS 修改备注不生成价格历史
PASS 输入时底部导航保持显示
PASS 自动保存结果刷新后仍在
PASS 详情页倒序显示价格历史
PASS 首页商品总数跳转商品列表并高亮
PASS 首页价格记录跳转最近价格历史并高亮
PASS 按条码搜索商品
PASS 按名称搜索商品
PASS 按分类筛选
PASS 按售价排序
PASS 扫码弹窗提供手动输入
PASS 手动输入已有条码打开详情
PASS 手动输入未知条码进入新增页并填入
PASS 导出商品 CSV
PASS CSV 导入前显示预览和错误检查
PASS CSV 仅导入有效新商品且不覆盖已有商品
PASS CSV 更新模式预览
PASS CSV 更新已有商品并记录价格历史
PASS 兼容旧版 CSV 表头并忽略销售历史
PASS 旧版 CSV 商品成功导入
PASS 文件内重复条码被标记错误
PASS 导出价格历史 CSV
PASS 完整备份包含商品和价格历史
PASS 恢复前显示冲突摘要
PASS 恢复确认按钮在勾选前不可用
PASS 合并恢复跳过冲突且不重复商品
PASS 合并恢复加入新商品和价格历史
PASS 损坏的备份文件给出明确提示
PASS 删除确认弹窗可取消
PASS 删除商品后默认保留价格历史
PASS 可选择同时删除价格历史
PASS 覆盖恢复恢复备份内容
PASS 手机端无横向溢出 /home
PASS 手机端无横向溢出 /products
PASS 手机端无横向溢出 /new
PASS 手机端无横向溢出 /data
PASS 清空弹窗取消不删除数据
PASS 清空本机数据
PASS 自动迁移原 Mini POS Market 商品数据
PASS 迁移时也记录初始价格历史
PASS 旧版迁移无脚本错误
PASS 整个流程无页面脚本错误

ALL TESTS PASSED (51 checks)
```

**结果：51 / 51 通过，无页面脚本错误或控制台错误。**

---

## 5. 未覆盖项

以下需要人工/真实设备验证：

1. 真实手机或平板摄像头的条码识别率、对焦速度、弱光表现。
2. iOS Safari 的摄像头权限、添加到主屏幕后的行为。
3. 不同浏览器原生 `BarcodeDetector` 支持差异。
4. 真实手机软键盘弹出时底部导航的固定位置，以及各浏览器对 `interactive-widget=resizes-visual` 的支持差异。
5. 极大商品量（数千件）下的滚动与 `localStorage` 容量表现。
6. 多语言输入法、超长中文名称的视觉换行。
7. 屏幕阅读器完整朗读流程。
8. 备份文件在浏览器存储配额接近上限时的失败恢复。
8. 从 HTTPS 域名切换到另一域名后的数据迁移（已文档说明，需人工按步骤验证）。

## 6. 手工验收建议

发布前在目标设备上额外检查：

- [ ] 用 HTTPS 打开，允许摄像头，扫描至少 3 个真实条码。
- [ ] 扫描未知条码，确认进入新增页且条码已填入。
- [ ] 新增商品后刷新、关闭浏览器再打开，数据仍在。
- [ ] 编辑价格后等待自动保存提示，确认历史新增一条。
- [ ] 只改备注，确认历史不增加。
- [ ] 导出 CSV 用 Excel 打开，中文与价格正确。
- [ ] 下载备份，清空数据，再用备份恢复。
- [ ] 用手机查看首页、列表、详情、数据管理，确认无横向滚动、按钮可点。
