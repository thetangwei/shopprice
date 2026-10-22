/* 店价宝 ShopPrice — core utilities, storage, migration and modal/toast UI.
 * Vanilla HTML/CSS/JS · localStorage · no backend, no build step.
 * Based on the architecture and visual system of Mini POS Market (MIT).
 */
'use strict';

const APP = Object.freeze({
    name: '店价宝 ShopPrice',
    version: '2.0.1',
    backupFormat: 'shopprice-backup',
    schemaVersion: 1
});

const KEYS = Object.freeze({
    products: 'shopprice_products_v1',
    history: 'shopprice_price_history_v1',
    meta: 'shopprice_meta_v1'
});

const DEFAULT_CATEGORY = '未分类';
const MAX_CSV_ROWS = 5000;
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

const PRICE_SOURCE_LABELS = Object.freeze({
    create: '初始',
    migration: '旧版迁移',
    edit: '编辑',
    import: 'CSV 导入',
    restore: '备份恢复'
});

const state = {
    products: [],
    history: [],
    meta: {},
    loadError: null,
    storageError: null,
    filters: { q: '', category: '', sort: 'updated' },
    edit: { mode: null, id: null, dirty: false, timer: null, lastSavedAt: null },
    csv: null,
    restore: null,
    currentRoute: null,
    modalOnClose: null,
    modalReturnFocus: null,
    scan: { instance: null, active: false, busy: false, context: null }
};

let pendingMigrationNotice = null;

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function icon(name, extraClass = '') {
    return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
    return new Date().toISOString();
}

function validIso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function roundPrice(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parsePriceValue(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? roundPrice(value) : null;
    }
    let raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    raw = raw.replace(/[¥￥$€£]|RON|LEI|元/gi, '').replace(/\s+/g, '');
    if (raw.includes(',') && raw.includes('.')) {
        if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
            raw = raw.replace(/\./g, '').replace(/,/g, '.');
        } else {
            raw = raw.replace(/,/g, '');
        }
    } else if (raw.includes(',')) {
        raw = raw.replace(/,/g, '.');
    }
    raw = raw.replace(/[^\d.-]/g, '');
    if (!raw || (raw.match(/\./g) || []).length > 1) return null;
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) return null;
    return roundPrice(number);
}

