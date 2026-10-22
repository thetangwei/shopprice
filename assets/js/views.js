/* 店价宝 ShopPrice — view rendering. */

const SORT_OPTIONS = Object.freeze([
    ['updated', '最近更新'],
    ['name', '名称 A→Z'],
    ['sell-asc', '售价从低到高'],
    ['sell-desc', '售价从高到低']
]);

function filteredProducts() {
    const query = state.filters.q.trim().toLowerCase();
    const category = state.filters.category;
    let list = state.products.slice();

    if (query) {
        list = list.filter((product) => {
            const name = String(product.name || '').toLowerCase();
            const barcode = String(product.barcode || '').toLowerCase();
            return name.includes(query) || barcode.includes(query);
        });
    }
    if (category) {
        list = list.filter((product) => product.category === category);
    }

    switch (state.filters.sort) {
        case 'name':
            list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
            break;
        case 'sell-asc':
            list.sort((a, b) => a.sellPrice - b.sellPrice || a.name.localeCompare(b.name, 'zh-Hans-CN'));
            break;
        case 'sell-desc':
            list.sort((a, b) => b.sellPrice - a.sellPrice || a.name.localeCompare(b.name, 'zh-Hans-CN'));
            break;
        case 'updated':
        default:
            list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            break;
    }
    return list;
}

function productRowHtml(product, options = {}) {
    const showUpdated = Boolean(options.showUpdated);
    const category = product.category && product.category !== DEFAULT_CATEGORY
        ? `<span class="category-chip">${esc(product.category)}</span>`
        : '';
    return `
        <a class="product-row" href="#/product/${encodeURIComponent(product.id)}"
            data-product-id="${esc(product.id)}" aria-label="查看商品 ${esc(product.name)}">
            <div class="product-main">
                <div class="product-name-line">
                    <span class="product-name">${esc(product.name)}</span>
                    ${category}
                </div>
                <div class="product-meta">
                    ${product.barcode
                        ? `<span class="barcode-text">${esc(product.barcode)}</span>`
                        : '<span class="muted">未填写条码</span>'}
                    ${product.spec ? `<span>${esc(product.spec)}</span>` : ''}
                    ${showUpdated ? `<span>更新于 ${formatDateTime(product.updatedAt)}</span>` : ''}
                </div>
            </div>
            <div class="product-prices">
                <div class="product-sell">${formatMoney(product.sellPrice)}</div>
                <div class="product-buy">进 ${formatMoney(product.buyPrice)}</div>
            </div>
        </a>`;
}

function productListHtml(products, options = {}) {
    if (!products.length) return '';
    return `<div class="product-list">${products.map((product) => productRowHtml(product, options)).join('')}</div>`;
}

function emptyStateHtml(iconName, title, description, actionsHtml = '') {
    return `
        <div class="empty-state">
            ${icon(iconName)}
            <h3>${esc(title)}</h3>
            <p>${esc(description)}</p>
            ${actionsHtml ? `<div class="card-actions">${actionsHtml}</div>` : ''}
        </div>`;
}

function noticeHtml(type, title, message, actionHtml = '') {
    return `
        <div class="notice notice-${type}">
            ${icon(type === 'warning' ? 'warning' : 'info')}
            <div>${title ? `<strong>${esc(title)}</strong>` : ''}${title ? ' ' : ''}${message}${actionHtml ? ` ${actionHtml}` : ''}</div>
        </div>`;
}

