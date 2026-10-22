/* 店价宝 ShopPrice — lightweight camera barcode scanning with manual fallback.
 * Uses the vendored html5-qrcode library (Apache-2.0). Camera access requires
 * a secure context (https:// or localhost). Manual entry always remains available.
 */

function setScannerStatus(root, type, text) {
    const element = root ? $('#scanner-status', root) : null;
    if (!element) return;
    const iconName = type === 'error' ? 'warning' : type === 'success' ? 'check' : 'camera';
    element.className = `scanner-status ${type || ''}`;
    element.innerHTML = `${icon(iconName)}<span>${esc(text)}</span>`;
}

function friendlyCameraError(error) {
    const name = error && (error.name || error.code) ? String(error.name || error.code) : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return '摄像头权限被拒绝，请在浏览器设置中允许访问后重试';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return '没有找到可用的摄像头';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return '摄像头被其他应用占用，或系统不允许访问';
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
        return '当前设备不支持可用的摄像头模式';
    }
    if (name === 'NotSupportedError') {
        return '当前浏览器不支持摄像头扫码';
    }
    const fallback = error && error.message ? String(error.message).slice(0, 120) : '未知错误';
    return `无法启动摄像头（${fallback}）`;
}

function openScanner(context = 'global') {
    state.scan.context = context;
    state.scan.busy = false;
    state.scan.stopRequested = false;
    openModal({
        title: '扫码查价',
        size: 'modal-scanner',
        body: `
            <div class="scanner-status" id="scanner-status">${icon('camera')}<span>正在准备摄像头…</span></div>
            <div id="scanner-reader" class="scanner-reader"></div>
            <div class="scan-fallback">
                <label for="scan-manual-input">无法扫码？手动输入商品条码</label>
                <div class="manual-scan-row">
                    <input type="text" id="scan-manual-input" maxlength="64" inputmode="numeric"
                        autocomplete="off" enterkeyhint="search" placeholder="输入条码后查询">
                    <button type="button" class="btn btn-primary" id="scan-manual-btn">查询</button>
                </div>
                <p class="scan-hint">
                    摄像头扫码需通过 https 或 localhost 打开，并在首次使用时允许摄像头权限。
                    扫码只用于查询或填入条码，不会自动获取商品名称或市场售价。
                </p>
            </div>`,
        onMount(root, close) {
            const input = $('#scan-manual-input', root);
            const button = $('#scan-manual-btn', root);
            const submitManual = () => {
                const code = input ? input.value.trim() : '';
                if (!code) {
                    toast('请先输入商品条码', 'error');
                    if (input) input.focus();
                    return;
                }
                close();
                handleScannedBarcode(code, context);
            };
            if (button) button.addEventListener('click', submitManual);
            if (input) {
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        submitManual();
                    }
                });
            }
            startScanner(root, close, context);
        },
        onClose() {
            stopCamera();
        }
    });
}

async function startScanner(root, close, context) {
    if (!window.isSecureContext) {
        setScannerStatus(root, 'error', '当前页面不是安全上下文，浏览器不会开放摄像头。请使用 https:// 或 localhost 打开，或手动输入条码。');
        return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        setScannerStatus(root, 'error', '当前浏览器不支持摄像头扫码。请手动输入条码，或换用最新版 Chrome / Edge / Safari。');
        return;
    }
    if (typeof window.Html5Qrcode !== 'function') {
        setScannerStatus(root, 'error', '扫码组件未能加载。请检查 assets/vendor/html5-qrcode.min.js 是否存在，或手动输入条码。');
        return;
    }

    state.scan.starting = true;
    let scanner;
    try {
        scanner = new window.Html5Qrcode('scanner-reader', {
            verbose: false,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        });
        state.scan.instance = scanner;
        state.scan.active = true;

        await scanner.start(
            { facingMode: 'environment' },
            {
                fps: 10,
                qrbox: (viewfinderWidth, viewfinderHeight) => {
                    const width = Math.floor(Math.min(viewfinderWidth * 0.82, 300));
                    const height = Math.max(100, Math.floor(width * 0.54));
                    return {
                        width: Math.min(width, viewfinderWidth - 16),
                        height: Math.min(height, viewfinderHeight - 16)
                    };
                },
                aspectRatio: 1.6,
                disableFlip: false
            },
            async (decodedText) => {
                if (state.scan.busy) return;
                state.scan.busy = true;
                setScannerStatus(root, 'success', `已识别条码：${decodedText}`);
                await stopCamera();
                close();
                handleScannedBarcode(decodedText, context);
            },
            () => {
                // Per-frame decode errors are expected while aiming. Ignore them.
            }
        );

        state.scan.starting = false;
        if (state.scan.stopRequested) {
            await stopCamera();
            return;
        }
        if (document.contains(root)) {
            setScannerStatus(root, '', '将商品条码对准取景框，识别成功后会自动填入。');
        }
    } catch (error) {
        state.scan.starting = false;
        if (document.contains(root)) {
            setScannerStatus(root, 'error', `${friendlyCameraError(error)}。也可以使用下方手动输入。`);
        }
        await stopCamera();
    }
}

async function stopCamera() {
    state.scan.stopRequested = true;
    const scanner = state.scan.instance;
    state.scan.instance = null;
    state.scan.active = false;
    if (!scanner) return;
    try {
        await scanner.stop();
    } catch (error) {
        // The scanner may already be stopped, or may still be starting.
    }
    try {
        scanner.clear();
    } catch (error) {
        // Ignore DOM cleanup races.
    }
}

function handleScannedBarcode(rawCode, context = 'global') {
    const code = String(rawCode == null ? '' : rawCode).trim();
    if (!code) return;
    const match = findByBarcode(code);

    if (context === 'form') {
        if (state.edit.mode === 'edit') {
            const input = $('#product-barcode');
            if (input) {
                input.value = code;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.focus();
            }
            if (match && match.id !== state.edit.id) {
                toast(`该条码已属于“${match.name}”，不能重复使用`, 'error');
            } else {
                toast('已填入商品条码', 'success');
            }
            return;
        }
        if (match) {
            toast(`该条码已有商品“${match.name}”，已打开详情`, 'info');
            navigate(`/product/${encodeURIComponent(match.id)}`);
            return;
        }
        const input = $('#product-barcode');
        if (input) {
            input.value = code;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const nameInput = $('#product-name');
            if (nameInput) nameInput.focus();
        }
        toast('未找到该商品，条码已填入新增页面', 'info');
        return;
    }

    if (match) {
        toast(`已找到商品“${match.name}”`, 'success');
        navigate(`/product/${encodeURIComponent(match.id)}`);
    } else {
        toast('未找到该条码对应的商品，已进入新增页面', 'info');
        navigate(`/new?barcode=${encodeURIComponent(code)}`);
    }
}
