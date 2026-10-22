/* 店价宝 ShopPrice — full JSON backup, restore and data clearing. */

function exportBackup(options = {}) {
    const payload = {
        app: APP.name,
        format: APP.backupFormat,
        schemaVersion: APP.schemaVersion,
        exportedAt: nowIso(),
        counts: {
            products: state.products.length,
            priceHistory: state.history.length
        },
        products: state.products,
        priceHistory: state.history,
        meta: state.meta
    };
    downloadFile(
        `shopprice-backup-${dateStamp()}.json`,
        JSON.stringify(payload, null, 2),
        'application/json;charset=utf-8'
    );
    if (!options.silent) {
        toast(`完整备份已下载（${state.products.length} 件商品，${state.history.length} 条价格历史）`, 'success');
    }
}

function parseBackupText(text) {
    let data;
    try {
        data = JSON.parse(String(text == null ? '' : text));
    } catch (error) {
        throw new Error('备份文件不是有效的 JSON，可能已损坏');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('备份文件格式不正确');
    }
    if (data.format && data.format !== APP.backupFormat) {
        throw new Error('这不是店价宝的完整备份文件');
    }
    if (Number(data.schemaVersion || 1) > APP.schemaVersion) {
        throw new Error('备份来自更高版本的店价宝，请升级后再恢复');
    }
    const rawProducts = Array.isArray(data.products)
        ? data.products
        : (data.data && Array.isArray(data.data.products) ? data.data.products : null);
    const rawHistory = Array.isArray(data.priceHistory)
        ? data.priceHistory
        : (Array.isArray(data.price_history) ? data.price_history : []);
    if (!rawProducts) throw new Error('备份中缺少商品数据（products）');

    const products = [];
    const invalid = [];
    const seenIds = new Set();
    const seenBarcodes = new Map();

    rawProducts.forEach((raw, index) => {
        const rowNumber = index + 1;
        if (!raw || typeof raw !== 'object') {
            invalid.push(`第 ${rowNumber} 条商品数据不是对象，已跳过`);
            return;
        }
        const name = String(raw.name == null ? '' : raw.name).trim();
        if (!name) {
            invalid.push(`第 ${rowNumber} 条商品缺少名称，已跳过`);
            return;
        }
        const buy = parsePriceValue(raw.buyPrice);
        const sell = parsePriceValue(raw.sellPrice);
        if (buy === null || sell === null) {
            invalid.push(`商品“${name}”的价格缺失或不是非负数，已跳过`);
            return;
        }
        const id = String(raw.id == null ? '' : raw.id).trim() || uid();
        if (seenIds.has(id)) {
            invalid.push(`商品“${name}”的 ID 在备份中重复，已跳过`);
            return;
        }
        seenIds.add(id);

        let barcode = String(raw.barcode == null ? '' : raw.barcode).trim();
        const barcodeKey = normalizeBarcodeValue(barcode);
        if (barcodeKey && seenBarcodes.has(barcodeKey)) {
            invalid.push(`商品“${name}”的条码与“${seenBarcodes.get(barcodeKey)}”重复，已清空其条码`);
            barcode = '';
        } else if (barcodeKey) {
            seenBarcodes.set(barcodeKey, name);
        }

        const createdAt = validIso(raw.createdAt) || validIso(raw.updatedAt) || nowIso();
        const product = {
            ...raw,
            id,
            name,
            barcode,
            spec: String(raw.spec == null ? '' : raw.spec),
            category: String(raw.category == null ? '' : raw.category).trim() || DEFAULT_CATEGORY,
            buyPrice: buy,
            sellPrice: sell,
            note: String(raw.note == null ? '' : raw.note),
            createdAt,
            updatedAt: validIso(raw.updatedAt) || createdAt
        };
        products.push(product);
    });

    const history = [];
    const seenHistoryIds = new Set();
    rawHistory.forEach((raw, index) => {
        const rowNumber = index + 1;
        if (!raw || typeof raw !== 'object') {
            invalid.push(`第 ${rowNumber} 条价格历史格式错误，已跳过`);
            return;
        }
        const productId = String(raw.productId == null ? '' : raw.productId).trim();
        const afterBuy = parsePriceValue(raw.afterBuyPrice);
        const afterSell = parsePriceValue(raw.afterSellPrice);
        if (!productId || afterBuy === null || afterSell === null) {
            invalid.push(`第 ${rowNumber} 条价格历史缺少商品 ID 或价格，已跳过`);
            return;
        }
        const id = String(raw.id == null ? '' : raw.id).trim() || uid();
        if (seenHistoryIds.has(id)) {
            invalid.push(`第 ${rowNumber} 条价格历史 ID 重复，已跳过`);
            return;
        }
        seenHistoryIds.add(id);

        const beforeBuy = raw.beforeBuyPrice === null || raw.beforeBuyPrice === undefined || raw.beforeBuyPrice === ''
            ? null
            : parsePriceValue(raw.beforeBuyPrice);
        const beforeSell = raw.beforeSellPrice === null || raw.beforeSellPrice === undefined || raw.beforeSellPrice === ''
            ? null
            : parsePriceValue(raw.beforeSellPrice);
        const source = PRICE_SOURCE_LABELS[raw.source]
            ? raw.source
            : (beforeBuy === null && beforeSell === null ? 'create' : 'edit');

        history.push({
            ...raw,
            id,
            productId,
            productName: String(raw.productName == null ? '' : raw.productName),
            beforeBuyPrice: beforeBuy,
            beforeSellPrice: beforeSell,
            afterBuyPrice: afterBuy,
            afterSellPrice: afterSell,
            changedAt: validIso(raw.changedAt) || nowIso(),
            source
        });
    });

    return {
        products,
        history,
        invalid,
        exportedAt: validIso(data.exportedAt),
        schemaVersion: Number(data.schemaVersion || 1)
    };
}

