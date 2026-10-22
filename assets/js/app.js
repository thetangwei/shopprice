/* 店价宝 ShopPrice — routing, forms, events and boot. */

function parseHashRoute() {
    const raw = (window.location.hash || '').replace(/^#/, '') || '/home';
    const queryIndex = raw.indexOf('?');
    const pathPart = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
    const queryPart = queryIndex === -1 ? '' : raw.slice(queryIndex + 1);
    const parts = pathPart.split('/').filter(Boolean).map((part) => {
        try {
            return decodeURIComponent(part);
        } catch (error) {
            return part;
        }
    });
    return { parts, params: new URLSearchParams(queryPart) };
}

function navigate(path) {
    const hash = path.startsWith('#') ? path : `#${path}`;
    if (window.location.hash === hash) {
        renderRoute();
    } else {
        window.location.hash = hash;
    }
}

function currentNavKey(viewName) {
    if (viewName === 'home') return 'home';
    if (viewName === 'data') return 'data';
    return 'products';
}

const WORKSPACE_VIEWS = new Set(['products', 'detail', 'edit', 'new']);

function applyViewMode(viewName) {
    document.body.dataset.view = viewName;
    document.body.classList.remove('view-home', 'view-products', 'view-detail', 'view-edit', 'view-new', 'view-data');
    document.body.classList.add(`view-${viewName}`);
    document.body.classList.toggle('workspace-view', WORKSPACE_VIEWS.has(viewName));
}

function isEditableElement(element) {
    if (!element || !element.matches) return false;
    return element.matches('input, textarea, select, [contenteditable="true"]');
}

function updateInputFocusState() {
    const view = document.body.dataset.view;
    const compact = window.matchMedia('(pointer: coarse), (max-width: 900px)').matches;
    const typing = compact
        && (view === 'edit' || view === 'new')
        && isEditableElement(document.activeElement);
    document.body.classList.toggle('input-focused', typing);
}

function updateNavigation(viewName) {
    const navKey = currentNavKey(viewName);
    $$('[data-nav]').forEach((link) => {
        const active = link.dataset.nav === navKey;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
}

function renderRoute(options = {}) {
    const route = parseHashRoute();
    const section = route.parts[0] || 'home';
    let viewName = 'home';
    let title = '首页';
    let html = '';

    if (section === 'product' && route.parts[1]) {
        const product = findProduct(route.parts[1]);
        viewName = 'detail';
        title = product ? product.name : '商品不存在';
        html = renderDetail(route.parts[1]);
    } else if (section === 'edit' && route.parts[1]) {
        viewName = 'edit';
        title = '编辑商品';
        html = renderForm(route.parts[1], route);
    } else if (section === 'new') {
        viewName = 'new';
        title = '添加商品';
        html = renderForm(null, route);
    } else if (section === 'products') {
        viewName = 'products';
        title = '商品';
        html = renderProducts(route);
    } else if (section === 'data') {
        viewName = 'data';
        title = '数据管理';
        html = renderData();
    } else {
        viewName = 'home';
        html = renderHome(route);
    }

    if (viewName !== 'edit' && viewName !== 'new') {
        if (state.edit.timer) clearTimeout(state.edit.timer);
        state.edit = { mode: null, id: null, dirty: false, timer: null, lastSavedAt: null };
    }

    state.currentRoute = route;
    applyViewMode(viewName);
    const app = $('#app');
    app.innerHTML = html;
    document.title = `${title} · 店价宝 ShopPrice`;
    updateNavigation(viewName);
    bindView(route, viewName);
    updateInputFocusState();
    if (!options.keepScroll) window.scrollTo({ top: 0, behavior: 'auto' });
}

function bindView(route, viewName) {
    if (viewName === 'home') {
        const form = $('#home-search-form');
        if (form) {
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                const input = $('#home-search-input');
                const query = input ? input.value.trim() : '';
                if (!query) {
                    if (input) input.focus();
                    return;
                }
                const exact = findByBarcode(query);
                if (exact) {
                    navigate(`/product/${encodeURIComponent(exact.id)}`);
                    return;
                }
                state.filters = { q: query, category: '', sort: 'updated' };
                navigate('/products');
            });
        }
        return;
    }

    if (viewName === 'products') {
        const search = $('#product-search');
        const category = $('#filter-category');
        const sort = $('#filter-sort');
        const updateResults = () => {
            const results = $('#product-results');
            if (results) results.innerHTML = renderProductResults();
            const count = $('#result-count');
            const products = filteredProducts();
            if (count) count.textContent = products.length ? `找到 ${products.length} 件商品` : '没有匹配结果';
            toggleClearFilterButton();
        };
        const debouncedUpdate = debounce(updateResults, 100);
        if (search) {
            search.addEventListener('input', () => {
                state.filters.q = search.value;
                toggleClearFilterButton();
                debouncedUpdate();
            });
        }
        if (category) {
            category.addEventListener('change', () => {
                state.filters.category = category.value;
                updateResults();
            });
        }
        if (sort) {
            sort.addEventListener('change', () => {
                state.filters.sort = sort.value;
                updateResults();
            });
        }
        return;
    }

    if (viewName === 'edit' || viewName === 'new') {
        bindProductForm(viewName === 'edit' ? route.parts[1] : null);
    }
}

function toggleClearFilterButton() {
    const count = $('#result-count');
    if (!count) return;
    const meta = count.parentElement;
    const hasFilters = Boolean(state.filters.q.trim() || state.filters.category);
    let button = meta ? $('[data-action="clear-filters"]', meta) : null;
    if (hasFilters && meta && !button) {
        meta.insertAdjacentHTML('beforeend', '<button type="button" class="section-link" data-action="clear-filters">清除筛选</button>');
    } else if (!hasFilters && button) {
        button.remove();
    }
}

/* ------------------------------------------------------------------ */
/* Product form                                                       */
/* ------------------------------------------------------------------ */

function setFormStatus(message, type = '') {
    const status = $('#form-status');
    if (!status) return;
    status.textContent = message;
    status.className = `form-status${type ? ` ${type}` : ''}`;
}

function readProductFormValues() {
    const get = (id) => {
        const element = $(id);
        return element ? String(element.value == null ? '' : element.value) : '';
    };
    return {
        name: get('#product-name').trim(),
        barcode: get('#product-barcode').trim(),
        spec: get('#product-spec').trim(),
        category: get('#product-category').trim(),
        buyPriceRaw: get('#product-buy-price').trim(),
        sellPriceRaw: get('#product-sell-price').trim(),
        note: get('#product-note').trim()
    };
}

function validateProductForm(values, editingId) {
    const errors = {};
    const name = values.name;
    const barcode = values.barcode;

    if (!name) errors.name = '请输入商品名称';
    else if (name.length > 80) errors.name = '商品名称不能超过 80 个字符';
    if (barcode.length > 64) errors.barcode = '商品条码不能超过 64 个字符';
    if (barcode) {
        const key = normalizeBarcodeValue(barcode);
        const duplicate = state.products.find((product) => product.id !== editingId && normalizeBarcodeValue(product.barcode) === key);
        if (duplicate) errors.barcode = `该条码已被“${duplicate.name}”使用`;
    }
    if (values.spec.length > 80) errors.spec = '商品规格不能超过 80 个字符';
    if (values.category.length > 40) errors.category = '商品分类不能超过 40 个字符';
    if (values.note.length > 1000) errors.note = '备注不能超过 1000 个字符';

    const buyPrice = parsePriceValue(values.buyPriceRaw);
    const sellPrice = parsePriceValue(values.sellPriceRaw);
    if (values.buyPriceRaw === '') errors.buyPrice = '请输入进货价';
    else if (buyPrice === null) errors.buyPrice = '请输入不小于 0 的有效进货价';
    else if (buyPrice > 99999999.99) errors.buyPrice = '进货价过大';
    if (values.sellPriceRaw === '') errors.sellPrice = '请输入售价';
    else if (sellPrice === null) errors.sellPrice = '请输入不小于 0 的有效售价';
    else if (sellPrice > 99999999.99) errors.sellPrice = '售价过大';

    return {
        ok: Object.keys(errors).length === 0,
        errors,
        normalized: {
            name,
            barcode,
            spec: values.spec,
            category: values.category || DEFAULT_CATEGORY,
            buyPrice: buyPrice === null ? 0 : buyPrice,
            sellPrice: sellPrice === null ? 0 : sellPrice,
            note: values.note
        }
    };
}

function setProductFormErrors(errors) {
    const fields = ['name', 'barcode', 'spec', 'category', 'buyPrice', 'sellPrice', 'note'];
    fields.forEach((field) => {
        const errorElement = $(`[data-error-for="${field}"]`);
        const input = $(`[data-field="${field}"]`);
        if (errorElement) errorElement.textContent = errors[field] || '';
        if (input) {
            if (errors[field]) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
        }
    });
}

function clearFieldError(field) {
    if (!field) return;
    const errorElement = $(`[data-error-for="${field}"]`);
    const input = $(`[data-field="${field}"]`);
    if (errorElement) errorElement.textContent = '';
    if (input) input.removeAttribute('aria-invalid');
}

function focusFirstError(errors) {
    const first = ['name', 'barcode', 'spec', 'category', 'buyPrice', 'sellPrice', 'note']
        .find((field) => errors[field]);
    if (!first) return;
    const input = $(`[data-field="${first}"]`);
    if (input) input.focus();
}

function bindProductForm(editingId) {
    const form = $('#product-form');
    if (!form) return;
    const editing = Boolean(editingId);
    state.edit = {
        mode: editing ? 'edit' : 'new',
        id: editingId || null,
        dirty: false,
        timer: null,
        lastSavedAt: null
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (editing) submitEditProduct();
        else submitNewProduct();
    });

    form.addEventListener('input', (event) => {
        const field = event.target && event.target.dataset ? event.target.dataset.field : null;
        clearFieldError(field);
        state.edit.dirty = true;
        if (editing) {
            setFormStatus('有未保存的修改，停止输入后自动保存…');
            scheduleEditAutosave();
        } else {
            setFormStatus('填写完成后点击“保存商品”。');
        }
    });
}

