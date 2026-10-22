/* 店价宝 ShopPrice — CSV parsing, preview, import and export. */

const CSV_HEADER_ALIASES = {
    name: ['商品名称', '商品名', '名称', '品名', '货品名称', 'name', 'productname', 'nume', 'denumire'],
    barcode: ['商品条码', '条码', '条形码', '条型码', '商品编码', '编码', '编号', '国际条码', 'barcode', 'code', 'cod', 'ean', 'ean13', 'sku'],
    spec: ['商品规格', '规格', '型号', 'spec', 'specification'],
    category: ['商品分类', '分类', '类别', 'category', 'categorie'],
    buyPrice: ['进货价', '进价', '进货价格', '采购价', '采购价格', '成本价', '成本', 'buyprice', 'purchaseprice', 'cost', 'pretcumparare', 'pretachizitie'],
    sellPrice: ['售价', '零售价', '销售价', '销售价格', '卖价', '价格', '商品售价', 'sellprice', 'sellingprice', 'price', 'pretvanzare', 'pret'],
    note: ['备注', '说明', '描述', 'note', 'notes', 'description', 'descriere', 'observatii'],
    createdAt: ['创建时间', '创建日期', '添加时间', 'createdat', 'created', 'dataadaugarii'],
    updatedAt: ['更新时间', '修改时间', '更新日期', 'updatedat', 'updated']
};

const CSV_HEADER_LOOKUP = new Map();
Object.entries(CSV_HEADER_ALIASES).forEach(([key, aliases]) => {
    aliases.forEach((alias) => CSV_HEADER_LOOKUP.set(normalizeCsvHeader(alias), key));
});

const CSV_STATUS = Object.freeze({
    new: { label: '新增', className: 'badge-success' },
    update: { label: '更新', className: 'badge-warning' },
    unchanged: { label: '无变化', className: '' },
    conflict: { label: '条码重复', className: 'badge-warning' },
    error: { label: '错误', className: 'badge-error' }
});

function normalizeCsvHeader(value) {
    return String(value == null ? '' : value)
        .replace(/^\uFEFF/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\s_\-—–:：/\\.,，。()（）\[\]【】'"“”]/g, '');
}

function detectDelimiter(text) {
    const lines = String(text).split(/\r?\n/);
    const line = lines.find((item) => item.trim() !== '') || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') i += 1;
            else quoted = !quoted;
        } else if (!quoted && counts[ch] !== undefined) {
            counts[ch] += 1;
        }
    }
    let best = ',';
    let bestCount = -1;
    Object.keys(counts).forEach((key) => {
        if (counts[key] > bestCount) {
            bestCount = counts[key];
            best = key;
        }
    });
    return best;
}