function handleRestoreFile(file) {
    if (!file) return;
    state.restore = {
        fileName: file.name,
        products: [],
        history: [],
        invalid: [],
        error: null,
        exportedAt: null,
        mode: state.loadError ? 'replace' : 'merge'
    };
    refreshDataPreviews();

    readTextFile(file, MAX_BACKUP_BYTES, (error, text) => {
        if (error) {
            state.restore.error = error.message;
            refreshDataPreviews();
            toast(error.message, 'error');
            return;
        }
        try {
            const parsed = parseBackupText(text);
            state.restore = {
                fileName: file.name,
                mode: state.loadError ? 'replace' : 'merge',
                error: null,
                ...parsed
            };
            toast(`已读取备份：${parsed.products.length} 件商品，${parsed.history.length} 条价格历史`, 'info');
        } catch (parseError) {
            state.restore = {
                fileName: file.name,
                products: [],
                history: [],
                invalid: [],
                exportedAt: null,
                mode: state.loadError ? 'replace' : 'merge',
                error: parseError.message
            };
            toast(parseError.message, 'error');
        }
        refreshDataPreviews();
        const input = $('#restore-file');
        if (input) input.value = '';
    });
}

function evaluateRestore(mode) {
    if (!state.restore || state.restore.error) {
        return { newCount: 0, conflicts: 0, conflictNames: [] };
    }
    if (mode === 'replace') {
        return { newCount: state.restore.products.length, conflicts: 0, conflictNames: [] };
    }
    const ids = new Set(state.products.map((product) => product.id));
    const barcodes = new Set(state.products.map((product) => normalizeBarcodeValue(product.barcode)).filter(Boolean));
    let newCount = 0;
    let conflicts = 0;
    const conflictNames = [];
    state.restore.products.forEach((product) => {
        const barcodeKey = normalizeBarcodeValue(product.barcode);
        if (ids.has(product.id) || (barcodeKey && barcodes.has(barcodeKey))) {
            conflicts += 1;
            if (conflictNames.length < 4) conflictNames.push(product.name);
            return;
        }
        newCount += 1;
        ids.add(product.id);
        if (barcodeKey) barcodes.add(barcodeKey);
    });
    return { newCount, conflicts, conflictNames };
}