function scheduleEditAutosave() {
    if (state.edit.timer) clearTimeout(state.edit.timer);
    state.edit.timer = setTimeout(() => {
        state.edit.timer = null;
        saveEditForm({ auto: true, silent: true });
    }, 600);
}

function submitNewProduct() {
    const values = readProductFormValues();
    const validation = validateProductForm(values, null);
    if (!validation.ok) {
        setProductFormErrors(validation.errors);
        focusFirstError(validation.errors);
        setFormStatus('请检查并修正表单中的错误。', 'error');
        toast('商品信息有误，请检查必填项和价格', 'error');
        return;
    }

    const timestamp = nowIso();
    const product = {
        id: uid(),
        ...validation.normalized,
        createdAt: timestamp,
        updatedAt: timestamp
    };
    const historyEntry = buildPriceHistory(product, null, null, 'create', timestamp);

    state.products.push(product);
    state.history.push(historyEntry);
    state.edit.dirty = false;
    if (!persistAll()) {
        state.products.pop();
        state.history.pop();
        state.edit.dirty = true;
        setFormStatus('保存失败，请重试并先导出备份。', 'error');
        return;
    }

    toast('商品已添加，并记录了初始价格', 'success');
    navigate(`/product/${encodeURIComponent(product.id)}`);
}