function formatMoney(value) {
    const number = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (number) => String(number).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dateStamp() {
    const date = new Date();
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function normalizeBarcodeValue(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

function nl2br(value) {
    return esc(value).replace(/\n/g, '<br>');
}

function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function readTextFile(file, maxBytes, callback) {
    if (!file) {
        callback(new Error('未选择文件'));
        return;
    }
    if (file.size > maxBytes) {
        callback(new Error(`文件过大，请选择小于 ${Math.round(maxBytes / 1024 / 1024)} MB 的文件`));
        return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            callback(null, String(event.target.result || ''));
        } catch (error) {
            callback(error);
        }
    };
    reader.onerror = () => callback(new Error('文件读取失败，请重试'));
    reader.readAsText(file, 'UTF-8');
}

function toast(message, type = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    const iconName = type === 'error' ? 'warning' : type === 'success' ? 'check' : 'info';
    item.innerHTML = `${icon(iconName, 'icon-sm')}<span>${esc(message)}</span>`;
    root.appendChild(item);
    setTimeout(() => {
        item.style.opacity = '0';
        item.style.transition = 'opacity .2s ease';
        setTimeout(() => item.remove(), 220);
    }, type === 'error' ? 4200 : 2800);
}

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

function readStorage(key) {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return { exists: false, value: null };
        try {
            return { exists: true, value: JSON.parse(raw) };
        } catch (error) {
            return { exists: true, error: true, reason: 'json' };
        }
    } catch (error) {
        return { exists: true, error: true, reason: 'storage', message: error.message };
    }
}

function normalizeLoadedProduct(product) {
    if (!product || typeof product !== 'object') return null;
    const createdAt = validIso(product.createdAt) || validIso(product.updatedAt) || nowIso();
    const updatedAt = validIso(product.updatedAt) || createdAt;
    const buy = parsePriceValue(product.buyPrice);
    const sell = parsePriceValue(product.sellPrice);
    return {
        ...product,
        id: String(product.id || uid()),
        name: String(product.name == null ? '' : product.name).trim() || '未命名商品',
        barcode: String(product.barcode == null ? '' : product.barcode).trim(),
        spec: String(product.spec == null ? '' : product.spec),
        category: String(product.category == null ? '' : product.category).trim() || DEFAULT_CATEGORY,
        buyPrice: buy === null ? 0 : buy,
        sellPrice: sell === null ? 0 : sell,
        note: String(product.note == null ? '' : product.note),
        createdAt,
        updatedAt
    };
}

function normalizeLoadedHistory(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const afterBuy = parsePriceValue(entry.afterBuyPrice);
    const afterSell = parsePriceValue(entry.afterSellPrice);
    const beforeBuy = entry.beforeBuyPrice === null || entry.beforeBuyPrice === undefined || entry.beforeBuyPrice === ''
        ? null
        : parsePriceValue(entry.beforeBuyPrice);
    const beforeSell = entry.beforeSellPrice === null || entry.beforeSellPrice === undefined || entry.beforeSellPrice === ''
        ? null
        : parsePriceValue(entry.beforeSellPrice);
    const source = PRICE_SOURCE_LABELS[entry.source] ? entry.source : (beforeBuy === null && beforeSell === null ? 'create' : 'edit');
    return {
        ...entry,
        id: String(entry.id || uid()),
        productId: String(entry.productId || ''),
        productName: String(entry.productName || ''),
        beforeBuyPrice: beforeBuy,
        beforeSellPrice: beforeSell,
        afterBuyPrice: afterBuy === null ? 0 : afterBuy,
        afterSellPrice: afterSell === null ? 0 : afterSell,
        changedAt: validIso(entry.changedAt) || validIso(entry.updatedAt) || nowIso(),
        source
    };
}

function buildPriceHistory(product, beforeBuyPrice, beforeSellPrice, source, changedAt) {
    return {
        id: uid(),
        productId: product.id,
        productName: product.name,
        beforeBuyPrice: beforeBuyPrice === undefined ? null : beforeBuyPrice,
        beforeSellPrice: beforeSellPrice === undefined ? null : beforeSellPrice,
        afterBuyPrice: product.buyPrice,
        afterSellPrice: product.sellPrice,
        changedAt: changedAt || nowIso(),
        source: source || 'edit'
    };
}

function migrateLegacyProducts(legacyProducts) {
    const products = [];
    const history = [];
    const usedBarcodes = new Set();
    const baseTime = Date.now();
    const list = Array.isArray(legacyProducts) ? legacyProducts : [];

    list.forEach((legacy, index) => {
        if (!legacy || typeof legacy !== 'object') return;
        const notes = [];
        let barcode = String(legacy.code == null ? (legacy.barcode == null ? '' : legacy.barcode) : legacy.code).trim();
        if (barcode && usedBarcodes.has(normalizeBarcodeValue(barcode))) {
            notes.push(`原商品编码“${barcode}”与已有商品重复，已清空条码`);
            barcode = '';
        }
        if (barcode) usedBarcodes.add(normalizeBarcodeValue(barcode));

        const name = String(legacy.name == null ? '' : legacy.name).trim() || `未命名商品 ${index + 1}`;
        const buy = parsePriceValue(legacy.buyPrice);
        const sell = parsePriceValue(legacy.sellPrice);
        if (buy === null) notes.push(`原进货价“${legacy.buyPrice == null ? '' : legacy.buyPrice}”无法识别，已设为 0`);
        if (sell === null) notes.push(`原售价“${legacy.sellPrice == null ? '' : legacy.sellPrice}”无法识别，已设为 0`);
        if (legacy.stock !== undefined) notes.push(`原库存：${legacy.stock}`);
        if (legacy.description && String(legacy.description).trim()) {
            notes.push(`原描述：${String(legacy.description).trim()}`);
        }

        const created = validIso(legacy.createdAt)
            || new Date(baseTime - (list.length - index) * 1000).toISOString();
        const updated = validIso(legacy.updatedAt) || created;
        const product = {
            id: uid(),
            name,
            barcode,
            spec: '',
            category: DEFAULT_CATEGORY,
            buyPrice: buy === null ? 0 : buy,
            sellPrice: sell === null ? 0 : sell,
            note: notes.join('；'),
            createdAt: created,
            updatedAt: updated,
            legacy: { ...legacy }
        };
        products.push(product);
        history.push(buildPriceHistory(product, null, null, 'migration', created));
    });

    return { products, history };
}

function loadData() {
    const metaRead = readStorage(KEYS.meta);
    const productsRead = readStorage(KEYS.products);
    const historyRead = readStorage(KEYS.history);

    state.meta = metaRead.value && typeof metaRead.value === 'object' && !Array.isArray(metaRead.value)
        ? metaRead.value
        : {};

    if (productsRead.error || historyRead.error) {
        state.loadError = '本地商品数据读取失败。为避免覆盖原始数据，写入已暂停。请到“数据管理”恢复备份，或使用覆盖恢复。';
        state.products = [];
        state.history = [];
        return;
    }

    if (productsRead.exists) {
        if (!Array.isArray(productsRead.value)) {
            state.loadError = '本地商品数据格式异常（不是商品数组）。写入已暂停，请使用备份恢复。';
            state.products = [];
        } else {
            state.products = productsRead.value.map(normalizeLoadedProduct).filter(Boolean);
        }
        state.history = Array.isArray(historyRead.value)
            ? historyRead.value.map(normalizeLoadedHistory).filter(Boolean)
            : [];
        if (!historyRead.exists) state.history = [];
        if (historyRead.exists && !Array.isArray(historyRead.value)) {
            state.loadError = '本地价格历史格式异常。为避免覆盖历史记录，写入已暂停，请先导出或恢复备份。';
        }
        if (!state.meta.initialized) {
            state.meta = { ...state.meta, initialized: true };
            persistMeta();
        }
        return;
    }

    // No ShopPrice product key yet. Migrate legacy Mini POS Market data once.
    const legacyRead = readStorage('products');
    const canMigrate = !state.meta.initialized
        && legacyRead.exists
        && !legacyRead.error
        && Array.isArray(legacyRead.value)
        && legacyRead.value.length > 0;

    if (canMigrate) {
        const migrated = migrateLegacyProducts(legacyRead.value);
        state.products = migrated.products;
        state.history = Array.isArray(historyRead.value)
            ? historyRead.value.map(normalizeLoadedHistory).filter(Boolean)
            : migrated.history;
        const at = nowIso();
        state.meta = {
            ...state.meta,
            initialized: true,
            migration: {
                from: 'Mini POS Market',
                at,
                count: migrated.products.length,
                sourceKey: 'products',
                note: '原 products / sales / debts / paidDebts 键未被删除'
            }
        };
        const saved = persistAll({ silent: true, force: true });
        if (saved) {
            pendingMigrationNotice = `已从原 Mini POS Market 迁移 ${migrated.products.length} 件商品，原始数据仍保留在浏览器中。`;
        }
    } else {
        state.products = [];
        state.history = Array.isArray(historyRead.value)
            ? historyRead.value.map(normalizeLoadedHistory).filter(Boolean)
            : [];
        state.meta = { ...state.meta, initialized: true };
        persistAll({ silent: true, force: true });
    }
}

function persistMeta() {
    try {
        window.localStorage.setItem(KEYS.meta, JSON.stringify(state.meta));
        return true;
    } catch (error) {
        state.storageError = error.message;
        return false;
    }
}

function persistAll(options = {}) {
    if (state.loadError && !options.force) {
        if (!options.silent) {
            toast('本地数据读取异常，已暂停写入。请先到“数据管理”恢复备份。', 'error');
        }
        return false;
    }
    try {
        state.meta.initialized = true;
        window.localStorage.setItem(KEYS.products, JSON.stringify(state.products));
        window.localStorage.setItem(KEYS.history, JSON.stringify(state.history));
        window.localStorage.setItem(KEYS.meta, JSON.stringify(state.meta));
        state.storageError = null;
        return true;
    } catch (error) {
        state.storageError = error.message;
        if (!options.silent) {
            toast('保存失败：浏览器本地存储不可用或空间已满。请立即导出备份。', 'error');
        }
        return false;
    }
}

function findProduct(id) {
    return state.products.find((product) => product.id === id) || null;
}

function findByBarcode(barcode) {
    const key = normalizeBarcodeValue(barcode);
    if (!key) return null;
    return state.products.find((product) => normalizeBarcodeValue(product.barcode) === key) || null;
}

function getCategories() {
    const categories = new Set();
    state.products.forEach((product) => {
        if (product.category) categories.add(product.category);
    });
    return Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/* ------------------------------------------------------------------ */
/* Toast and modal                                                    */
/* ------------------------------------------------------------------ */

function openModal(config) {
    const root = $('#modal-root');
    if (!root) return null;
    hideModal();

    const actions = Array.isArray(config.actions) ? config.actions : [];
    const actionsHtml = actions.length
        ? `<div class="modal-actions">${actions.map((action, index) => `
            <button type="button" class="btn ${esc(action.className || 'btn-secondary')}"
                data-modal-btn="${esc(action.id || `action-${index}`)}" ${action.disabled ? 'disabled' : ''}>
                ${action.iconName ? icon(action.iconName) : ''}${esc(action.label)}
            </button>`).join('')}</div>`
        : '';

    root.innerHTML = `
        <div class="modal-backdrop" data-modal-backdrop>
            <div class="modal ${esc(config.size || '')}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
                <div class="modal-head">
                    <h2 id="modal-title">${esc(config.title || '')}</h2>
                    <button type="button" class="modal-close" data-modal-close aria-label="关闭">${icon('x')}</button>
                </div>
                <div class="modal-body">${config.body || ''}</div>
                ${actionsHtml}
            </div>
        </div>`;

    root.classList.add('open');
    document.body.classList.add('modal-open');
    state.modalReturnFocus = document.activeElement;
    state.modalOnClose = typeof config.onClose === 'function' ? config.onClose : null;

    const close = () => hideModal();
    root.querySelectorAll('[data-modal-close]').forEach((button) => {
        button.addEventListener('click', close);
    });
    const backdrop = $('[data-modal-backdrop]', root);
    if (backdrop) {
        backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) close();
        });
    }
    actions.forEach((action, index) => {
        const button = $(`[data-modal-btn="${action.id || `action-${index}`}"]`, root);
        if (!button) return;
        button.addEventListener('click', () => {
            if (typeof action.onClick === 'function') action.onClick(close);
            else close();
        });
    });

    if (typeof config.onMount === 'function') config.onMount(root, close);

    setTimeout(() => {
        const target = $('[autofocus]', root)
            || $('.modal-body input:not([type="hidden"]):not([disabled])', root)
            || $('.modal-actions .btn:not([disabled])', root)
            || $('.modal-close', root);
        if (target) target.focus({ preventScroll: true });
    }, 40);

    return close;
}

function hideModal() {
    const root = $('#modal-root');
    if (!root || !root.classList.contains('open')) return;
    root.classList.remove('open');
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
    const onClose = state.modalOnClose;
    state.modalOnClose = null;
    const returnFocus = state.modalReturnFocus;
    state.modalReturnFocus = null;
    if (typeof onClose === 'function') {
        try {
            onClose();
        } catch (error) {
            console.error(error);
        }
    }
    if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
    }
}