function restorePreviewHtml() {
    if (!state.restore) {
        return '<p class="form-hint">尚未选择备份文件。恢复前会先显示摘要，不会直接覆盖数据。</p>';
    }
    if (state.restore.error) {
        return `${noticeHtml('warning', '无法读取备份：', esc(state.restore.error))}
            <div class="card-actions">
                <button type="button" class="btn btn-ghost" data-action="clear-restore">取消</button>
            </div>`;
    }

    const mode = state.loadError ? 'replace' : (state.restore.mode || 'merge');
    const evaluation = evaluateRestore(mode);
    const productCount = state.restore.products.length;
    const historyCount = state.restore.history.length;
    const invalidCount = state.restore.invalid.length;
    const hasData = productCount > 0 || historyCount > 0;

    return `
        <div class="preview-summary">
            <span class="badge badge-success">备份商品 ${productCount}</span>
            <span class="badge">价格历史 ${historyCount}</span>
            ${mode === 'merge' ? `<span class="badge badge-warning">冲突 ${evaluation.conflicts}</span>` : ''}
            ${invalidCount ? `<span class="badge badge-error">无法读取 ${invalidCount}</span>` : ''}
        </div>
        <div class="file-name">
            文件：${esc(state.restore.fileName || '')}
            ${state.restore.exportedAt ? ` · 备份于 ${formatDateTime(state.restore.exportedAt)}` : ''}
        </div>

        ${state.loadError ? noticeHtml('warning', '当前数据异常：', '为避免再次覆盖，这里只能使用“覆盖恢复”。') : ''}

        <div class="import-mode">
            <label class="radio-card">
                <input type="radio" name="restore-mode" value="merge"
                    ${mode === 'merge' ? 'checked' : ''} ${state.loadError ? 'disabled' : ''}>
                <span>
                    <span class="radio-title">合并恢复（推荐）</span>
                    <span class="radio-desc">
                        只加入备份中的新商品；ID 或条码冲突的商品会跳过，不覆盖当前资料。
                        ${evaluation.conflicts ? `预计跳过 ${evaluation.conflicts} 件冲突商品${evaluation.conflictNames.length ? `（如：${esc(evaluation.conflictNames.join('、'))}）` : ''}。` : ''}
                    </span>
                </span>
            </label>
            <label class="radio-card">
                <input type="radio" name="restore-mode" value="replace" ${mode === 'replace' ? 'checked' : ''}>
                <span>
                    <span class="radio-title">覆盖恢复</span>
                    <span class="radio-desc">用备份替换当前全部商品和价格历史。恢复前会要求二次确认，并可自动下载当前备份。</span>
                </span>
            </label>
        </div>

        ${mode === 'replace'
            ? `<div class="danger-summary">覆盖后将替换当前 ${state.products.length} 件商品和 ${state.history.length} 条价格历史。此操作不可撤销。</div>`
            : ''}

        ${invalidCount ? `
            <details class="format-help" style="margin-top:10px">
                <summary>${invalidCount} 条数据无法读取，导入时将跳过</summary>
                <ul>${state.restore.invalid.slice(0, 20).map((message) => `<li>${esc(message)}</li>`).join('')}</ul>
                ${invalidCount > 20 ? `<p>仅显示前 20 条。</p>` : ''}
            </details>` : ''}

        <div class="card-actions">
            <button type="button" class="btn btn-primary" data-action="restore-backup" id="restore-backup" ${hasData ? '' : 'disabled'}>
                ${icon('refresh')} 恢复数据
            </button>
            <button type="button" class="btn btn-ghost" data-action="clear-restore">取消</button>
        </div>
        <p class="form-hint" style="margin-top:8px">${hasData ? '点击“恢复数据”后还会再次要求确认。' : '备份中没有可恢复的数据。'}</p>`;
}