function submitEditProduct() {
    if (state.edit.timer) {
        clearTimeout(state.edit.timer);
        state.edit.timer = null;
    }
    const saved = saveEditForm({ auto: false, silent: false });
    if (saved) {
        navigate(`/product/${encodeURIComponent(state.edit.id)}`);
    }
}

function saveEditForm(options = {}) {
    if (state.edit.mode !== 'edit' || !state.edit.id) return false;
    const product = findProduct(state.edit.id);
    if (!product) {
        setFormStatus('商品已被删除，无法保存。', 'error');
        toast('商品已被删除', 'error');
        return false;
    }

    const values = readProductFormValues();
    const validation = validateProductForm(values, product.id);
    if (!validation.ok) {
        setProductFormErrors(validation.errors);
        const firstError = Object.values(validation.errors)[0] || '请检查表单';
        setFormStatus(`自动保存暂停：${firstError}`, 'error');
        if (!options.silent) {
            focusFirstError(validation.errors);
            toast('修改未保存，请检查表单', 'error');
        }
        return false;
    }

    const next = { ...product, ...validation.normalized };
    const fields = ['name', 'barcode', 'spec', 'category', 'buyPrice', 'sellPrice', 'note'];
    const changed = fields.some((field) => product[field] !== next[field]);
    if (!changed) {
        state.edit.dirty = false;
        setFormStatus('没有需要保存的修改。');
        return true;
    }

    const timestamp = nowIso();
    next.updatedAt = timestamp;
    const priceChanged = product.buyPrice !== next.buyPrice || product.sellPrice !== next.sellPrice;
    const index = state.products.findIndex((item) => item.id === product.id);
    const historyEntry = priceChanged
        ? buildPriceHistory(next, product.buyPrice, product.sellPrice, 'edit', timestamp)
        : null;

    state.products[index] = next;
    if (historyEntry) state.history.push(historyEntry);

    if (!persistAll()) {
        state.products[index] = product;
        if (historyEntry) {
            const historyIndex = state.history.findIndex((entry) => entry.id === historyEntry.id);
            if (historyIndex !== -1) state.history.splice(historyIndex, 1);
        }
        setFormStatus('自动保存失败：浏览器存储不可用或已满。', 'error');
        return false;
    }

    state.products[index] = next;
    state.edit.dirty = false;
    state.edit.lastSavedAt = timestamp;
    const updatedDisplay = $('#form-updated-at');
    if (updatedDisplay) updatedDisplay.textContent = formatDateTime(timestamp);
    setFormStatus(
        `已自动保存 ${formatTime(timestamp)}${priceChanged ? '，并记录了价格变动' : ''}`,
        'ok'
    );
    if (!options.auto && !options.silent) toast('商品已保存', 'success');
    return true;
}