function renderHome(route) {
    const products = state.products;
    const categories = getCategories();
    const recent = products.slice()
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 5);

    const loadError = state.loadError
        ? noticeHtml('warning', '本地数据异常：', esc(state.loadError), '<a href="#/data">前往数据管理</a>')
        : '';
    const storageError = state.storageError
        ? noticeHtml('warning', '保存异常：', esc(state.storageError), '<a href="#/data">立即备份</a>')
        : '';

    return `
        <div class="page">
            <section class="hero">
                <div>
                    <p class="hero-eyebrow">小店商品价格管理工具</p>
                    <h1>商品扫码查，<br>价格随时记。</h1>
                    <p class="hero-desc">记录商品的进货价、售价和每一次价格变化。无需登录，打开就能用。</p>
                </div>
                <div class="hero-actions">
                    <button type="button" class="btn btn-primary" data-action="scan">
                        ${icon('scan')} 扫码查价
                    </button>
                    <button type="button" class="btn btn-glass" data-action="add-product">
                        ${icon('plus')} 添加商品
                    </button>
                </div>
            </section>

            ${loadError}
            ${storageError}

            <form class="search-panel" id="home-search-form" role="search" novalidate>
                <div class="search-input-wrap">
                    ${icon('search')}
                    <label class="sr-only" for="home-search-input">搜索商品名称或条码</label>
                    <input type="search" id="home-search-input" placeholder="输入商品名称或条码查询"
                        autocomplete="off" enterkeyhint="search">
                </div>
                <button type="submit" class="btn btn-primary" id="home-search-btn">查询</button>
            </form>

            <div class="stat-grid">
                <div class="stat-card">
                    <div class="stat-label">商品总数</div>
                    <div class="stat-value">${products.length}<small>件</small></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">商品分类</div>
                    <div class="stat-value">${categories.length}<small>类</small></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">价格记录</div>
                    <div class="stat-value">${state.history.length}<small>条</small></div>
                </div>
            </div>

            <div class="section-head">
                <h2>最近修改</h2>
                <a class="section-link" href="#/products">全部商品</a>
            </div>

            ${recent.length
                ? productListHtml(recent, { showUpdated: true })
                : emptyStateHtml(
                    'box',
                    '还没有商品',
                    '添加第一件商品，或直接用摄像头扫描商品条码开始记录。',
                    `<button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')} 添加商品</button>
                     <button type="button" class="btn btn-secondary" data-action="scan">${icon('scan')} 扫码</button>`
                )}

            <div class="notice notice-warning">
                ${icon('warning')}
                <div>
                    <strong>数据保存在本设备浏览器中</strong>，不会自动同步到其他设备。
                    清理浏览器数据、更换设备或使用无痕模式可能导致数据丢失，请定期
                    <a href="#/data">备份数据</a>。
                </div>
            </div>

            <p class="storage-footnote">店价宝 ${APP.version} · 当前版本无需登录，也不会上传商品资料</p>
        </div>`;
}

function renderProductResults() {
    const products = filteredProducts();
    if (!state.products.length) {
        return emptyStateHtml(
            'box',
            '还没有商品',
            '添加商品后，可以在这里搜索、筛选和查看价格历史。',
            `<button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')} 添加商品</button>
             <button type="button" class="btn btn-secondary" data-action="scan">${icon('scan')} 扫码</button>`
        );
    }
    if (!products.length) {
        return emptyStateHtml(
            'search',
            '没有找到匹配的商品',
            '试试其他名称或条码，或清除分类与搜索条件。',
            `<button type="button" class="btn btn-secondary" data-action="clear-filters">清除筛选</button>`
        );
    }
    return productListHtml(products);
}