function openRestoreConfirm() {
    if (!state.restore || state.restore.error) {
        toast('请先选择有效的备份文件', 'error');
        return;
    }
    const mode = state.loadError ? 'replace' : (state.restore.mode || 'merge');
    const evaluation = evaluateRestore(mode);
    const isReplace = mode === 'replace';
    const title = isReplace ? '确认覆盖恢复？' : '确认合并恢复？';

    openModal({
        title,
        body: `
            <p class="modal-text">
                即将${isReplace ? '用备份覆盖当前全部数据' : '把备份合并到当前数据'}。
                备份包含 <strong>${state.restore.products.length}</strong> 件商品、
                <strong>${state.restore.history.length}</strong> 条价格历史。
            </p>
            ${isReplace
                ? `<div class="danger-summary">当前 ${state.products.length} 件商品和 ${state.history.length} 条价格历史将被替换，此操作不可撤销。</div>`
                : `<div class="notice notice-info" style="margin-top:12px">${icon('info')}<div>合并时会跳过 ${evaluation.conflicts} 件 ID 或条码冲突的商品，不会覆盖现有资料。</div></div>`}
            <label class="confirm-box">
                <input type="checkbox" id="restore-confirm-check">
                <span>我已知晓恢复规则，确认继续。${isReplace ? '覆盖操作不可撤销。' : ''}</span>
            </label>
            ${isReplace ? `
                <label class="confirm-box">
                    <input type="checkbox" id="restore-auto-backup" checked>
                    <span>覆盖前先自动下载一份当前数据备份（推荐）</span>
                </label>` : ''}`,
        actions: [
            { label: '取消', className: 'btn-secondary' },
            {
                label: isReplace ? '覆盖并恢复' : '合并恢复',
                className: 'btn-primary',
                id: 'confirm-restore',
                disabled: true,
                iconName: 'refresh',
                onClick: (close) => {
                    const autoBackupInput = $('#restore-auto-backup');
                    const autoBackup = autoBackupInput ? autoBackupInput.checked : false;
                    const success = applyRestore(autoBackup);
                    if (success) {
                        close();
                        navigate('/home');
                    }
                }
            }
        ],
        onMount(root) {
            const check = $('#restore-confirm-check', root);
            const button = $('[data-modal-btn="confirm-restore"]', root);
            if (check && button) {
                check.addEventListener('change', () => {
                    button.disabled = !check.checked;
                });
            }
            if (check) check.focus();
        }
    });
}

function applyRestore(autoBackup) {
    if (!state.restore || state.restore.error) return false;
    const mode = state.loadError ? 'replace' : (state.restore.mode || 'merge');
    const previous = {
        products: state.products,
        history: state.history,
        meta: state.meta,
        loadError: state.loadError
    };

    let newProducts;
    let newHistory;
    let addedProducts = 0;
    let addedHistory = 0;
    let skippedProducts = 0;

    if (mode === 'replace') {
        if (autoBackup) exportBackup({ silent: true });
        newProducts = state.restore.products.map((product) => ({ ...product }));
        newHistory = state.restore.history.map((entry) => ({ ...entry }));
        addedProducts = newProducts.length;
        addedHistory = newHistory.length;
    } else {
        newProducts = state.products.map((product) => ({ ...product }));
        newHistory = state.history.slice();
        const ids = new Set(newProducts.map((product) => product.id));
        const barcodes = new Set(newProducts.map((product) => normalizeBarcodeValue(product.barcode)).filter(Boolean));
        state.restore.products.forEach((product) => {
            const barcodeKey = normalizeBarcodeValue(product.barcode);
            if (ids.has(product.id) || (barcodeKey && barcodes.has(barcodeKey))) {
                skippedProducts += 1;
                return;
            }
            newProducts.push({ ...product });
            ids.add(product.id);
            if (barcodeKey) barcodes.add(barcodeKey);
            addedProducts += 1;
        });
        const historyIds = new Set(newHistory.map((entry) => entry.id));
        state.restore.history.forEach((entry) => {
            if (historyIds.has(entry.id) || !ids.has(entry.productId)) return;
            newHistory.push({ ...entry });
            historyIds.add(entry.id);
            addedHistory += 1;
        });
    }

    state.products = newProducts;
    state.history = newHistory;
    state.loadError = null;
    state.meta = {
        ...state.meta,
        initialized: true,
        lastRestore: {
            at: nowIso(),
            mode,
            fileName: state.restore.fileName,
            productsAdded: addedProducts,
            historyAdded: addedHistory
        }
    };

    if (!persistAll({ force: true })) {
        state.products = previous.products;
        state.history = previous.history;
        state.meta = previous.meta;
        state.loadError = previous.loadError;
        return false;
    }

    state.restore = null;
    refreshDataPreviews();
    if (mode === 'replace') {
        toast(`已覆盖恢复 ${addedProducts} 件商品和 ${addedHistory} 条价格历史`, 'success');
    } else {
        toast(`合并完成：新增 ${addedProducts} 件商品、${addedHistory} 条历史${skippedProducts ? `，跳过 ${skippedProducts} 件冲突商品` : ''}`, 'success');
    }
    return true;
}