function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    quoted = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === delimiter) {
            row.push(field);
            field = '';
        } else if (ch === '\r') {
            if (text[i + 1] === '\n') i += 1;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function parseCsvText(text) {
    const cleaned = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    if (!cleaned.trim()) throw new Error('文件是空的，没有可读取的内容');

    const delimiter = detectDelimiter(cleaned);
    const table = parseDelimited(cleaned, delimiter);
    const headerIndex = table.findIndex((row) => row.some((cell) => String(cell).trim() !== ''));
    if (headerIndex === -1) throw new Error('没有找到 CSV 表头');

    const headers = table[headerIndex].map((header) => String(header).trim());
    const mapping = {};
    const available = {};
    headers.forEach((header, index) => {
        const key = CSV_HEADER_LOOKUP.get(normalizeCsvHeader(header));
        if (key && mapping[key] === undefined) {
            mapping[key] = index;
            available[key] = true;
        }
    });

    if (mapping.name === undefined || mapping.buyPrice === undefined || mapping.sellPrice === undefined) {
        throw new Error('无法识别 CSV 表头。请至少包含“商品名称、进货价、售价”三列（旧版 Cod/Nume/Preț Cumpărare/Preț Vânzare 也可）。');
    }

    const normalizedHeaders = headers.map(normalizeCsvHeader);
    const legacyStockFields = ['cantitateinitiala', 'stocactual', 'cantitatevanduta', 'totalcost', 'totalcantitate'];
    const legacy = normalizedHeaders.some((header) => ['cod', 'nume', 'pretcumparare', 'pretvanzare'].includes(header));
    const ignoredStockFields = normalizedHeaders.some((header) => legacyStockFields.includes(header));
    const rows = [];
    let ignoredSalesHistory = false;

    for (let i = headerIndex + 1; i < table.length; i += 1) {
        const rawRow = table[i];
        if (!rawRow || rawRow.every((cell) => String(cell).trim() === '')) continue;
        const first = normalizeCsvHeader(rawRow[0]);
        if (first.startsWith('istoric') || first === 'saleshistory' || first === '价格历史') {
            ignoredSalesHistory = true;
            break;
        }
        if (rows.length >= MAX_CSV_ROWS) {
            throw new Error(`一次最多导入 ${MAX_CSV_ROWS} 行，请拆分 CSV 后再试`);
        }
        const get = (key) => (mapping[key] === undefined ? '' : String(rawRow[mapping[key]] == null ? '' : rawRow[mapping[key]]).trim());
        const rawBuy = get('buyPrice');
        const rawSell = get('sellPrice');
        rows.push({
            line: i + 1,
            name: get('name'),
            barcode: get('barcode'),
            spec: get('spec'),
            category: get('category'),
            note: get('note'),
            rawBuy,
            rawSell,
            buyPrice: parsePriceValue(rawBuy),
            sellPrice: parsePriceValue(rawSell),
            createdAt: validIso(get('createdAt')),
            updatedAt: validIso(get('updatedAt')),
            available: { ...available }
        });
    }

    if (!rows.length) throw new Error('CSV 中没有商品数据行');
    return { rows, legacy, ignoredStockFields, ignoredSalesHistory, delimiter, headers };
}

function sameCsvProduct(row, existing) {
    if (row.name !== existing.name) return false;
    if (row.buyPrice !== existing.buyPrice || row.sellPrice !== existing.sellPrice) return false;
    if (row.available.spec && row.spec !== existing.spec) return false;
    if (row.available.note && row.note !== existing.note) return false;
    if (row.available.category && (row.category || DEFAULT_CATEGORY) !== (existing.category || DEFAULT_CATEGORY)) return false;
    return true;
}

function evaluateCsvRows(mode = 'skip') {
    if (!state.csv || !Array.isArray(state.csv.rows)) return [];
    const existingByBarcode = new Map();
    state.products.forEach((product) => {
        const key = normalizeBarcodeValue(product.barcode);
        if (key) existingByBarcode.set(key, product);
    });
    const seenInFile = new Map();

    return state.csv.rows.map((row) => {
        const errors = [];
        let status = 'new';
        let existingProduct = null;

        if (!row.name) errors.push('缺少商品名称');
        if (row.rawBuy === '') errors.push('缺少进货价');
        else if (row.buyPrice === null) errors.push(`进货价格式或数值不合法：“${row.rawBuy}”`);
        if (row.rawSell === '') errors.push('缺少售价');
        else if (row.sellPrice === null) errors.push(`售价格式或数值不合法：“${row.rawSell}”`);

        const barcodeKey = normalizeBarcodeValue(row.barcode);
        if (barcodeKey) {
            if (seenInFile.has(barcodeKey)) {
                errors.push(`条码与第 ${seenInFile.get(barcodeKey)} 行重复`);
            } else {
                seenInFile.set(barcodeKey, row.line);
            }
            existingProduct = existingByBarcode.get(barcodeKey) || null;
            if (existingProduct && mode === 'update') {
                status = sameCsvProduct(row, existingProduct) ? 'unchanged' : 'update';
            } else if (existingProduct) {
                status = 'conflict';
            }
        }

        let message = '';
        if (errors.length) {
            status = 'error';
            message = errors.join('；');
        } else if (status === 'update') {
            message = `将更新现有商品“${existingProduct.name}”`;
        } else if (status === 'unchanged') {
            message = '内容与现有商品相同，无需更新';
        } else if (status === 'conflict') {
            message = `条码已属于“${existingProduct.name}”，安全模式下跳过`;
        } else {
            message = '将新增商品';
        }

        return { ...row, errors, status, existingProduct, message };
    });
}

function csvStatusBadge(status) {
    const meta = CSV_STATUS[status] || CSV_STATUS.error;
    return `<span class="badge ${meta.className}">${meta.label}</span>`;
}

function csvPreviewHtml() {
    if (!state.csv) {
        return '<p class="form-hint">尚未选择 CSV 文件。选择后会在这里预览，不会直接写入数据。</p>';
    }
    if (state.csv.error) {
        return `${noticeHtml('warning', '无法读取 CSV：', esc(state.csv.error))}
            <div class="card-actions">
                <button type="button" class="btn btn-ghost" data-action="clear-csv">取消</button>
            </div>`;
    }

    const mode = state.csv.mode || 'skip';
    const evaluated = evaluateCsvRows(mode);
    const counts = { new: 0, update: 0, unchanged: 0, conflict: 0, error: 0 };
    evaluated.forEach((row) => {
        counts[row.status] += 1;
    });
    const importable = counts.new + counts.update;
    const previewRows = evaluated.slice(0, 200);
    const notes = [];
    if (state.csv.legacy) notes.push('检测到旧版 Mini POS Market 表头，已自动兼容');
    if (state.csv.ignoredStockFields) notes.push('旧版库存字段已忽略');
    if (state.csv.ignoredSalesHistory) notes.push('文件尾部的旧版销售历史已忽略');
    if (evaluated.length > previewRows.length) notes.push(`仅展示前 ${previewRows.length} 行，导入时会处理全部 ${evaluated.length} 行`);

    return `
        <div class="preview-summary">
            <span class="badge badge-success">新增 ${counts.new}</span>
            <span class="badge badge-warning">更新 ${counts.update}</span>
            <span class="badge">跳过 ${counts.conflict + counts.unchanged}</span>
            <span class="badge badge-error">错误 ${counts.error}</span>
        </div>
        <div class="file-name">文件：${esc(state.csv.fileName || '')} · 共 ${evaluated.length} 行</div>
        ${notes.length ? `<div class="notice notice-info" style="margin-top:10px">${icon('info')}<div>${notes.map(esc).join('；')}。</div></div>` : ''}

        <div class="import-mode">
            <label class="radio-card">
                <input type="radio" name="csv-mode" value="skip" ${mode === 'skip' ? 'checked' : ''}>
                <span>
                    <span class="radio-title">安全模式（推荐）</span>
                    <span class="radio-desc">只新增商品；已有条码会跳过，绝不覆盖现有资料。</span>
                </span>
            </label>
            <label class="radio-card">
                <input type="radio" name="csv-mode" value="update" ${mode === 'update' ? 'checked' : ''}>
                <span>
                    <span class="radio-title">按条码更新已有商品</span>
                    <span class="radio-desc">明确选择后才会更新；价格变化会自动写入价格历史。</span>
                </span>
            </label>
        </div>

        <div class="preview-table-wrap">
            <table class="preview-table">
                <thead>
                    <tr>
                        <th>行</th><th>状态</th><th>商品名称</th><th>条码</th>
                        <th>进货价</th><th>售价</th><th>说明</th>
                    </tr>
                </thead>
                <tbody>
                    ${previewRows.map((row) => `
                        <tr>
                            <td>${row.line}</td>
                            <td>${csvStatusBadge(row.status)}</td>
                            <td class="wrap">${row.name ? esc(row.name) : '<span class="preview-error">（空）</span>'}</td>
                            <td class="mono">${row.barcode ? esc(row.barcode) : '—'}</td>
                            <td>${row.rawBuy ? esc(row.rawBuy) : '—'}</td>
                            <td>${row.rawSell ? esc(row.rawSell) : '—'}</td>
                            <td class="wrap ${row.errors.length ? 'preview-error' : ''}">${esc(row.message)}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>

        <div class="card-actions">
            <button type="button" class="btn btn-primary" data-action="apply-csv" id="apply-csv" ${importable ? '' : 'disabled'}>
                ${icon('upload')} 导入 ${importable} 行
            </button>
            <button type="button" class="btn btn-ghost" data-action="clear-csv">取消</button>
        </div>
        <p class="form-hint" style="margin-top:8px">
            ${importable ? '导入前请确认上方预览。' : '没有可导入的行，请修正文件或错误。'}安全模式不会静默覆盖现有商品。
        </p>`;
}

function handleCsvFile(file) {
    if (!file) return;
    state.csv = { fileName: file.name, rows: [], error: null, mode: 'skip' };
    refreshDataPreviews();
    readTextFile(file, MAX_CSV_BYTES, (error, text) => {
        if (error) {
            state.csv.error = error.message;
            refreshDataPreviews();
            return;
        }
        try {
            const parsed = parseCsvText(text);
            state.csv = { fileName: file.name, mode: 'skip', error: null, ...parsed };
            toast(`已读取 ${parsed.rows.length} 行，请预览后导入`, 'info');
        } catch (parseError) {
            state.csv = { fileName: file.name, rows: [], error: parseError.message, mode: 'skip' };
            toast(parseError.message, 'error');
        }
        refreshDataPreviews();
        const input = $('#csv-file');
        if (input) input.value = '';
    });
}

function clearCsvPreview() {
    state.csv = null;
    const input = $('#csv-file');
    if (input) input.value = '';
    refreshDataPreviews();
}

function applyCsvImport() {
    if (!state.csv || state.csv.error) {
        toast('请先选择并预览 CSV 文件', 'error');
        return;
    }
    const evaluated = evaluateCsvRows(state.csv.mode || 'skip');
    const importable = evaluated.filter((row) => row.status === 'new' || row.status === 'update');
    if (!importable.length) {
        toast('没有可导入的行，请检查预览中的错误', 'error');
        return;
    }

    const previousProducts = state.products;
    const previousHistory = state.history;
    const newProducts = state.products.map((product) => ({ ...product }));
    const newHistory = state.history.slice();
    const barcodeMap = new Map();
    newProducts.forEach((product) => {
        const key = normalizeBarcodeValue(product.barcode);
        if (key) barcodeMap.set(key, product);
    });

    let added = 0;
    let updated = 0;
    let skipped = 0;

    importable.forEach((row) => {
        const barcodeKey = normalizeBarcodeValue(row.barcode);
        if (row.status === 'new') {
            if (barcodeKey && barcodeMap.has(barcodeKey)) {
                skipped += 1;
                return;
            }
            const createdAt = row.createdAt || nowIso();
            const product = {
                id: uid(),
                name: row.name,
                barcode: row.barcode,
                spec: row.available.spec ? row.spec : '',
                category: (row.available.category ? row.category : '') || DEFAULT_CATEGORY,
                buyPrice: row.buyPrice,
                sellPrice: row.sellPrice,
                note: row.available.note ? row.note : '',
                createdAt,
                updatedAt: row.updatedAt || createdAt
            };
            newProducts.push(product);
            if (barcodeKey) barcodeMap.set(barcodeKey, product);
            newHistory.push(buildPriceHistory(product, null, null, 'import', createdAt));
            added += 1;
            return;
        }

        const existing = barcodeKey ? barcodeMap.get(barcodeKey) : null;
        if (!existing) {
            skipped += 1;
            return;
        }
        const beforeBuy = existing.buyPrice;
        const beforeSell = existing.sellPrice;
        const oldName = existing.name;
        if (row.available.name) existing.name = row.name;
        if (row.available.barcode) existing.barcode = row.barcode;
        if (row.available.spec) existing.spec = row.spec;
        if (row.available.category) existing.category = row.category || DEFAULT_CATEGORY;
        if (row.available.note) existing.note = row.note;
        existing.buyPrice = row.buyPrice;
        existing.sellPrice = row.sellPrice;
        existing.updatedAt = nowIso();
        if (beforeBuy !== existing.buyPrice || beforeSell !== existing.sellPrice) {
            const historyEntry = buildPriceHistory(existing, beforeBuy, beforeSell, 'import', existing.updatedAt);
            if (!historyEntry.productName) historyEntry.productName = oldName;
            newHistory.push(historyEntry);
        }
        updated += 1;
    });

    state.products = newProducts;
    state.history = newHistory;
    const saved = persistAll();
    if (!saved) {
        state.products = previousProducts;
        state.history = previousHistory;
        return;
    }

    state.csv = null;
    const input = $('#csv-file');
    if (input) input.value = '';
    toast(`导入完成：新增 ${added} 件，更新 ${updated} 件${skipped ? `，跳过 ${skipped} 件` : ''}`, 'success');
    renderRoute({ keepScroll: true });
}

/* ------------------------------------------------------------------ */
/* CSV export                                                         */
/* ------------------------------------------------------------------ */

function csvEscape(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportProductsCsv() {
    if (!state.products.length) {
        toast('当前没有商品可导出', 'info');
        return;
    }
    const headers = ['商品名称', '商品条码', '商品规格', '商品分类', '进货价', '售价', '备注', '创建时间', '更新时间'];
    const lines = [headers.join(',')];
    state.products.slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        .forEach((product) => {
            lines.push([
                csvEscape(product.name),
                csvEscape(product.barcode),
                csvEscape(product.spec),
                csvEscape(product.category),
                product.buyPrice.toFixed(2),
                product.sellPrice.toFixed(2),
                csvEscape(product.note),
                csvEscape(product.createdAt),
                csvEscape(product.updatedAt)
            ].join(','));
        });
    downloadFile(`shopprice-products-${dateStamp()}.csv`, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
    toast(`已导出 ${state.products.length} 件商品的 CSV`, 'success');
}

function exportHistoryCsv() {
    if (!state.history.length) {
        toast('当前没有价格历史可导出', 'info');
        return;
    }
    const headers = ['商品ID', '商品名称', '修改前进货价', '修改后进货价', '修改前售价', '修改后售价', '修改时间', '来源'];
    const lines = [headers.join(',')];
    state.history.slice()
        .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
        .forEach((entry) => {
            const product = findProduct(entry.productId);
            lines.push([
                csvEscape(entry.productId),
                csvEscape((product && product.name) || entry.productName || '（已删除商品）'),
                entry.beforeBuyPrice === null ? '' : Number(entry.beforeBuyPrice).toFixed(2),
                Number(entry.afterBuyPrice).toFixed(2),
                entry.beforeSellPrice === null ? '' : Number(entry.beforeSellPrice).toFixed(2),
                Number(entry.afterSellPrice).toFixed(2),
                csvEscape(entry.changedAt),
                csvEscape(PRICE_SOURCE_LABELS[entry.source] || entry.source || '')
            ].join(','));
        });
    downloadFile(`shopprice-price-history-${dateStamp()}.csv`, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
    toast(`已导出 ${state.history.length} 条价格历史`, 'success');
}
