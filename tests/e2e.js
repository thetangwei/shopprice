const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE = process.env.SHOPRICE_URL || 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '.artifacts');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
    locale: 'zh-CN'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(`PAGEERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`CONSOLE: ${message.text()}`);
  });

  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); throw error; }
  };
  const state = () => page.evaluate(() => ({
    products: JSON.parse(localStorage.getItem('shopprice_products_v1') || '[]'),
    history: JSON.parse(localStorage.getItem('shopprice_price_history_v1') || '[]'),
    meta: JSON.parse(localStorage.getItem('shopprice_meta_v1') || '{}')
  }));
  const go = async (hash) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(180);
  };
  const addProduct = async ({ name, barcode = '', spec = '', category = '', buy = '1.00', sell = '2.00', note = '' }) => {
    await go('/new');
    await page.fill('#product-name', name);
    await page.fill('#product-barcode', barcode);
    await page.fill('#product-spec', spec);
    await page.fill('#product-category', category);
    await page.fill('#product-buy-price', buy);
    await page.fill('#product-sell-price', sell);
    await page.fill('#product-note', note);
    await page.click('#save-product');
    await page.waitForTimeout(250);
  };

  try {
    await page.goto(`${BASE}#/home`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await check('首页品牌标题和空状态', async () => {
      assert.strictEqual(await page.title(), '首页 · 店价宝 ShopPrice');
      assert.match(await page.locator('.hero h1').innerText(), /商品扫码查/);
      assert.match(await page.locator('#app').innerText(), /还没有商品/);
    });

    // 1. Create product + initial history + persistence
    await addProduct({ name: '测试可乐', barcode: '6901234567890', spec: '500ml', category: '饮料', buy: '2.50', sell: '4.00', note: '测试备注' });
    await check('新增商品后进入详情', async () => {
      assert.match(page.url(), /#\/product\//);
      assert.strictEqual((await page.locator('.page-head h1').innerText()).trim(), '测试可乐');
      assert.match(await page.locator('.price-main').innerText(), /¥4\.00/);
    });
    let snapshot = await state();
    await check('商品保存到新的 localStorage 键', async () => {
      assert.strictEqual(snapshot.products.length, 1);
      assert.strictEqual(snapshot.products[0].barcode, '6901234567890');
      assert.strictEqual(snapshot.products[0].buyPrice, 2.5);
      assert.strictEqual(snapshot.products[0].sellPrice, 4);
    });
    await check('创建时记录初始价格', async () => {
      assert.strictEqual(snapshot.history.length, 1);
      assert.strictEqual(snapshot.history[0].beforeBuyPrice, null);
      assert.strictEqual(snapshot.history[0].afterBuyPrice, 2.5);
      assert.strictEqual(snapshot.history[0].beforeSellPrice, null);
      assert.strictEqual(snapshot.history[0].afterSellPrice, 4);
      assert.strictEqual(snapshot.history[0].source, 'create');
    });
    const productId = snapshot.products[0].id;

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await check('刷新页面后商品仍在', async () => {
      assert.match(await page.locator('.page-head h1').innerText(), /测试可乐/);
      assert.strictEqual((await state()).products.length, 1);
    });

    // 2. Duplicate barcode blocked
    await go('/new');
    await page.fill('#product-name', '重复条码商品');
    await page.fill('#product-barcode', '6901234567890');
    await page.fill('#product-buy-price', '1');
    await page.fill('#product-sell-price', '2');
    await page.click('#save-product');
    await page.waitForTimeout(150);
    await check('重复条码被拦截', async () => {
      assert.match(await page.locator('#err-barcode').innerText(), /已被“测试可乐”使用/);
      assert.match(page.url(), /#\/new/);
      assert.strictEqual((await state()).products.length, 1);
    });

    // 3. Negative price blocked
    await page.fill('#product-barcode', '6901234567999');
    await page.fill('#product-buy-price', '-1');
    await page.click('#save-product');
    await page.waitForTimeout(150);
    await check('负数价格被拦截', async () => {
      assert.match(await page.locator('#err-buyPrice').innerText(), /不小于 0/);
      assert.strictEqual((await state()).products.length, 1);
    });

    // 4. Autosave price change + history
    await go(`/edit/${productId}`);
    await page.fill('#product-sell-price', '4.50');
    await page.waitForTimeout(1100);
    await check('编辑价格自动保存', async () => {
      assert.match(await page.locator('#form-status').innerText(), /已自动保存/);
      snapshot = null;
    });
    snapshot = await state();
    await check('价格变化生成历史记录', async () => {
      assert.strictEqual(snapshot.products[0].sellPrice, 4.5);
      assert.strictEqual(snapshot.history.length, 2);
      const latest = snapshot.history[snapshot.history.length - 1];
      assert.strictEqual(latest.beforeBuyPrice, 2.5);
      assert.strictEqual(latest.afterBuyPrice, 2.5);
      assert.strictEqual(latest.beforeSellPrice, 4);
      assert.strictEqual(latest.afterSellPrice, 4.5);
      assert.strictEqual(latest.source, 'edit');
    });

    // 5. Note change does not create history
    await page.fill('#product-note', '只改备注，不动价格');
    await page.waitForTimeout(1100);
    snapshot = await state();
    await check('修改备注不生成价格历史', async () => {
      assert.strictEqual(snapshot.products[0].note, '只改备注，不动价格');
      assert.strictEqual(snapshot.history.length, 2);
    });
    await check('输入时底部导航保持显示', async () => {
      const nav = await page.evaluate(() => {
        const el = document.querySelector('.bottom-nav');
        const rect = el.getBoundingClientRect();
        return { opacity: getComputedStyle(el).opacity, top: rect.top };
      });
      assert.strictEqual(nav.opacity, '1');
      assert.ok(nav.top > 700);
    });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await check('自动保存结果刷新后仍在', async () => {
      assert.strictEqual(await page.inputValue('#product-sell-price'), '4.5');
      assert.strictEqual(await page.inputValue('#product-note'), '只改备注，不动价格');
    });

    // 6. Detail history display
    await go(`/product/${productId}`);
    await check('详情页倒序显示价格历史', async () => {
      const items = page.locator('#price-history .history-item');
      assert.strictEqual(await items.count(), 2);
      const latestText = await items.first().innerText();
      assert.match(latestText, /4\.00.*4\.50/s);
      assert.doesNotMatch(latestText, /未变/);
      assert.doesNotMatch(latestText, /进货价/);
      assert.match(await items.last().innerText(), /初始/);
    });

    await go('/home');
    await page.click('.stat-card[data-jump="list"]');
    await page.waitForTimeout(220);
    await check('首页商品总数跳转商品列表并高亮', async () => {
      assert.strictEqual(await page.evaluate(() => location.hash), '#/products');
      assert.strictEqual(await page.locator('#product-list-scroll.flash-target').count(), 1);
    });
    await page.waitForTimeout(1500);

    await go('/home');
    await page.click('.stat-card[data-jump="history"]');
    await page.waitForTimeout(320);
    await check('首页价格记录跳转最近价格历史并高亮', async () => {
      assert.match(await page.evaluate(() => location.hash), /^#\/product\//);
      assert.strictEqual(await page.locator('#price-history.flash-target').count(), 1);
    });
    await page.waitForTimeout(1500);

    // 7. Search by name / barcode, category filter, sort
    await addProduct({ name: '测试面包', barcode: '6900000000002', category: '食品', buy: '3.00', sell: '5.00' });
    await go('/products');
    await page.fill('#product-search', '6901234567890');
    await page.waitForTimeout(250);
    await check('按条码搜索商品', async () => {
      assert.strictEqual(await page.locator('#product-results .product-row').count(), 1);
      assert.match(await page.locator('#product-results').innerText(), /测试可乐/);
    });
    await page.fill('#product-search', '面包');
    await page.waitForTimeout(250);
    await check('按名称搜索商品', async () => {
      assert.strictEqual(await page.locator('#product-results .product-row').count(), 1);
      assert.match(await page.locator('#product-results').innerText(), /测试面包/);
    });
    await page.fill('#product-search', '');
    await page.selectOption('#filter-category', '饮料');
    await page.waitForTimeout(200);
    await check('按分类筛选', async () => {
      assert.strictEqual(await page.locator('#product-results .product-row').count(), 1);
      assert.match(await page.locator('#product-results').innerText(), /测试可乐/);
    });
    await page.selectOption('#filter-category', '');
    await page.selectOption('#filter-sort', 'sell-desc');
    await page.waitForTimeout(200);
    await check('按售价排序', async () => {
      const prices = await page.locator('#product-results .product-sell').allInnerTexts();
      assert.deepStrictEqual(prices.slice(0, 2), ['¥5.00', '¥4.50']);
    });

    // 8. Scanner manual fallback
    await page.click('.header-scan');
    await page.waitForSelector('#scan-manual-input');
    await check('扫码弹窗提供手动输入', async () => {
      assert.ok(await page.locator('#scan-manual-input').isVisible());
      assert.match(await page.locator('.scan-hint').innerText(), /https|localhost/);
    });
    await page.fill('#scan-manual-input', '6901234567890');
    await page.click('#scan-manual-btn');
    await page.waitForTimeout(300);
    await check('手动输入已有条码打开详情', async () => {
      assert.match(page.url(), new RegExp(`#/product/${productId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(await page.locator('.page-head h1').innerText(), /测试可乐/);
    });
    await page.click('.header-scan');
    await page.fill('#scan-manual-input', '9999999999999');
    await page.click('#scan-manual-btn');
    await page.waitForTimeout(300);
    await check('手动输入未知条码进入新增页并填入', async () => {
      assert.match(page.url(), /#\/new\?barcode=9999999999999/);
      assert.strictEqual(await page.inputValue('#product-barcode'), '9999999999999');
    });

    // 9. CSV export
    await go('/data');
    const productDownloadPromise = page.waitForEvent('download');
    await page.click('#export-products');
    const productDownload = await productDownloadPromise;
    const productCsvPath = path.join(OUT, 'export-products.csv');
    await productDownload.saveAs(productCsvPath);
    const productCsv = fs.readFileSync(productCsvPath, 'utf8');
    await check('导出商品 CSV', async () => {
      assert.match(productCsv, /商品名称,商品条码,商品规格,商品分类,进货价,售价/);
      assert.match(productCsv, /测试可乐,6901234567890,500ml,饮料,2\.50,4\.50/);
      assert.match(productCsv, /测试面包/);
    });

    // 10. CSV import preview + validation + apply
    const csvImportPath = path.join(OUT, 'import.csv');
    fs.writeFileSync(csvImportPath, [
      '商品名称,商品条码,商品规格,商品分类,进货价,售价,备注,创建时间,更新时间',
      'CSV商品,6900000000123,250ml,饮料,1.50,3.00,从CSV导入,,',
      '冲突商品,6901234567890,500ml,饮料,1.00,2.00,不应覆盖,,',
      '非法价格,6900000000124,,,abc,3.00,,,',
      ',6900000000125,,,1.00,2.00,,,'
    ].join('\r\n'), 'utf8');
    await page.setInputFiles('#csv-file', csvImportPath);
    await page.waitForTimeout(400);
    await check('CSV 导入前显示预览和错误检查', async () => {
      const preview = await page.locator('#csv-preview').innerText();
      assert.match(preview, /新增 1/);
      assert.match(preview, /错误 2/);
      assert.match(preview, /条码已属于“测试可乐”/);
      assert.match(preview, /进货价格式或数值不合法/);
      assert.match(preview, /缺少商品名称/);
    });
    await page.click('#apply-csv');
    await page.waitForTimeout(500);
    snapshot = await state();
    await check('CSV 仅导入有效新商品且不覆盖已有商品', async () => {
      assert.strictEqual(snapshot.products.length, 3);
      const imported = snapshot.products.find((p) => p.name === 'CSV商品');
      const existing = snapshot.products.find((p) => p.barcode === '6901234567890');
      assert.ok(imported);
      assert.strictEqual(imported.buyPrice, 1.5);
      assert.strictEqual(existing.name, '测试可乐');
      assert.strictEqual(existing.sellPrice, 4.5);
    });

    // 11. CSV update mode + price history
    const csvUpdatePath = path.join(OUT, 'update.csv');
    fs.writeFileSync(csvUpdatePath, [
      '商品名称,商品条码,商品规格,商品分类,进货价,售价,备注',
      '测试可乐,6901234567890,500ml,饮料,2.50,5.00,CSV更新价格'
    ].join('\r\n'), 'utf8');
    await page.setInputFiles('#csv-file', csvUpdatePath);
    await page.waitForTimeout(400);
    await page.check('input[name="csv-mode"][value="update"]');
    await page.waitForTimeout(250);
    await check('CSV 更新模式预览', async () => {
      assert.match(await page.locator('#csv-preview').innerText(), /更新 1/);
    });
    const beforeUpdateHistory = (await state()).history.length;
    await page.click('#apply-csv');
    await page.waitForTimeout(500);
    snapshot = await state();
    await check('CSV 更新已有商品并记录价格历史', async () => {
      const updated = snapshot.products.find((p) => p.barcode === '6901234567890');
      assert.strictEqual(updated.sellPrice, 5);
      assert.strictEqual(snapshot.history.length, beforeUpdateHistory + 1);
      const latest = snapshot.history[snapshot.history.length - 1];
      assert.strictEqual(latest.beforeSellPrice, 4.5);
      assert.strictEqual(latest.afterSellPrice, 5);
      assert.strictEqual(latest.source, 'import');
    });

    // 12. Legacy CSV + duplicate in file
    const legacyCsvPath = path.join(OUT, 'legacy.csv');
    fs.writeFileSync(legacyCsvPath, [
      'Cod,Nume,Preț Cumpărare,Preț Vânzare,Cantitate Inițială,Stoc Actual,Cantitate Vândută,Total Cost,Total Cantitate',
      'L001,旧版商品,1.25,2.50,10,8,2,12.5,10',
      '',
      'Istoric Vânzări',
      'Data,Ora,Produse,Total Vanzare,Profit'
    ].join('\r\n'), 'utf8');
    await page.setInputFiles('#csv-file', legacyCsvPath);
    await page.waitForTimeout(400);
    const legacyPreview = await page.locator('#csv-preview').innerText();
    await check('兼容旧版 CSV 表头并忽略销售历史', async () => {
      assert.match(legacyPreview, /旧版 Mini POS Market 表头/);
      assert.match(legacyPreview, /旧版库存字段已忽略/);
      assert.match(legacyPreview, /旧版销售历史已忽略/);
      assert.match(legacyPreview, /新增 1/);
    });
    await page.click('#apply-csv');
    await page.waitForTimeout(500);
    snapshot = await state();
    await check('旧版 CSV 商品成功导入', async () => {
      const legacy = snapshot.products.find((p) => p.barcode === 'L001');
      assert.ok(legacy);
      assert.strictEqual(legacy.name, '旧版商品');
      assert.strictEqual(legacy.sellPrice, 2.5);
    });

    const dupCsvPath = path.join(OUT, 'duplicate.csv');
    fs.writeFileSync(dupCsvPath, [
      '商品名称,商品条码,进货价,售价',
      '同条码一,6900000000777,1,2',
      '同条码二,6900000000777,1,2'
    ].join('\r\n'), 'utf8');
    await page.setInputFiles('#csv-file', dupCsvPath);
    await page.waitForTimeout(400);
    await check('文件内重复条码被标记错误', async () => {
      assert.match(await page.locator('#csv-preview').innerText(), /条码与第 2 行重复/);
    });
    await page.click('[data-action="clear-csv"]');

    // 13. History export
    const historyDownloadPromise = page.waitForEvent('download');
    await page.click('#export-history');
    const historyDownload = await historyDownloadPromise;
    const historyCsvPath = path.join(OUT, 'export-history.csv');
    await historyDownload.saveAs(historyCsvPath);
    const historyCsv = fs.readFileSync(historyCsvPath, 'utf8');
    await check('导出价格历史 CSV', async () => {
      assert.match(historyCsv, /修改前进货价,修改后进货价,修改前售价,修改后售价,修改时间,来源/);
      assert.match(historyCsv, /4\.50,5\.00/);
    });

    // 14. Full backup + merge conflict
    const backupDownloadPromise = page.waitForEvent('download');
    await page.click('#backup-btn');
    const backupDownload = await backupDownloadPromise;
    const backupPath = path.join(OUT, 'backup.json');
    await backupDownload.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    await check('完整备份包含商品和价格历史', async () => {
      assert.strictEqual(backup.format, 'shopprice-backup');
      assert.ok(backup.products.length >= 4);
      assert.ok(backup.priceHistory.length >= 4);
      assert.strictEqual(backup.schemaVersion, 1);
    });

    await page.setInputFiles('#restore-file', backupPath);
    await page.waitForTimeout(400);
    await check('恢复前显示冲突摘要', async () => {
      const text = await page.locator('#restore-preview').innerText();
      assert.match(text, /合并恢复/);
      assert.match(text, /冲突/);
    });
    const productsBeforeMerge = (await state()).products.length;
    await page.click('#restore-backup');
    await page.waitForSelector('#restore-confirm-check');
    await check('恢复确认按钮在勾选前不可用', async () => {
      assert.ok(await page.locator('[data-modal-btn="confirm-restore"]').isDisabled());
      await page.check('#restore-confirm-check');
      assert.ok(!(await page.locator('[data-modal-btn="confirm-restore"]').isDisabled()));
    });
    await page.click('[data-modal-btn="confirm-restore"]');
    await page.waitForTimeout(500);
    await check('合并恢复跳过冲突且不重复商品', async () => {
      assert.strictEqual((await state()).products.length, productsBeforeMerge);
    });

    // 15. Merge a backup with a genuinely new product
    const mergeBackup = JSON.parse(JSON.stringify(backup));
    mergeBackup.products.push({
      id: 'backup-new-product', name: '备份新增商品', barcode: '6900000000888',
      spec: '1件', category: '备份', buyPrice: 7, sellPrice: 9,
      note: '来自备份', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    mergeBackup.priceHistory.push({
      id: 'backup-new-history', productId: 'backup-new-product', productName: '备份新增商品',
      beforeBuyPrice: null, afterBuyPrice: 7, beforeSellPrice: null, afterSellPrice: 9,
      changedAt: new Date().toISOString(), source: 'create'
    });
    const mergePath = path.join(OUT, 'merge-backup.json');
    fs.writeFileSync(mergePath, JSON.stringify(mergeBackup, null, 2), 'utf8');
    await go('/data');
    await page.setInputFiles('#restore-file', mergePath);
    await page.waitForTimeout(400);
    const productsBeforeNewMerge = (await state()).products.length;
    await page.click('#restore-backup');
    await page.check('#restore-confirm-check');
    await page.click('[data-modal-btn="confirm-restore"]');
    await page.waitForTimeout(500);
    snapshot = await state();
    await check('合并恢复加入新商品和价格历史', async () => {
      assert.strictEqual(snapshot.products.length, productsBeforeNewMerge + 1);
      assert.ok(snapshot.products.find((p) => p.name === '备份新增商品'));
      assert.ok(snapshot.history.find((h) => h.productId === 'backup-new-product'));
    });

    // 16. Invalid backup
    const badPath = path.join(OUT, 'bad-backup.json');
    fs.writeFileSync(badPath, '{ this is not json', 'utf8');
    await go('/data');
    await page.setInputFiles('#restore-file', badPath);
    await page.waitForTimeout(300);
    await check('损坏的备份文件给出明确提示', async () => {
      assert.match(await page.locator('#restore-preview').innerText(), /不是有效的 JSON/);
    });
    await page.click('[data-action="clear-restore"]');

    // 17. Delete product: cancel, then keep history
    await go(`/product/${productId}`);
    await page.click('#delete-product');
    await page.waitForSelector('#delete-confirm-check');
    await page.click('[data-modal-btn="action-0"]');
    await page.waitForTimeout(200);
    await check('删除确认弹窗可取消', async () => {
      assert.ok(!(await page.locator('#modal-root').evaluate((el) => el.classList.contains('open'))));
      assert.match(page.url(), /#\/product\//);
    });
    const historyCountBeforeDelete = (await state()).history.length;
    await page.click('#delete-product');
    await page.waitForSelector('#delete-confirm-check');
    assert.ok(await page.locator('[data-modal-btn="confirm-delete"]').isDisabled());
    await page.check('#delete-confirm-check');
    await page.click('[data-modal-btn="confirm-delete"]');
    await page.waitForTimeout(500);
    snapshot = await state();
    await check('删除商品后默认保留价格历史', async () => {
      assert.ok(!snapshot.products.find((p) => p.id === productId));
      assert.strictEqual(snapshot.history.length, historyCountBeforeDelete);
      assert.ok(snapshot.history.some((h) => h.productId === productId));
      assert.match(page.url(), /#\/products/);
    });

    // 18. Delete with history
    const deleteTarget = (await state()).products.find((p) => p.name === 'CSV商品');
    await go(`/product/${deleteTarget.id}`);
    const beforeHistory = (await state()).history.length;
    await page.click('#delete-product');
    await page.check('#delete-confirm-check');
    await page.check('#delete-history-check');
    await page.click('[data-modal-btn="confirm-delete"]');
    await page.waitForTimeout(500);
    snapshot = await state();
    await check('可选择同时删除价格历史', async () => {
      assert.ok(!snapshot.products.find((p) => p.id === deleteTarget.id));
      assert.strictEqual(snapshot.history.length, beforeHistory - 1);
      assert.ok(!snapshot.history.some((h) => h.productId === deleteTarget.id));
    });

    // 19. Replace restore
    await go('/data');
    await page.setInputFiles('#restore-file', backupPath);
    await page.waitForTimeout(400);
    await page.check('input[name="restore-mode"][value="replace"]');
    await page.waitForTimeout(250);
    await page.click('#restore-backup');
    await page.waitForSelector('#restore-confirm-check');
    await page.check('#restore-confirm-check');
    const replaceDownloadPromise = page.waitForEvent('download');
    await page.click('[data-modal-btn="confirm-restore"]');
    await replaceDownloadPromise;
    await page.waitForTimeout(600);
    snapshot = await state();
    await check('覆盖恢复恢复备份内容', async () => {
      assert.strictEqual(snapshot.products.length, backup.products.length);
      assert.strictEqual(snapshot.history.length, backup.priceHistory.length);
    });

    // 20. Mobile layout / no horizontal overflow
    for (const hash of ['/home', '/products', '/new', '/data']) {
      await go(hash);
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await check(`手机端无横向溢出 ${hash}`, async () => {
        assert.ok(overflow <= 1, `overflow=${overflow}`);
      });
    }
    await go('/home');
    await page.screenshot({ path: path.join(OUT, 'mobile-home.png'), fullPage: true });
    await go('/products');
    await page.screenshot({ path: path.join(OUT, 'mobile-products.png'), fullPage: true });
    await go('/data');
    await page.screenshot({ path: path.join(OUT, 'mobile-data.png'), fullPage: true });

    // 21. Clear data (cancel then confirm)
    await page.click('#clear-data');
    await page.waitForSelector('#clear-confirm-check');
    await page.click('[data-modal-btn="action-0"]');
    await page.waitForTimeout(150);
    await check('清空弹窗取消不删除数据', async () => {
      assert.ok((await state()).products.length > 0);
    });
    await page.click('#clear-data');
    await page.check('#clear-confirm-check');
    await page.click('[data-modal-btn="confirm-clear"]');
    await page.waitForTimeout(500);
    snapshot = await state();
    await check('清空本机数据', async () => {
      assert.strictEqual(snapshot.products.length, 0);
      assert.strictEqual(snapshot.history.length, 0);
    });

    // 22. Legacy migration in a fresh context
    const legacyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const legacyPage = await legacyContext.newPage();
    const legacyErrors = [];
    legacyPage.on('pageerror', (error) => legacyErrors.push(error.message));
    await legacyPage.goto(`${BASE}#/products`, { waitUntil: 'networkidle' });
    await legacyPage.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('products', JSON.stringify([
        { code: 'P-001', name: '旧可乐', buyPrice: 2.2, sellPrice: 3.5, stock: 12, initialStock: 20, description: '旧描述' },
        { code: 'P-002', name: '旧面包', buyPrice: 1.1, sellPrice: 2.2, stock: 3 },
        { code: 'P-001', name: '重复编码商品', buyPrice: 1, sellPrice: 2, stock: 1 }
      ]));
      localStorage.setItem('sales', JSON.stringify([{ id: 'legacy-sale' }]));
    });
    await legacyPage.reload({ waitUntil: 'networkidle' });
    await legacyPage.waitForTimeout(500);
    const legacyState = await legacyPage.evaluate(() => ({
      products: JSON.parse(localStorage.getItem('shopprice_products_v1') || '[]'),
      history: JSON.parse(localStorage.getItem('shopprice_price_history_v1') || '[]'),
      meta: JSON.parse(localStorage.getItem('shopprice_meta_v1') || '{}'),
      legacyProducts: JSON.parse(localStorage.getItem('products') || '[]'),
      legacySales: JSON.parse(localStorage.getItem('sales') || '[]')
    }));
    await check('自动迁移原 Mini POS Market 商品数据', async () => {
      assert.strictEqual(legacyState.products.length, 3);
      assert.strictEqual(legacyState.history.length, 3);
      assert.strictEqual(legacyState.meta.migration.from, 'Mini POS Market');
      assert.strictEqual(legacyState.legacyProducts.length, 3);
      assert.strictEqual(legacyState.legacySales.length, 1);
      const duplicate = legacyState.products.find((p) => p.name === '重复编码商品');
      assert.strictEqual(duplicate.barcode, '');
      assert.match(duplicate.note, /重复/);
      assert.match(legacyState.products[0].note, /原库存：12/);
      assert.match(legacyState.products[0].note, /旧描述/);
    });
    await check('迁移时也记录初始价格历史', async () => {
      assert.ok(legacyState.history.every((h) => h.beforeBuyPrice === null && h.beforeSellPrice === null));
      assert.ok(legacyState.history.every((h) => h.source === 'migration'));
    });
    await check('旧版迁移无脚本错误', async () => {
      assert.deepStrictEqual(legacyErrors, []);
    });
    await legacyPage.screenshot({ path: path.join(OUT, 'migration-products.png'), fullPage: true });
    await legacyContext.close();

    await check('整个流程无页面脚本错误', async () => {
      assert.deepStrictEqual(pageErrors, []);
    });

    console.log(`\nALL TESTS PASSED (${results.length} checks)`);
  } catch (error) {
    console.error('\nTEST FAILURE:', error.stack);
    await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {});
    console.log('PAGE ERRORS:', pageErrors);
    const passed = results.filter((result) => result.ok).length;
    console.log(`Passed ${passed}/${results.length} checks before failure.`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