function clearRestorePreview() {
    state.restore = null;
    const input = $('#restore-file');
    if (input) input.value = '';
    refreshDataPreviews();
}

function openClearDataModal() {
    const autoBackupDefault = state.products.length > 0 || state.history.length > 0;
    openModal({
        title: '清空本机数据？',
        body: `
            <p class="modal-text">将删除当前浏览器中的
                <strong>${state.products.length}</strong> 件商品和
                <strong>${state.history.length}</strong> 条价格历史。</p>
            <div class="danger-summary">此操作不可撤销。如果没有备份，数据将无法找回。</div>
            <label class="confirm-box">
                <input type="checkbox" id="clear-auto-backup" ${autoBackupDefault ? 'checked' : ''}>
                <span>清空前先自动下载一份完整备份（推荐）</span>
            </label>
            <label class="confirm-box">
                <input type="checkbox" id="clear-confirm-check">
                <span>我确认要清空本机的商品和价格历史</span>
            </label>`,
        actions: [
            { label: '取消', className: 'btn-secondary' },
            {
                label: '确认清空',
                className: 'btn-danger',
                id: 'confirm-clear',
                disabled: true,
                iconName: 'trash',
                onClick: (close) => {
                    const autoBackupInput = $('#clear-auto-backup');
                    if (autoBackupInput && autoBackupInput.checked) exportBackup({ silent: true });

                    const previous = {
                        products: state.products,
                        history: state.history,
                        meta: state.meta,
                        loadError: state.loadError
                    };
                    state.products = [];
                    state.history = [];
                    state.loadError = null;
                    state.meta = {
                        ...state.meta,
                        initialized: true,
                        lastClear: { at: nowIso() }
                    };
                    if (!persistAll({ force: true })) {
                        state.products = previous.products;
                        state.history = previous.history;
                        state.meta = previous.meta;
                        state.loadError = previous.loadError;
                        return;
                    }
                    close();
                    toast('本机商品和价格历史已清空', 'success');
                    navigate('/home');
                }
            }
        ],
        onMount(root) {
            const check = $('#clear-confirm-check', root);
            const button = $('[data-modal-btn="confirm-clear"]', root);
            if (check && button) {
                check.addEventListener('change', () => {
                    button.disabled = !check.checked;
                });
            }
            if (check) check.focus();
        }
    });
}

function refreshDataPreviews() {
    const csvContainer = $('#csv-preview');
    if (csvContainer) csvContainer.innerHTML = csvPreviewHtml();
    const restoreContainer = $('#restore-preview');
    if (restoreContainer) restoreContainer.innerHTML = restorePreviewHtml();
}