function flushEditAutosave() {
    if (state.edit.mode !== 'edit' || !$('#product-form')) return true;
    if (state.edit.timer) {
        clearTimeout(state.edit.timer);
        state.edit.timer = null;
    }
    if (!state.edit.dirty) return true;
    const ok = saveEditForm({ auto: true, silent: true });
    if (!ok) toast('有修改未能保存，请检查商品表单中的提示', 'error');
    return ok;
}

/* ------------------------------------------------------------------ */
/* Delete product                                                     */
/* ------------------------------------------------------------------ */

function openDeleteProductModal(id) {
    const product = findProduct(id);
    if (!product) {
        toast('商品不存在或已被删除', 'error');
        return;
    }
    const historyCount = state.history.filter((entry) => entry.productId === product.id).length;

    openModal({
        title: `删除“${product.name}”？`,
        body: `
            <p class="modal-text">这件商品及其当前价格将被删除，此操作不可撤销。</p>
            <div class="danger-summary">
                当前有 ${historyCount} 条价格历史。价格历史独立保存，默认不会随商品删除。
            </div>
            <label class="confirm-box">
                <input type="checkbox" id="delete-history-check" ${historyCount ? '' : 'disabled'}>
                <span>同时删除这 ${historyCount} 条价格历史${historyCount ? '' : '（当前没有历史）'}</span>
            </label>
            <p class="form-hint">
                不勾选时，历史记录会保留，仍可通过“数据管理 → 导出价格历史 CSV”查看；
                商品详情页将不再显示这些记录。
            </p>
            <label class="confirm-box">
                <input type="checkbox" id="delete-confirm-check">
                <span>我确认删除此商品</span>
            </label>`,
        actions: [
            { label: '取消', className: 'btn-secondary' },
            {
                label: '确认删除',
                className: 'btn-danger',
                id: 'confirm-delete',
                disabled: true,
                iconName: 'trash',
                onClick: (close) => {
                    const confirmCheck = $('#delete-confirm-check');
                    const historyCheck = $('#delete-history-check');
                    if (!confirmCheck || !confirmCheck.checked) return;
                    const deleteHistory = Boolean(historyCheck && historyCheck.checked && !historyCheck.disabled);

                    const previousProducts = state.products;
                    const previousHistory = state.history;
                    state.products = state.products.filter((item) => item.id !== product.id);
                    if (deleteHistory) {
                        state.history = state.history.filter((entry) => entry.productId !== product.id);
                    }
                    if (!persistAll()) {
                        state.products = previousProducts;
                        state.history = previousHistory;
                        return;
                    }
                    close();
                    toast(deleteHistory ? '商品及价格历史已删除' : '商品已删除，价格历史已保留', 'success');
                    navigate('/products');
                }
            }
        ],
        onMount(root) {
            const confirmCheck = $('#delete-confirm-check', root);
            const button = $('[data-modal-btn="confirm-delete"]', root);
            if (confirmCheck && button) {
                confirmCheck.addEventListener('change', () => {
                    button.disabled = !confirmCheck.checked;
                });
            }
            if (confirmCheck) confirmCheck.focus();
        }
    });
}