function renderProducts(route) {
    const queryParam = route && route.params ? route.params.get('q') : null;
    if (queryParam !== null && queryParam !== state.filters.q) {
        state.filters.q = queryParam;
    }
    const categories = getCategories();
    if (state.filters.category && !categories.includes(state.filters.category)) {
        state.filters.category = '';
    }
    const products = filteredProducts();
    const hasFilters = Boolean(state.filters.q.trim() || state.filters.category);

    return `
        <div class="page page-products">
            <div class="products-fixed">
                <div class="page-head">
                    <div>
                        <h1>商品</h1>
                        <p class="page-subtitle" id="products-subtitle">共 ${state.products.length} 件商品，按价格变化随时更新</p>
                    </div>
                    <button type="button" class="btn btn-primary" data-action="add-product">
                        ${icon('plus')} 添加商品
                    </button>
                </div>

                <div class="toolbar">
                    <div class="search-input-wrap">
                        <label class="sr-only" for="product-search">搜索商品名称或条码</label>
                        <input type="search" id="product-search" placeholder="搜索商品名称或条码"
                            value="${esc(state.filters.q)}" autocomplete="off">
                    </div>
                    <div class="toolbar-row">
                        <div>
                            <label class="sr-only" for="filter-category">按分类筛选</label>
                            <select id="filter-category">
                                <option value="">全部分类</option>
                                ${categories.map((category) => `
                                    <option value="${esc(category)}" ${state.filters.category === category ? 'selected' : ''}>
                                        ${esc(category)}
                                    </option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="sr-only" for="filter-sort">排序方式</label>
                            <select id="filter-sort">
                                ${SORT_OPTIONS.map(([value, label]) => `
                                    <option value="${value}" ${state.filters.sort === value ? 'selected' : ''}>
                                        ${label}
                                    </option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>

                <div class="result-meta">
                    <span id="result-count">${products.length ? `找到 ${products.length} 件商品` : '没有匹配结果'}</span>
                    ${hasFilters ? '<button type="button" class="section-link" data-action="clear-filters">清除筛选</button>' : ''}
                </div>
            </div>

            <div class="product-list-scroll" id="product-list-scroll">
                <div id="product-results">${renderProductResults()}</div>

                <div class="notice notice-warning">
                    ${icon('warning')}
                    <div>商品资料只保存在此浏览器中，不会自动同步。请定期 <a href="#/data">导出备份</a>。</div>
                </div>
            </div>
        </div>`;
}

function historyChangeHtml(label, before, after) {
    if (before === null) {
        return `<div class="history-change"><span class="label">初始${label}</span><span class="new">${formatMoney(after)}</span></div>`;
    }
    if (Number(before) === Number(after)) {
        return `<div class="history-change"><span class="label">${label}</span><span class="same">${formatMoney(after)}（未变）</span></div>`;
    }
    return `<div class="history-change">
        <span class="label">${label}</span>
        <span class="old">${formatMoney(before)}</span>
        <span class="arrow">→</span>
        <span class="new">${formatMoney(after)}</span>
    </div>`;
}

function historyItemHtml(entry) {
    const initial = entry.beforeBuyPrice === null && entry.beforeSellPrice === null;
    return `
        <div class="history-item ${initial ? 'initial' : ''}"
            data-history-id="${esc(entry.id)}"
            data-before-buy="${entry.beforeBuyPrice === null ? '' : esc(entry.beforeBuyPrice)}"
            data-after-buy="${esc(entry.afterBuyPrice)}"
            data-before-sell="${entry.beforeSellPrice === null ? '' : esc(entry.beforeSellPrice)}"
            data-after-sell="${esc(entry.afterSellPrice)}">
            <div class="history-date">
                <span>${formatDateTime(entry.changedAt)}</span>
                <span class="badge ${initial ? 'badge-accent' : ''}">${esc(PRICE_SOURCE_LABELS[entry.source] || '编辑')}</span>
            </div>
            <div class="history-changes">
                ${historyChangeHtml('进货价', entry.beforeBuyPrice, entry.afterBuyPrice)}
                ${historyChangeHtml('售价', entry.beforeSellPrice, entry.afterSellPrice)}
            </div>
        </div>`;
}

function notFoundPage(title, description, backPath = '/products', backLabel = '返回商品列表') {
    return `
        <div class="page">
            <div class="empty-state">
                ${icon('box')}
                <h3>${esc(title)}</h3>
                <p>${esc(description)}</p>
                <div class="card-actions">
                    <a class="btn btn-primary" href="#${esc(backPath)}">${esc(backLabel)}</a>
                </div>
            </div>
        </div>`;
}

function renderDetail(id) {
    const product = findProduct(id);
    if (!product) {
        return notFoundPage('商品不存在', '这件商品可能已经被删除，或链接已失效。');
    }
    const history = state.history
        .filter((entry) => entry.productId === product.id)
        .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));

    const margin = product.sellPrice - product.buyPrice;
    const marginPercent = product.sellPrice > 0 ? (margin / product.sellPrice) * 100 : 0;

    return `
        <div class="page page-detail">
            <div class="detail-topbar page-topbar">
                <a class="btn btn-ghost btn-small" href="#/products">${icon('arrow-left')} 商品列表</a>
                <span class="spacer"></span>
                <button type="button" class="btn btn-secondary btn-small" data-action="scroll-history">
                    ${icon('history')} 价格历史
                </button>
            </div>

            <div class="page-scroll" id="detail-scroll">
                <div class="page-head">
                    <div>
                        <h1>${esc(product.name)}</h1>
                        <div class="product-meta">
                            <span class="category-chip">${esc(product.category || DEFAULT_CATEGORY)}</span>
                            ${product.spec ? `<span>${esc(product.spec)}</span>` : ''}
                        </div>
                    </div>
                </div>

                <section class="price-panel">
                    <div class="price-label">当前售价</div>
                    <div class="price-main">${formatMoney(product.sellPrice)}<small>人民币</small></div>
                    <div class="price-pair">
                        <div>
                            <span>进货价</span>
                            <span>${formatMoney(product.buyPrice)}</span>
                        </div>
                        <div>
                            <span>毛利</span>
                            <span>${formatMoney(margin)}${product.sellPrice > 0 ? ` · ${marginPercent.toFixed(1)}%` : ''}</span>
                        </div>
                    </div>
                </section>

                <section class="card">
                    <h2>商品资料</h2>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="info-label">商品条码</span>
                            <span class="info-value mono">${product.barcode ? esc(product.barcode) : '<span class="muted">未填写</span>'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">商品分类</span>
                            <span class="info-value">${esc(product.category || DEFAULT_CATEGORY)}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">商品规格</span>
                            <span class="info-value">${product.spec ? esc(product.spec) : '<span class="muted">未填写</span>'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">最后更新</span>
                            <span class="info-value">${formatDateTime(product.updatedAt)}</span>
                        </div>
                        <div class="info-item full">
                            <span class="info-label">备注</span>
                            <span class="info-value">${product.note ? nl2br(product.note) : '<span class="muted">无备注</span>'}</span>
                        </div>
                        <div class="info-item full">
                            <span class="info-label">创建时间</span>
                            <span class="info-value">${formatDateTime(product.createdAt)}</span>
                        </div>
                    </div>
                </section>

                <section class="card" id="price-history">
                    <div class="section-head" style="margin-top:0">
                        <h2>价格历史</h2>
                        <span class="badge">${history.length} 条</span>
                    </div>
                    <p class="card-desc">每次进货价或售价发生变化都会自动记录。修改名称、分类、规格或备注不会新增记录。</p>
                    ${history.length
                        ? `<div class="history-list">${history.map(historyItemHtml).join('')}</div>`
                        : '<p class="muted">暂无价格历史记录。</p>'}
                </section>
            </div>

            <div class="page-actionbar detail-actionbar">
                <a class="btn btn-primary" href="#/edit/${encodeURIComponent(product.id)}" id="edit-product">
                    ${icon('edit')} 编辑商品
                </a>
                <button type="button" class="btn btn-danger-soft" data-action="delete-product"
                    data-id="${esc(product.id)}" id="delete-product">
                    ${icon('trash')} 删除
                </button>
            </div>
        </div>`;
}

function renderForm(id, route) {
    const editing = Boolean(id);
    const product = editing ? findProduct(id) : null;
    if (editing && !product) {
        return notFoundPage('商品不存在', '无法编辑这件商品，它可能已经被删除。');
    }

    const barcodeFromScan = !editing && route && route.params ? (route.params.get('barcode') || '') : '';
    const values = product || {
        id: null,
        name: '',
        barcode: barcodeFromScan,
        spec: '',
        category: '',
        buyPrice: '',
        sellPrice: '',
        note: '',
        createdAt: null,
        updatedAt: null
    };
    const categories = getCategories();
    const backPath = editing ? `/product/${encodeURIComponent(product.id)}` : '/products';
    const statusText = editing
        ? '修改后自动保存。价格变化会写入价格历史。'
        : (barcodeFromScan ? '条码已从扫码结果填入，请补充商品资料后保存。' : '带 * 的字段为必填项，保存后可在商品详情中查看价格历史。');

    return `
        <div class="page page-form">
            <div class="detail-topbar page-topbar">
                <a class="btn btn-ghost btn-small" href="#${esc(backPath)}">${icon('arrow-left')} ${editing ? '商品详情' : '商品列表'}</a>
                <span class="spacer"></span>
                ${editing ? `<a class="btn btn-secondary btn-small" href="#/product/${encodeURIComponent(product.id)}">查看详情</a>` : ''}
            </div>

            <div class="page-scroll" id="form-scroll">
                <div class="page-head">
                    <div>
                        <h1>${editing ? '编辑商品' : '添加商品'}</h1>
                        <p class="page-subtitle">${editing ? '修改会自动保存，无需手动提交' : '记录商品资料和当前价格'}</p>
                    </div>
                </div>

                <form class="card" id="product-form" novalidate>
                    <div class="form-grid two">
                        <div class="form-group">
                            <label for="product-name">商品名称<span class="required">*</span></label>
                            <input type="text" id="product-name" data-field="name" maxlength="80"
                                value="${esc(values.name)}" placeholder="例如：可乐 500ml" autocomplete="off">
                            <span class="field-error" id="err-name" data-error-for="name"></span>
                        </div>

                        <div class="form-group">
                            <label for="product-barcode">商品条码 <span class="form-hint">（可选）</span></label>
                            <div class="input-action-row">
                                <input type="text" id="product-barcode" data-field="barcode" maxlength="64"
                                    value="${esc(values.barcode)}" placeholder="扫码或手动输入" autocomplete="off">
                                <button type="button" class="btn btn-secondary" data-action="scan" data-context="form">
                                    ${icon('scan')} 扫码
                                </button>
                            </div>
                            <span class="field-error" id="err-barcode" data-error-for="barcode"></span>
                            <span class="form-hint">非空条码不能与其他商品重复</span>
                        </div>

                        <div class="form-group">
                            <label for="product-spec">商品规格</label>
                            <input type="text" id="product-spec" data-field="spec" maxlength="80"
                                value="${esc(values.spec)}" placeholder="例如：500ml / 500g / 一箱 12 瓶">
                            <span class="field-error" id="err-spec" data-error-for="spec"></span>
                        </div>

                        <div class="form-group">
                            <label for="product-category">商品分类</label>
                            <input type="text" id="product-category" data-field="category" maxlength="40"
                                value="${esc(values.category)}" placeholder="例如：饮料、日用品" list="category-options"
                                autocomplete="off">
                            <datalist id="category-options">
                                ${categories.map((category) => `<option value="${esc(category)}"></option>`).join('')}
                            </datalist>
                            <span class="field-error" id="err-category" data-error-for="category"></span>
                        </div>

                        <div class="form-group">
                            <label for="product-buy-price">进货价<span class="required">*</span></label>
                            <div class="input-with-prefix">
                                <span class="prefix">¥</span>
                                <input type="number" id="product-buy-price" data-field="buyPrice" inputmode="decimal"
                                    min="0" step="0.01" value="${values.buyPrice === '' ? '' : esc(values.buyPrice)}"
                                    placeholder="0.00">
                            </div>
                            <span class="field-error" id="err-buyPrice" data-error-for="buyPrice"></span>
                        </div>

                        <div class="form-group">
                            <label for="product-sell-price">售价<span class="required">*</span></label>
                            <div class="input-with-prefix">
                                <span class="prefix">¥</span>
                                <input type="number" id="product-sell-price" data-field="sellPrice" inputmode="decimal"
                                    min="0" step="0.01" value="${values.sellPrice === '' ? '' : esc(values.sellPrice)}"
                                    placeholder="0.00">
                            </div>
                            <span class="field-error" id="err-sellPrice" data-error-for="sellPrice"></span>
                        </div>
                    </div>

                    <div class="form-group" style="margin-top:15px">
                        <label for="product-note">备注</label>
                        <textarea id="product-note" data-field="note" maxlength="1000"
                            placeholder="例如：常备货、供应商电话、陈列位置">${esc(values.note)}</textarea>
                        <span class="field-error" id="err-note" data-error-for="note"></span>
                    </div>

                    <div class="form-status" id="form-status">${esc(statusText)}</div>
                </form>

                ${editing ? `
                    <section class="card">
                        <h2>记录信息</h2>
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">创建时间</span>
                                <span class="info-value">${formatDateTime(product.createdAt)}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">最后更新</span>
                                <span class="info-value" id="form-updated-at">${formatDateTime(product.updatedAt)}</span>
                            </div>
                        </div>
                    </section>` : ''}
            </div>

            <div class="page-actionbar form-actionbar">
                <a class="btn btn-secondary" href="#${esc(backPath)}">取消</a>
                <button type="submit" class="btn btn-primary" id="save-product" form="product-form">
                    ${icon('check')} 保存商品
                </button>
            </div>
        </div>`;
}