/* ------------------------------------------------------------------ */
/* Global events                                                      */
/* ------------------------------------------------------------------ */

function handleGlobalClick(event) {
    const actionElement = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!actionElement) return;
    const action = actionElement.dataset.action;

    switch (action) {
        case 'scan':
            openScanner(actionElement.dataset.context || 'global');
            break;
        case 'add-product':
            navigate('/new');
            break;
        case 'clear-filters':
            state.filters = { q: '', category: '', sort: 'updated' };
            renderRoute({ keepScroll: true });
            break;
        case 'scroll-history': {
            const history = $('#price-history');
            if (history) history.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
        }
        case 'delete-product':
            openDeleteProductModal(actionElement.dataset.id);
            break;
        case 'export-products':
            exportProductsCsv();
            break;
        case 'export-history':
            exportHistoryCsv();
            break;
        case 'backup':
            exportBackup();
            break;
        case 'pick-csv': {
            const input = $('#csv-file');
            if (input) input.click();
            break;
        }
        case 'clear-csv':
            clearCsvPreview();
            break;
        case 'apply-csv':
            applyCsvImport();
            break;
        case 'pick-restore': {
            const input = $('#restore-file');
            if (input) input.click();
            break;
        }
        case 'clear-restore':
            clearRestorePreview();
            break;
        case 'restore-backup':
            openRestoreConfirm();
            break;
        case 'clear-data':
            openClearDataModal();
            break;
        default:
            break;
    }
}

function handleGlobalChange(event) {
    const target = event.target;
    if (!target) return;

    if (target.id === 'csv-file') {
        const file = target.files && target.files[0];
        if (file) handleCsvFile(file);
        return;
    }
    if (target.id === 'restore-file') {
        const file = target.files && target.files[0];
        if (file) handleRestoreFile(file);
        return;
    }
    if (target.name === 'csv-mode' && state.csv) {
        state.csv.mode = target.value;
        refreshDataPreviews();
        return;
    }
    if (target.name === 'restore-mode' && state.restore) {
        state.restore.mode = target.value;
        refreshDataPreviews();
    }
}

function handleGlobalKeydown(event) {
    if (event.key === 'Escape') {
        const modalRoot = $('#modal-root');
        if (modalRoot && modalRoot.classList.contains('open')) {
            hideModal();
            return;
        }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        const form = $('#product-form');
        if (form) {
            event.preventDefault();
            form.requestSubmit();
        }
    }
}

function handleHashChange() {
    flushEditAutosave();
    if (state.edit.mode === 'new' && state.edit.dirty) {
        toast('新增商品尚未保存', 'info');
    }
    renderRoute();
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

function init() {
    loadData();

    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('change', handleGlobalChange);
    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('focusin', updateInputFocusState);
    document.addEventListener('focusout', () => setTimeout(updateInputFocusState, 0));
    window.addEventListener('resize', updateInputFocusState);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateInputFocusState);
    }
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('beforeunload', () => {
        flushEditAutosave();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) flushEditAutosave();
    });

    if (!window.location.hash) {
        try {
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/home`);
        } catch (error) {
            window.location.hash = '#/home';
        }
    }

    renderRoute();

    if (state.loadError) {
        setTimeout(() => toast(state.loadError, 'error'), 300);
    }
    if (pendingMigrationNotice) {
        setTimeout(() => {
            toast(pendingMigrationNotice, 'info');
            pendingMigrationNotice = null;
        }, 450);
    }

    window.ShopPrice = {
        version: APP.version,
        storageKeys: { ...KEYS },
        getProducts: () => JSON.parse(JSON.stringify(state.products)),
        getHistory: () => JSON.parse(JSON.stringify(state.history)),
        getMeta: () => JSON.parse(JSON.stringify(state.meta)),
        findProduct: (id) => {
            const product = findProduct(id);
            return product ? JSON.parse(JSON.stringify(product)) : null;
        },
        findByBarcode: (barcode) => {
            const product = findByBarcode(barcode);
            return product ? JSON.parse(JSON.stringify(product)) : null;
        }
    };
}

init();