function actionCardHtml(action, iconName, title, description, id = '') {
    return `
        <button type="button" class="action-card" data-action="${esc(action)}" ${id ? `id="${esc(id)}"` : ''}>
            <span class="action-icon">${icon(iconName)}</span>
            <span class="action-copy">
                <span class="action-title">${esc(title)}</span>
                <span class="action-desc">${esc(description)}</span>
            </span>
        </button>`;
}

function renderData() {
    const orphanCount = state.history.filter((entry) => !findProduct(entry.productId)).length;
    const migration = state.meta.migration;
    const loadError = state.loadError
        ? noticeHtml('warning', '本地数据异常：', esc(state.loadError), '<a href="#/data">请使用下方备份恢复</a>')
        : '';
    const storageError = state.storageError
        ? noticeHtml('warning', '最近一次保存失败：', esc(state.storageError))
        : '';
    const migrationNotice = migration
        ? noticeHtml(
            'info',
            '已完成旧版数据迁移：',
            `已于 ${formatDateTime(migration.at)} 从 ${esc(migration.from || 'Mini POS Market')} 迁移 ${migration.count || 0} 件商品。原始浏览器数据没有被删除。`
        )
        : '';

    return `
        <div class="page">
            <div class="page-head">
                <div>
                    <h1>数据管理</h1>
                    <p class="page-subtitle">导入、导出、备份与恢复</p>
                </div>
            </div>

            ${loadError}
            ${storageError}
            ${migrationNotice}

            <div class="notice notice-warning">
                ${icon('warning')}
                <div>
                    <strong>当前版本的数据保存在本设备浏览器中</strong>，不会自动同步到其他设备。
                    清理浏览器数据可能导致数据丢失，建议每周导出一次完整备份。
                </div>
            </div>

            <section class="card">
                <h2>导出</h2>
                <p class="card-desc">商品 CSV 可交给表格软件查看；完整备份包含商品和价格历史，用于恢复。</p>
                <div class="action-grid">
                    ${actionCardHtml('export-products', 'file', '导出商品 CSV', '导出全部商品资料，可用 Excel 打开', 'export-products')}
                    ${actionCardHtml('export-history', 'history', '导出价格历史 CSV', '单独导出全部价格变动记录', 'export-history')}
                    ${actionCardHtml('backup', 'shield', '下载完整备份', 'JSON 格式，包含商品和价格历史', 'backup-btn')}
                </div>
                <div class="data-counts">
                    当前共 ${state.products.length} 件商品、${state.history.length} 条价格记录${orphanCount ? `（其中 ${orphanCount} 条为已删除商品保留的历史）` : ''}。
                </div>
            </section>

            <section class="card">
                <h2>导入商品 CSV</h2>
                <p class="card-desc">选择文件后会先预览并检查重复条码、缺失字段和非法价格，确认后才会写入。</p>
                <div class="file-pick-row">
                    <button type="button" class="btn btn-secondary" data-action="pick-csv">
                        ${icon('upload')} 选择 CSV 文件
                    </button>
                    <span class="form-hint">支持新版格式及原 Mini POS Market 旧版格式</span>
                </div>
                <input type="file" id="csv-file" class="file-input-hidden" accept=".csv,text/csv">
                <div class="preview-wrap" id="csv-preview">${csvPreviewHtml()}</div>

                <details class="format-help">
                    <summary>CSV 格式说明</summary>
                    <pre>商品名称,商品条码,商品规格,商品分类,进货价,售价,备注,创建时间,更新时间
可乐 500ml,6901234567890,500ml,饮料,2.50,4.00,常备货,,</pre>
                    <p>旧版文件表头如 “Cod,Nume,Preț Cumpărare,Preț Vânzare” 也能识别，库存等已移除字段会被忽略。条码可留空，非空条码不能重复。</p>
                </details>
            </section>

            <section class="card">
                <h2>恢复完整备份</h2>
                <p class="card-desc">备份恢复前会显示数据摘要和冲突情况；默认只合并新商品，不会静默覆盖现有资料。</p>
                <div class="file-pick-row">
                    <button type="button" class="btn btn-secondary" data-action="pick-restore">
                        ${icon('refresh')} 选择备份文件
                    </button>
                    <span class="form-hint">仅支持店价宝生成的 JSON 备份</span>
                </div>
                <input type="file" id="restore-file" class="file-input-hidden" accept=".json,application/json">
                <div class="preview-wrap" id="restore-preview">${restorePreviewHtml()}</div>
            </section>

            <section class="card danger-zone">
                <h2>清空本机数据</h2>
                <p class="card-desc">删除当前浏览器中的全部商品和价格历史。操作前可选择自动下载备份。</p>
                <button type="button" class="btn btn-danger-soft" data-action="clear-data" id="clear-data">
                    ${icon('trash')} 清空商品与价格历史
                </button>
            </section>
        </div>`;
}
