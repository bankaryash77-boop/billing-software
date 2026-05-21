/* ============================================================
 BillFlow Pro — Billing Software v5 (FIXED)
 Stock Architecture:
   actualStock  = from Google Sheets (source of truth)
   cartQty      = quantity in cart (per product)
   availStock   = actualStock - cartQty  (computed, UI display only)
 Sheet is ONLY updated on successful checkout (saveInvoice).

 FIXES in this version:
   1. testConnectionSilent — now also fetches customers & invoices on load
   2. showInvoice          — now sets docPayMode in the invoice modal
   3. Data Sheets nav      — now auto-syncs on click (was dead click)
   4. gstPct input         — pre-filled from defaultGst setting on load
   5. fetch — added redirect:'follow' for Apps Script 302 redirects
   6. saveInvoiceOnly      — early return fix (finally block still runs)
   7. renderInvoiceHistoryTable — print button now works for Sheets invoices too
 ============================================================ */

// ── State ──────────────────────────────────────────────────
const App = {
    state: {
        products: [],       // { id, name, price, stock (actual from sheet) }
        customers: [],
        invoices: [],
        invoiceItems: [],
        cart: [],           // { id, name, price, actualStock, qty }
        connected: false,
        settings: {
            shopName: 'FurniCraft Store',
            shopAddress: '',
            shopPhone: '',
            shopEmail: '',
            shopGstin: '',
            appUrl: '',
            sheetName: 'Billflow Products',
            logo: '',
            defaultGst: 18,
            invPrefix: 'INV-',
            invFooter: 'Thank you for your business.',
            invCounter: 10,
            cogsPct: 30
        }
    }
};

const $ = (id) => document.getElementById(id);

// ── Initialize ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    restoreCartFromStorage();
    renderBrand();
    populateSettingsForm();
    updateLiveInvId();
    // FIX 4: pre-fill GST input from saved setting
    const gstInput = document.getElementById('gstPct');
    if (gstInput) gstInput.value = App.state.settings.defaultGst || 18;
    if (App.state.settings.appUrl) {
        testConnectionSilent();
    }
    renderCart();
    initSidebar();

    // COGS preview live update
    const cogsInput = document.getElementById('setCogsPct');
    if (cogsInput) {
        cogsInput.addEventListener('input', updateCogsPreview);
    }
});

function updateLiveInvId() {
    const liveInvId = document.getElementById('liveInvId');
    if (!liveInvId) return;
    const prefix  = App.state.settings.invPrefix  || 'INV-';
    const counter = App.state.settings.invCounter || 1;
    const allIds  = new Set([
        ...App.state.invoices.map(i => i.id),
        ...(getLocalInvoices().map(i => i.id)),
    ]);
    let c = counter;
    let candidate = prefix + c;
    while (allIds.has(candidate)) { c++; candidate = prefix + c; }
    liveInvId.textContent = candidate;
}


// ── Sidebar Toggle ─────────────────────────────────────────
let _sidebarCollapsed = false;

function initSidebar() {
    try { _sidebarCollapsed = localStorage.getItem('billflow_sidebar_collapsed') === '1'; } catch(_) {}
    applySidebar();
}

function toggleSidebar() {
    _sidebarCollapsed = !_sidebarCollapsed;
    try { localStorage.setItem('billflow_sidebar_collapsed', _sidebarCollapsed ? '1' : '0'); } catch(_) {}
    applySidebar();
}

function applySidebar() {
    const sidebar = document.querySelector('.sidebar');
    const main    = document.querySelector('.main');
    const toggle  = document.getElementById('sidebarToggle');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !main) return;

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // On mobile: toggle slides sidebar in/out as overlay
        if (_sidebarCollapsed) {
            sidebar.classList.remove('mobile-open');
            if (overlay) overlay.classList.remove('show');
        } else {
            sidebar.classList.add('mobile-open');
            if (overlay) overlay.classList.add('show');
        }
        if (toggle) toggle.classList.remove('shifted');
    } else {
        // Desktop: collapse to icon-only rail
        sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('show');
        if (_sidebarCollapsed) {
            sidebar.classList.add('collapsed');
            main.classList.add('sidebar-collapsed');
            if (toggle) toggle.classList.remove('shifted');
        } else {
            sidebar.classList.remove('collapsed');
            main.classList.remove('sidebar-collapsed');
            if (toggle) toggle.classList.add('shifted');
        }
    }
}

// ── COGS Preview ───────────────────────────────────────────
function updateCogsPreview() {
    const v = parseFloat(document.getElementById('setCogsPct')?.value) || 0;
    const margin = (100 - v).toFixed(1);
    const pp = document.getElementById('cogsPreviewPct');
    const pm = document.getElementById('cogsPreviewMargin');
    if (pp) pp.textContent = v;
    if (pm) pm.textContent = margin;
}

// ── Payment Mode Change (New Invoice) ─────────────────────
function onPaymentModeChange() {
    const mode = document.getElementById('inpPaymentMode')?.value;
    const row  = document.getElementById('creditMinPayRow');
    if (row) row.classList.toggle('hidden', mode !== 'Credit');
}


function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    $(`page-${page}`).classList.add('active');
    const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');
}

// ── Tab Switching ──────────────────────────────────────────
function switchTab(btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, type = 'info') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.classList.add('hidden'); }, 3500);
}

// ── Settings Persistence ──────────────────────────────────
function loadSettings() {
    try {
        const saved = localStorage.getItem('billflow_settings');
        if (saved) {
            const parsed = JSON.parse(saved);
            App.state.settings = { ...App.state.settings, ...parsed };
        }
    } catch (e) {
        console.warn('Failed to load settings:', e);
    }
}

function saveSettingsToStorage() {
    try {
        localStorage.setItem('billflow_settings', JSON.stringify(App.state.settings));
        showToast('Settings saved!', 'success');
    } catch (e) {
        showToast('Failed to save settings', 'error');
    }
}

function saveSettings() {
    App.state.settings.shopName    = $('setShopName').value.trim()  || App.state.settings.shopName;
    App.state.settings.shopAddress = $('setShopAddr').value.trim();
    App.state.settings.shopPhone   = $('setShopPhone').value.trim();
    App.state.settings.shopEmail   = $('setShopEmail').value.trim();
    App.state.settings.shopGstin   = $('setShopGstin').value.trim();
    App.state.settings.appUrl      = $('setAppUrl').value.trim().replace(/\/$/, '');
    App.state.settings.sheetName   = $('setSheetName').value.trim() || 'Billflow Products';
    App.state.settings.defaultGst  = parseInt($('setDefGst').value) || 18;
    App.state.settings.invPrefix   = $('setInvPrefix').value.trim() || 'INV-';
    App.state.settings.invFooter   = $('setInvFooter').value.trim();
    if ($('setInvCounter')) {
        App.state.settings.invCounter = parseInt($('setInvCounter').value) || 10;
    }
    if ($('setCogsPct')) {
        App.state.settings.cogsPct = parseFloat($('setCogsPct').value) || 30;
        App.filter.cogsPct = App.state.settings.cogsPct / 100;
    }
    saveThermalSettings();
    saveSettingsToStorage();
    renderBrand();
    updateLiveInvId();
    updateCogsPreview();
    // FIX 4: also update live GST input when settings are saved
    const gstInput = document.getElementById('gstPct');
    if (gstInput && !App.state.cart.length) gstInput.value = App.state.settings.defaultGst || 18;
}

function populateSettingsForm() {
    const s = App.state.settings;
    $('setShopName').value  = s.shopName;
    $('setShopAddr').value  = s.shopAddress;
    $('setShopPhone').value = s.shopPhone;
    $('setShopEmail').value = s.shopEmail;
    $('setShopGstin').value = s.shopGstin;
    $('setAppUrl').value    = s.appUrl;
    $('setSheetName').value = s.sheetName;
    $('setDefGst').value    = s.defaultGst;
    $('setInvPrefix').value = s.invPrefix;
    $('setInvFooter').value = s.invFooter;
    if ($('setInvCounter')) $('setInvCounter').value = s.invCounter || 10;
    if ($('setCogsPct'))    $('setCogsPct').value    = s.cogsPct    || 30;

    // Bill type
    populateBillTypeSettings();

    App.filter.cogsPct = (s.cogsPct || 30) / 100;
    updateCogsPreview();

    if (s.logo) {
        $('logoImg').src = s.logo;
        $('logoImg').style.display = 'block';
        $('logoFallback').style.display = 'none';
    }
}

function safeSet(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function renderBrand() {
    const s = App.state.settings;
    safeSet('brandName',    s.shopName    || '');
    safeSet('docShopName',  s.shopName    || '');
    safeSet('docShopAddr',  s.shopAddress || '');
    safeSet('docShopPhone', s.shopPhone   ? 'Phone: ' + s.shopPhone : '');
    safeSet('docShopEmail', s.shopEmail   ? 'Email: ' + s.shopEmail : '');
    safeSet('docShopGstin', s.shopGstin   ? 'GSTIN: ' + s.shopGstin : '');

    if (s.logo) {
        const bl = document.getElementById('brandLogo');
        if (bl) { bl.innerHTML = '<img src="' + s.logo + '" alt="Logo">'; bl.style.background = 'none'; }
        const dl = document.getElementById('docLogo');
        if (dl) { dl.src = s.logo; dl.style.display = 'block'; }
        const dp = document.getElementById('docLogoPlaceholder');
        if (dp) dp.style.display = 'none';
    } else {
        const bl = document.getElementById('brandLogo');
        if (bl) { bl.innerHTML = '<svg width="22" height="22" style="color:var(--accent)"><use href="#ico-receipt"/></svg>'; bl.style.background = 'var(--accent-soft)'; }
        const dl = document.getElementById('docLogo');
        if (dl) dl.style.display = 'none';
        const dp = document.getElementById('docLogoPlaceholder');
        if (dp) dp.style.display = 'flex';
    }
}

// ── Logo Upload ────────────────────────────────────────────
function uploadLogo(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('File too large. Max 2MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        App.state.settings.logo = e.target.result;
        saveSettingsToStorage();
        renderBrand();
        var li = document.getElementById('logoImg');
        var lf = document.getElementById('logoFallback');
        if (li) { li.src = e.target.result; li.style.display = 'block'; }
        if (lf) lf.style.display = 'none';
        showToast('Logo uploaded!', 'success');
    };
    reader.readAsDataURL(file);
}

function removeLogo() {
    App.state.settings.logo = '';
    saveSettingsToStorage();
    renderBrand();
    var li = document.getElementById('logoImg');
    var lf = document.getElementById('logoFallback');
    var inp = document.getElementById('logoInput');
    if (li) li.style.display = 'none';
    if (lf) lf.style.display = 'block';
    if (inp) inp.value = '';
    showToast('Logo removed', 'info');
}

// ── API Layer ─────────────────────────────────────────────
async function apiCall(action, payload = null) {
    const url = App.state.settings.appUrl;
    if (!url) throw new Error('Apps Script URL not configured. Go to Settings.');
    let fullUrl = `${url}?action=${action}`;
    if (payload !== null) {
        fullUrl += `&payload=${encodeURIComponent(JSON.stringify(payload))}`;
    }
    // FIX 5: Apps Script redirects (302) require redirect:'follow' to get the final JSON
    const res = await fetch(fullUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

// ── Connection ─────────────────────────────────────────────
function updateConnStatus(connected) {
    App.state.connected = connected;
    const dot     = document.querySelector('.conn-dot');
    const text    = document.querySelector('.conn-text');
    const discBtn = $('disconnectBtn');
    const syncBtn = $('syncBtn');
    if (connected) {
        dot.className  = 'conn-dot connected';
        text.textContent = 'Connected';
        if (discBtn) discBtn.classList.remove('hidden');
        if (syncBtn) syncBtn.classList.add('hidden');
    } else {
        dot.className  = 'conn-dot disconnected';
        text.textContent = 'Not Connected';
        if (discBtn) discBtn.classList.add('hidden');
        if (syncBtn) syncBtn.classList.remove('hidden');
    }
}

function disconnect() {
    App.state.connected = false;
    App.state.settings.appUrl = '';
    App.state.products  = [];
    App.state.customers = [];
    App.state.invoices  = [];
    App.state.invoiceItems = [];
    saveSettingsToStorage();
    populateSettingsForm();
    updateConnStatus(false);
    // Clear cached invoice data so stale data never shows after disconnect
    try { localStorage.removeItem('billflow_invoices_local'); } catch(_) {}
    updateStats();
    filterInvoiceHistory();
    refreshAccounts();
    renderProducts();
    showToast('Disconnected. All local data cleared.', 'info');
}

// FIX 1: Silent connection test now fetches ALL data (products + customers + invoices)
// so that customer autocomplete and invoice history work immediately on load
async function testConnectionSilent() {
    try {
        const [prodData, custData, invData] = await Promise.all([
            apiCall('getProducts'),
            apiCall('getCustomers'),
            apiCall('getInvoices'),
        ]);
        App.state.products      = prodData.products  || [];
        App.state.customers     = custData.customers || [];
        App.state.invoices      = invData.invoices   || [];
        App.state.invoiceItems  = invData.items      || [];

        // Remove from localStorage any invoice now confirmed in Sheets
        const sheetsIds = new Set(App.state.invoices.map(i => i.id));
        const unsyncedLocal = getLocalInvoices().filter(li => !sheetsIds.has(li.id));
        saveLocalInvoices(unsyncedLocal);

        updateConnStatus(true);
        renderProducts();
        renderDataTable('products');
        renderDataTable('invoices');
        renderDataTable('customers');
        renderDataTable('items');
        updateStats();
        filterInvoiceHistory();
        refreshAccounts();
        updateLiveInvId();
    } catch (_) { /* silent — user hasn't configured URL yet */ }
}

async function testConnection() {
    const btn    = $('testBtn');
    const spin   = $('testSpin');
    const result = $('testResult');
    btn.disabled = true;
    spin.classList.remove('hidden');
    result.classList.add('hidden');

    try {
        App.state.settings.appUrl = $('setAppUrl').value.trim().replace(/\/$/, '');
        saveSettingsToStorage();
        const data = await apiCall('getProducts');
        App.state.products = data.products || [];
        updateConnStatus(true);
        result.textContent = `✅ Connected! Found ${App.state.products.length} products.`;
        result.className   = 'result-box success';
        result.classList.remove('hidden');
        renderProducts();
        showToast('Connection successful!', 'success');
        // Also fetch rest of data after successful test
        fetchData('getCustomers');
        fetchData('getInvoices');
    } catch (err) {
        updateConnStatus(false);
        result.textContent = `❌ ${err.message}`;
        result.className   = 'result-box error';
        result.classList.remove('hidden');
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        spin.classList.add('hidden');
    }
}

// ── Fetch Data ─────────────────────────────────────────────
async function fetchData(action) {
    try {
        const data = await apiCall(action);
        if (action === 'getProducts') {
            App.state.products = data.products || [];
            renderProducts();
            renderDataTable('products');
            updateStats();
        } else if (action === 'getCustomers') {
            App.state.customers = data.customers || [];
            renderDataTable('customers');
            updateStats();
        } else if (action === 'getInvoices') {
            App.state.invoices      = data.invoices || [];
            App.state.invoiceItems  = data.items    || [];
            // Clean localStorage: remove any invoice that is now confirmed in Sheets
            const sheetsIds = new Set(App.state.invoices.map(i => i.id));
            const local     = getLocalInvoices().filter(li => !sheetsIds.has(li.id));
            saveLocalInvoices(local);
            filterInvoiceHistory();
            refreshAccounts();
            renderDataTable('invoices');
            renderDataTable('items');
            updateStats();
            refreshAccounts();
            filterInvoiceHistory();
        }
        showToast('Data synced', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function syncAllData() {
    const spin = $('syncSpin');
    if (spin) spin.classList.remove('hidden');
    try {
        const [prodData, custData, invData] = await Promise.all([
            apiCall('getProducts'),
            apiCall('getCustomers'),
            apiCall('getInvoices'),
        ]);
        App.state.products     = prodData.products  || [];
        App.state.customers    = custData.customers || [];
        App.state.invoices     = invData.invoices   || [];
        App.state.invoiceItems = invData.items      || [];

        // Clean localStorage — remove anything now in Sheets
        const sheetsIds = new Set(App.state.invoices.map(i => i.id));
        saveLocalInvoices(getLocalInvoices().filter(li => !sheetsIds.has(li.id)));

        updateConnStatus(true);
        renderProducts();
        renderDataTable('products');
        renderDataTable('invoices');
        renderDataTable('customers');
        renderDataTable('items');
        updateStats();
        filterInvoiceHistory();
        refreshAccounts();
        updateLiveInvId();
        showToast('Data refreshed from Sheets!', 'success');
    } catch (err) {
        showToast('Sync failed: ' + err.message, 'error');
    } finally {
        if (spin) spin.classList.add('hidden');
    }
}

// ── Customer Auto-fill ────────────────────────────────────
function onCustNameInput() {
    const q = $('inpCustName').value.toLowerCase().trim();
    const dd = $('custDropdown');
    const badge = $('custAutofillBadge');
    badge.classList.add('hidden');
    
    if (!q) { dd.classList.add('hidden'); return; }
    if (!App.state.customers || !App.state.customers.length) return;
    
    const matches = App.state.customers.filter(c => (c.name || '').toLowerCase().includes(q));
    if (!matches.length) { dd.classList.add('hidden'); return; }
    
    dd.innerHTML = matches.map(c => `
        <div class="cust-dropdown-item" onclick="selectCustomer('${c.id}')">
            <strong>${esc(c.name)}</strong>
            <span style="font-size:11px;color:var(--text-muted)">${esc(c.phone || '')}</span>
        </div>
    `).join('');
    dd.classList.remove('hidden');
}

function onCustPhoneInput() {
    const q = $('inpCustPhone').value.trim();
    if (!q || !App.state.customers) return;
    const match = App.state.customers.find(c => c.phone === q);
    if (match) selectCustomer(match.id);
}

function selectCustomer(id) {
    const c = App.state.customers.find(x => x.id === id);
    if (!c) return;
    $('inpCustName').value = c.name || '';
    $('inpCustPhone').value = c.phone || '';
    $('inpCustEmail').value = c.email || '';
    $('inpCustGstin').value = c.gstin || '';
    $('inpCustAddress').value = c.address || '';
    $('custDropdown').classList.add('hidden');
    $('custAutofillBadge').classList.remove('hidden');
}

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dd = $('custDropdown');
    const wrap = document.querySelector('.autocomplete-wrap');
    if (dd && wrap && !wrap.contains(e.target)) {
        dd.classList.add('hidden');
    }
});

// ══════════════════════════════════════════════════════════
// STOCK MANAGEMENT — Core Logic
// ══════════════════════════════════════════════════════════

function availableStock(productId) {
    const prod    = App.state.products.find(p => p.id === productId);
    const inCart  = App.state.cart.find(c => c.id === productId);
    const actual  = prod ? (prod.stock || 0) : 0;
    const inCart_ = inCart ? inCart.qty : 0;
    return Math.max(0, actual - inCart_);
}

function cartQty(productId) {
    const item = App.state.cart.find(c => c.id === productId);
    return item ? item.qty : 0;
}

// ── Cart Operations ────────────────────────────────────────
function addToCart(prodId) {
    const prod = App.state.products.find(p => p.id === prodId);
    if (!prod) { showToast('Product not found', 'error'); return; }

    const avail = availableStock(prodId);
    if (avail <= 0) { showToast('Out of stock', 'error'); return; }

    const existing = App.state.cart.find(c => c.id === prodId);
    if (existing) {
        existing.qty++;
    } else {
        App.state.cart.push({
            id:          prod.id,
            name:        prod.name,
            price:       prod.price,
            actualStock: prod.stock,
            qty:         1
        });
    }

    saveCartToStorage();
    renderCart();
    renderProducts();
    showToast(`Added: ${prod.name}`, 'success');
}

function changeQty(idx, delta) {
    const item = App.state.cart[idx];
    if (!item) return;

    const newQty = item.qty + delta;

    if (newQty <= 0) {
        removeFromCart(idx);
        return;
    }

    if (delta > 0) {
        // availableStock = total stock MINUS current cart qty
        // So if avail > 0, we can add one more
        const avail = availableStock(item.id);
        if (avail <= 0) {
            const prod = App.state.products.find(p => p.id === item.id);
            const total = prod ? prod.stock : (item.actualStock || 0);
            showToast(`Only ${total} in stock — already in cart: ${item.qty}`, 'error');
            return;
        }
    }

    item.qty = newQty;
    saveCartToStorage();
    renderCart();
    renderProducts();
}

function removeFromCart(idx) {
    const removed = App.state.cart[idx];
    if (!removed) return;
    App.state.cart.splice(idx, 1);
    saveCartToStorage();
    renderCart();
    renderProducts();
    showToast(`Removed: ${removed.name}`, 'info');
}

function clearCart() {
    if (!App.state.cart.length) return;
    App.state.cart = [];
    saveCartToStorage();
    renderCart();
    renderProducts();
    showToast('Cart cleared', 'info');
}

// ── Cart Persistence (localStorage) ───────────────────────
function saveCartToStorage() {
    try {
        localStorage.setItem('billflow_cart', JSON.stringify(App.state.cart));
    } catch (_) {}
}

function restoreCartFromStorage() {
    try {
        const saved = localStorage.getItem('billflow_cart');
        if (saved) {
            App.state.cart = JSON.parse(saved) || [];
        }
    } catch (_) {
        App.state.cart = [];
    }
}

// ── Rendering ──────────────────────────────────────────────
function renderProducts() {
    const tbody = $('prodSelectBody');
    if (!App.state.products.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Connect to Google Sheets to load products</td></tr>`;
        $('prodCountBadge').textContent = '0 products';
        return;
    }

    const q        = ($('prodSearch').value || '').toLowerCase();
    const filtered = App.state.products.filter(p =>
        p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );

    $('prodCountBadge').textContent = `${filtered.length} products`;

    tbody.innerHTML = filtered.map(p => {
        const avail   = availableStock(p.id);
        const inCart_ = cartQty(p.id);
        const statusClass = avail > 5 ? 'stock-ok' : avail > 0 ? 'stock-low' : 'stock-out';
        return `
        <tr class="${avail <= 0 ? 'row-out' : ''}">
          <td class="mono">${esc(p.id)}</td>
          <td><strong>${esc(p.name)}</strong></td>
          <td class="price-cell">₹${num(p.price)}</td>
          <td>
            <div class="stock-info">
              <span class="stock-badge ${statusClass}">${avail}</span>
              ${inCart_ > 0 ? `<span class="cart-hint">−${inCart_} in cart</span>` : ''}
            </div>
          </td>
          <td>
            <button class="btn-add ${avail <= 0 ? 'btn-out' : ''}"
                    onclick="addToCart('${esc(p.id)}')"
                    ${avail <= 0 ? 'disabled' : ''}>
              ${avail > 0 ? '+ Add' : 'Out'}
            </button>
          </td>
        </tr>`;
    }).join('');
}

function filterProducts() { renderProducts(); }

function renderCart() {
    const list   = $('cartItemsList');
    const empty  = $('cartEmpty');
    const totals = $('cartTotals');
    const badge  = $('cartCountBadge');

    if (!App.state.cart.length) {
        empty.classList.remove('hidden');
        list.classList.add('hidden');
        totals.classList.add('hidden');
        badge.textContent = '0 items';
        return;
    }

    empty.classList.add('hidden');
    list.classList.remove('hidden');
    totals.classList.remove('hidden');

    const totalItems = App.state.cart.reduce((s, i) => s + i.qty, 0);
    badge.textContent = `${totalItems} item${totalItems !== 1 ? 's' : ''}`;

    list.innerHTML = App.state.cart.map((item, idx) => {
        const avail  = availableStock(item.id);   // remaining stock AFTER this cart qty
        const canInc = avail > 0;
        const prod   = App.state.products.find(p => p.id === item.id);
        const total  = prod ? prod.stock : (item.actualStock || 0);
        return `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-name">${esc(item.name)}</div>
            <div class="cart-item-price">₹${num(item.price)} each &nbsp;·&nbsp; <span style="font-size:11px;color:${avail > 0 ? 'var(--text-muted)' : 'var(--danger)'};">${avail} left</span></div>
          </div>
          <div class="cart-item-qty">
            <button class="qty-btn" onclick="changeQty(${idx}, -1)">−</button>
            <span class="qty-display">${item.qty}</span>
            <button class="qty-btn" onclick="changeQty(${idx}, 1)" ${!canInc ? 'disabled title="No more stock"' : ''}>+</button>
          </div>
          <div class="cart-item-total">₹${num(item.price * item.qty)}</div>
          <button class="cart-remove" onclick="removeFromCart(${idx})" title="Remove">✕</button>
        </div>`;
    }).join('');

    calcTotals();
}

function calcTotals() {
    const sub     = App.state.cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const discPct = parseFloat($('discPct').value) || 0;
    const gstPct  = parseFloat($('gstPct').value)  || 0;
    const discAmt = sub * (discPct / 100);
    const taxable = Math.max(0, sub - discAmt);
    const gstAmt  = taxable * (gstPct / 100);
    const total   = taxable + gstAmt;

    $('cartSub').textContent   = `₹${num(sub)}`;
    $('cartDisc').textContent  = `-₹${num(discAmt)} (${discPct}%)`;
    $('cartGst').textContent   = `₹${num(gstAmt)}`;
    $('cartGrand').textContent = `₹${num(total)}`;

    return { sub, discPct, discAmt, taxable, gstPct, gstAmt, total };
}

function renderDataTable(type) {
    let html = '';
    if (type === 'products') {
        html = App.state.products.map(p => `
        <tr>
          <td class="mono">${esc(p.id)}</td>
          <td><strong>${esc(p.name)}</strong></td>
          <td>₹${num(p.price)}</td>
          <td>${p.stock}</td>
          <td><span class="stock-badge ${p.stock > 5 ? 'stock-ok' : p.stock > 0 ? 'stock-low' : 'stock-out'}">${p.stock > 5 ? 'In Stock' : p.stock > 0 ? 'Low' : 'Out'}</span></td>
          <td>
             <div style="display:flex;gap:6px;">
                 <button class="prod-action-btn" onclick="openProductModal('${esc(p.id)}')"><svg width="14" height="14"><use href="#ico-edit"/></svg></button>
                 <button class="prod-action-btn" style="color:var(--danger)" onclick="deleteProduct('${esc(p.id)}')"><svg width="14" height="14"><use href="#ico-trash"/></svg></button>
             </div>
          </td>
        </tr>`).join('');
        $('tblProducts').innerHTML = html || '<tr><td colspan="6" class="empty-row">No data</td></tr>';
    } else if (type === 'invoices') {
        html = App.state.invoices.map(i => `
        <tr>
          <td class="mono" style="color:var(--accent);font-weight:700">${esc(i.id)}</td>
          <td>${esc(i.customer)}</td>
          <td>${esc(i.phone || '—')}</td>
          <td><strong>₹${num(i.total)}</strong></td>
          <td>${esc(i.date || '—')}</td>
        </tr>`).join('');
        $('tblInvoices').innerHTML = html || '<tr><td colspan="5" class="empty-row">No data</td></tr>';
    } else if (type === 'customers') {
        html = App.state.customers.map(c => `
        <tr>
          <td class="mono">${esc(c.id)}</td>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${esc(c.phone || '—')}</td>
          <td>${esc(c.email || '—')}</td>
          <td>${esc(c.gstin || '—')}</td>
        </tr>`).join('');
        $('tblCustomers').innerHTML = html || '<tr><td colspan="5" class="empty-row">No data</td></tr>';
    } else if (type === 'items') {
        html = App.state.invoiceItems.map(it => `
        <tr>
          <td class="mono">${esc(it.invoiceId)}</td>
          <td>${esc(it.productName)}</td>
          <td>${it.quantity}</td>
          <td>₹${num(it.unitPrice)}</td>
          <td><strong>₹${num(it.subtotal)}</strong></td>
        </tr>`).join('');
        $('tblItems').innerHTML = html || '<tr><td colspan="5" class="empty-row">No data</td></tr>';
    }
}

function updateStats() {
    // Only show stats when connected — never show stale localStorage counts
    if (!App.state.connected) {
        $('statProd').textContent = '—';
        $('statInv').textContent  = '—';
        $('statCust').textContent = '—';
        $('statRev').textContent  = '₹0';
        return;
    }
    const totalRev = App.state.invoices.reduce((s, i) => s + (i.total || 0), 0);
    $('statProd').textContent = App.state.products.length;
    $('statInv').textContent  = App.state.invoices.length;
    $('statCust').textContent = App.state.customers.length;
    $('statRev').textContent  = `₹${totalRev > 1000 ? (totalRev / 1000).toFixed(1) + 'K' : num(totalRev)}`;
}

// ── Get next invoice ID — guaranteed not to collide ────────
function getNextInvoiceId() {
    const prefix  = App.state.settings.invPrefix || 'INV-';
    let   counter = App.state.settings.invCounter || 1;

    // Collect all known IDs (Sheets + local)
    const allIds = new Set([
        ...App.state.invoices.map(i => i.id),
        ...getLocalInvoices().map(i => i.id),
    ]);

    // Walk forward until we find a free slot
    let candidate = prefix + counter;
    while (allIds.has(candidate)) {
        counter++;
        candidate = prefix + counter;
    }

    // Keep settings in sync if we had to skip ahead
    if (counter !== App.state.settings.invCounter) {
        App.state.settings.invCounter = counter;
        saveSettingsToStorage();
        updateLiveInvId();
    }

    return candidate;
}



function buildInvoiceObject() {
    const now    = new Date();
    const invNum = getNextInvoiceId();   // collision-safe
    const { sub, discPct, discAmt, gstPct, gstAmt, total } = calcTotals();

    const payMode = document.getElementById('inpPaymentMode') ? document.getElementById('inpPaymentMode').value : 'Cash';
    const payRef  = document.getElementById('inpPayRef') ? document.getElementById('inpPayRef').value.trim() : '';
    const isCredit = payMode === 'Credit';

    // Credit: use min payment field if provided
    let amtPaid = total;
    let payStatus = 'Paid';
    if (isCredit) {
        const minAmt = parseFloat(document.getElementById('inpMinAmtPaid')?.value) || 0;
        amtPaid = Math.min(minAmt, total);
        if (amtPaid <= 0)        payStatus = 'Pending';
        else if (amtPaid < total) payStatus = 'Partial';
        else                      payStatus = 'Paid';
    }

    return {
        id:           invNum,
        customer:     $('inpCustName').value.trim(),
        phone:        $('inpCustPhone').value.trim(),
        email:        $('inpCustEmail').value.trim(),
        address:      $('inpCustAddress').value.trim(),
        gstin:        $('inpCustGstin').value.trim(),
        subtotal:     sub,
        discount:     discAmt,
        discPct:      discPct,
        gstRate:      gstPct,
        gst:          gstAmt,
        total:        total,
        paymentMode:  payMode,
        paymentRef:   payRef,
        amountPaid:   amtPaid,
        paymentStatus: payStatus,
        notes:        '',
        date:         now.toISOString().split('T')[0],
        time:         now.toTimeString().slice(0, 8),
        items:        App.state.cart.map(i => ({
            id:       i.id,
            name:     i.name,
            qty:      i.qty,
            price:    i.price,
            subtotal: i.price * i.qty
        }))
    };
}

function validateForm() {
    const name   = $('inpCustName').value.trim();
    const phone  = $('inpCustPhone').value.trim();
    const email  = $('inpCustEmail').value.trim();
    const errBox = $('custErrors');
    let errs = [];

    if (!name) errs.push('Customer name is required.');
    if (phone && !/^[0-9+\s\-]{8,20}$/.test(phone)) errs.push('Enter a valid phone number.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('Enter a valid email address.');
    if (!App.state.cart.length) errs.push('Cart is empty. Add products first.');

    if (errs.length) {
        errBox.innerHTML = errs.map(e => `<p><svg width="12" height="12" style="margin-right:4px;"><use href="#ico-info"/></svg>${e}</p>`).join('');
        errBox.classList.remove('hidden');
        return false;
    }
    errBox.classList.add('hidden');
    return true;
}

// FIX 6: moved early-return inside try block so finally always runs
async function saveInvoiceOnly() {
    if (!validateForm()) return;

    const btn  = $('saveBtn');
    const spin = $('saveSpin');
    btn.disabled = true;
    spin.classList.remove('hidden');

    try {
        if (!App.state.settings.appUrl || !App.state.connected) {
            showToast('Not connected to Sheets. Save failed.', 'error');
            return;
        }

        const inv = buildInvoiceObject();
        inv.skipStockDeduct = false;

        const res = await apiCall('saveInvoice', inv);
        if (res.error) throw new Error(res.error);

        // Update local stock to reflect deduction
        App.state.cart.forEach(cartItem => {
            const prod = App.state.products.find(p => p.id === cartItem.id);
            if (prod) {
                prod.stock = Math.max(0, prod.stock - cartItem.qty);
            }
        });

        saveInvoiceLocally(inv);

        // Increment counter
        App.state.settings.invCounter = (App.state.settings.invCounter || 1) + 1;
        getNextInvoiceId();
        saveSettingsToStorage();

        showToast(`Invoice ${inv.id} saved!`, 'success');
        clearCartAfterCheckout();
        resetCustomerForm();

        // ── CRITICAL: refresh from Sheets so all pages show live data ──
        try {
            await fetchData('getInvoices');
            await fetchData('getProducts');
        } catch(_) {}

        updateLiveInvId();
        renderProducts();
        filterInvoiceHistory();
        refreshAccounts();

    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        spin.classList.add('hidden');
    }
}

function clearCartAfterCheckout() {
    App.state.cart = [];
    saveCartToStorage();
    renderCart();
}

function printInvoiceDirect() {
    if (!validateForm()) return;
    const inv = buildInvoiceObject();
    showInvoice(inv);
}

// ── Invoice Display ────────────────────────────────────────
// FIX 2: now sets docPayMode in the invoice document
function showInvoice(inv) {
    if (!inv) { showToast('Invoice data not found', 'error'); return; }
    const s = App.state.settings;

    // Logo
    const logoImg         = $('docLogo');
    const logoPlaceholder = $('docLogoPlaceholder');
    if (s.logo) {
        if (logoImg) { logoImg.src = s.logo; logoImg.style.display = 'block'; }
        if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    } else {
        if (logoImg) logoImg.style.display = 'none';
        if (logoPlaceholder) logoPlaceholder.style.display = 'flex';
    }

    // Header fields
    const fmtd = fmtDate(inv.date);
    $('docInvNum').textContent  = inv.id;
    $('docInvDate').textContent = fmtd;
    $('docDueDate').textContent = fmtd;

    const docPayMode = document.getElementById('docPayMode');
    if (docPayMode) docPayMode.textContent = inv.paymentMode || 'Cash';

    $('docCustName').textContent = inv.customer || 'Walk-in Customer';
    $('docCustAddr').textContent = [inv.phone, inv.address, inv.gstin ? 'GSTIN: ' + inv.gstin : '']
        .filter(Boolean).join(' | ');

    // Items — no hardcoded "—" in description
    $('docItems').innerHTML = (inv.items || []).map(it => `
        <tr>
          <td class="col-product" style="font-weight:600;">${esc(it.name)}</td>
          <td class="col-desc" style="color:#9ca3af;">${esc(it.description || it.desc || '')}</td>
          <td class="col-qty">${it.qty}</td>
          <td class="col-rate">₹${num(it.price)}</td>
          <td class="col-amount text-right" style="font-weight:700;">₹${num((it.subtotal != null ? it.subtotal : it.price * it.qty))}</td>
        </tr>`).join('');

    // Totals — recalculate if values look wrong
    const sub     = inv.subtotal != null ? inv.subtotal : (inv.items || []).reduce((s,i) => s + i.price * i.qty, 0);
    const discAmt = inv.discount || 0;
    const gstAmt  = inv.gst     || 0;
    const total   = inv.total   != null ? inv.total : (sub - discAmt + gstAmt);

    $('docSub').textContent     = '₹' + num(sub);
    $('docDiscPct').textContent = inv.discPct || 0;
    $('docDisc').textContent    = '-₹' + num(discAmt);
    $('docGstPct').textContent  = inv.gstRate || 0;
    $('docGst').textContent     = '₹' + num(gstAmt);
    $('docGrand').textContent   = '₹' + num(total);

    // Payment status line below total
    const payStatusEl = document.getElementById('docPayStatus');
    if (payStatusEl) {
        const balance = Math.max(0, total - (inv.amountPaid != null ? inv.amountPaid : total));
        if (inv.paymentStatus === 'Partial') {
            payStatusEl.innerHTML = `<span style="color:#f59e0b;font-weight:600;">Partial — Paid ₹${num(inv.amountPaid)} · Due ₹${num(balance)}</span>`;
            payStatusEl.style.display = 'flex';
        } else if (inv.paymentStatus === 'Pending') {
            payStatusEl.innerHTML = `<span style="color:#ef4444;font-weight:600;">Unpaid — Balance Due ₹${num(balance)}</span>`;
            payStatusEl.style.display = 'flex';
        } else {
            payStatusEl.style.display = 'none';
        }
    }

    const discRow = document.querySelector('.doc-disc-line');
    if (discRow) discRow.style.display = discAmt > 0 ? 'flex' : 'none';

    // Dynamic footer — from settings
    const msgEl = document.getElementById('docCustomerMsg');
    if (msgEl) msgEl.textContent = inv.notes || s.invFooter || 'Thank you for your purchase!';

    // Shop details in footer
    const shopFooterEl = document.getElementById('docShopFooter');
    if (shopFooterEl) {
        shopFooterEl.innerHTML = [
            s.shopName    ? `<strong>${esc(s.shopName)}</strong>` : '',
            s.shopPhone   ? `📞 ${esc(s.shopPhone)}`  : '',
            s.shopEmail   ? `✉ ${esc(s.shopEmail)}`   : '',
            s.shopAddress ? esc(s.shopAddress)         : '',
            s.shopGstin   ? `GSTIN: ${esc(s.shopGstin)}` : '',
        ].filter(Boolean).join('&nbsp;&nbsp;·&nbsp;&nbsp;');
    }

    // Switch between A4 and thermal layout based on settings
    showInvoiceInCorrectFormat(inv);

    $('invoiceModal').classList.add('show');
}

function closeInvoice() { $('invoiceModal').classList.remove('show'); }

function downloadInvoicePDF() {
    showToast('Use Print → Save as PDF for best results', 'info');
    window.print();
}

function resetCustomerForm() {
    $('inpCustName').value    = '';
    $('inpCustPhone').value   = '';
    $('inpCustEmail').value   = '';
    $('inpCustGstin').value   = '';
    $('inpCustAddress').value = '';
    const pm = document.getElementById('inpPaymentMode');
    const pr = document.getElementById('inpPayRef');
    const mp = document.getElementById('inpMinAmtPaid');
    const mr = document.getElementById('creditMinPayRow');
    if (pm) pm.value = 'Cash';
    if (pr) pr.value = '';
    if (mp) mp.value = '';
    if (mr) mr.classList.add('hidden');
}

// ── Utilities ──────────────────────────────────────────────
function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function num(n) {
    return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ══════════════════════════════════════════════════════════
// LOCAL INVOICE STORE (localStorage)
// ══════════════════════════════════════════════════════════

function getLocalInvoices() {
    // Only return local invoices if currently connected to Sheets.
    // This prevents stale data from a previous session appearing
    // when the user hasn't connected yet.
    if (!App.state.connected) return [];
    try {
        const saved = localStorage.getItem('billflow_invoices_local');
        return saved ? JSON.parse(saved) : [];
    } catch (_) { return []; }
}

function saveLocalInvoices(invoices) {
    try {
        localStorage.setItem('billflow_invoices_local', JSON.stringify(invoices));
    } catch (_) {}
}

function saveInvoiceLocally(inv) {
    const invoices = getLocalInvoices();
    const idx = invoices.findIndex(i => i.id === inv.id);
    if (idx >= 0) { invoices[idx] = inv; }
    else { invoices.unshift(inv); }
    saveLocalInvoices(invoices);
}

// ── Helper: get invoice from local store OR Sheets state ──
function findInvoice(invId) {
    // Sheets data is authoritative — check it first
    const sheetsInv = App.state.invoices.find(i => i.id === invId);
    if (sheetsInv) {
        // Enrich with items from local if Sheets version has no items
        if (!sheetsInv.items || !sheetsInv.items.length) {
            const local = getLocalInvoices().find(i => i.id === invId);
            if (local && local.items && local.items.length) {
                sheetsInv.items = local.items;
            } else {
                // Try invoiceItems state
                sheetsInv.items = App.state.invoiceItems
                    .filter(it => it.invoiceId === invId)
                    .map(it => ({
                        id:       it.productId,
                        name:     it.productName,
                        qty:      it.quantity,
                        price:    it.unitPrice,
                        subtotal: it.subtotal
                    }));
            }
        }
        return sheetsInv;
    }
    // Not in Sheets yet — check localStorage (unsaved invoice)
    return getLocalInvoices().find(i => i.id === invId) || null;
}

// ══════════════════════════════════════════════════════════
// INVOICE HISTORY PAGE
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// PERIOD FILTER STATE
// ══════════════════════════════════════════════════════════

App.filter = {
    period: 'all',   // 'daily' | 'monthly' | 'all'
    dateFrom: '',
    dateTo: '',
    showProfit: true,
    cogsPct: 0.30,   // assumed cost of goods — 30%
};

// Set period from toggle buttons and update date inputs
function setPeriod(period, btn) {
    App.filter.period = period;
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const today = new Date();
    const fmt   = d => d.toISOString().split('T')[0];

    if (period === 'daily') {
        App.filter.dateFrom = App.filter.dateTo = fmt(today);
    } else if (period === 'monthly') {
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        App.filter.dateFrom = fmt(first);
        App.filter.dateTo   = fmt(today);
    } else {
        App.filter.dateFrom = '';
        App.filter.dateTo   = '';
    }

    // Sync both date pickers
    ['invDateFrom', 'accDateFrom'].forEach(id => {
        const el = $(id); if (el) el.value = App.filter.dateFrom;
    });
    ['invDateTo', 'accDateTo'].forEach(id => {
        const el = $(id); if (el) el.value = App.filter.dateTo;
    });

    filterInvoiceHistory();
    refreshAccounts();
}

// When user manually changes date inputs
function applyDateFilter() {
    App.filter.dateFrom = ($('invDateFrom') || $('accDateFrom') || {}).value || '';
    App.filter.dateTo   = ($('invDateTo')   || $('accDateTo')   || {}).value || '';
    // Sync the other page's pickers too
    ['invDateFrom','accDateFrom'].forEach(id => { const e=$(id); if(e) e.value=App.filter.dateFrom; });
    ['invDateTo','accDateTo'].forEach(id => { const e=$(id); if(e) e.value=App.filter.dateTo; });
    filterInvoiceHistory();
    refreshAccounts();
}

// Apply date filter to an invoice list
function applyPeriodFilter(invoices) {
    const { dateFrom, dateTo } = App.filter;
    return invoices.filter(inv => {
        const d = inv.date || '';
        if (dateFrom && d < dateFrom) return false;
        if (dateTo   && d > dateTo)   return false;
        return true;
    });
}

// Profit helpers — use settings cogsPct (set by business owner)
function estProfit(revenue) { return revenue * (1 - App.filter.cogsPct); }
function estMargin()        { return (1 - App.filter.cogsPct) * 100; }

// Format date nicely: "2026-05-10" → "10 May 2026"
function fmtDate(d) {
    if (!d) return '—';
    // Handle ISO date string
    const parts = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (parts) {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${parseInt(parts[3])} ${months[parseInt(parts[2])-1]} ${parts[1]}`;
    }
    // Fallback: try parsing
    try {
        const dt = new Date(d);
        if (!isNaN(dt)) return dt.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    } catch(_) {}
    return d;
}

function marginBarHTML(pct) {
    const cls = pct >= 30 ? '' : pct >= 15 ? 'warn' : 'bad';
    const lblCls = pct >= 30 ? '' : pct >= 15 ? 'warn' : 'bad';
    const w = Math.min(100, Math.max(0, pct)).toFixed(0);
    return `<div class="margin-bar-cell">
        <div class="margin-bar-track"><div class="margin-bar-fill ${cls}" style="width:${w}%"></div></div>
        <span class="margin-pct-label ${lblCls}">${pct.toFixed(1)}%</span>
    </div>`;
}

// Toggle profit columns across all tables
function toggleProfitCols(show) {
    App.filter.showProfit = show;
    const tables = document.querySelectorAll('.table, .card');
    tables.forEach(el => {
        if (show) el.classList.remove('profit-hidden');
        else el.classList.add('profit-hidden');
    });
    // Also toggle the accounts P&L card visibility
    document.querySelectorAll('.profit-col-item').forEach(el => {
        el.style.display = show ? '' : 'none';
    });
}

// Period label string
function periodLabel() {
    const { period, dateFrom, dateTo } = App.filter;
    if (period === 'daily')   return 'Today (' + dateFrom + ')';
    if (period === 'monthly') return dateFrom + ' → ' + dateTo;
    if (dateFrom || dateTo)   return (dateFrom || '…') + ' → ' + (dateTo || '…');
    return 'All time';
}

function loadInvoiceHistory() {
    filterInvoiceHistory();
}

function filterInvoiceHistory() {
    // Only show invoices when connected to Sheets.
    // Local invoices (localStorage) are a write-cache for new invoices created
    // in this session — merged in only AFTER connection, never shown on cold load.
    if (!App.state.connected) {
        const tbody = $('invHistoryBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="empty-row">Connect to Google Sheets (Settings) to view invoice history</td></tr>';
        const setT = (id, v) => { const e = $(id); if(e) e.textContent = v; };
        setT('invPeriodLabel', 'Not connected');
        setT('invSummaryCount', '—');
        setT('invSummaryRev', '₹0');
        setT('invSummaryProfit', '₹0');
        setT('invSummaryMargin', '0%');
        setT('invSummaryCollected', '₹0');
        setT('invSummaryOutstanding', '₹0');
        return;
    }
    // Connected: Sheets is source of truth.
    // localStorage only supplements invoices not yet synced to Sheets.
    const sheetsInvoices = App.state.invoices || [];
    const sheetsIds      = new Set(sheetsInvoices.map(i => i.id));
    const localInvoices  = getLocalInvoices();
    // Only keep local invoices that haven't made it to Sheets yet
    const localOnly      = localInvoices.filter(li => !sheetsIds.has(li.id));
    // Sheets data wins — put it first so it dominates dedup
    const merged = [...sheetsInvoices, ...localOnly];

    // Apply period/date filter
    const periodFiltered = applyPeriodFilter(merged);

    const searchTerm = ($('invSearchBox') ? $('invSearchBox').value : '').toLowerCase();
    const payFilter  = $('invPayFilter')    ? $('invPayFilter').value    : '';
    const statFilter = $('invStatusFilter') ? $('invStatusFilter').value : '';

    const filtered = periodFiltered.filter(inv => {
        const matchSearch = !searchTerm ||
            (inv.id || '').toLowerCase().includes(searchTerm) ||
            (inv.customer || '').toLowerCase().includes(searchTerm) ||
            (inv.phone || '').toLowerCase().includes(searchTerm);
        const matchPay  = !payFilter  || inv.paymentMode  === payFilter;
        const matchStat = !statFilter || inv.paymentStatus === statFilter;
        return matchSearch && matchPay && matchStat;
    });

    // Update summary band
    const totalRev     = filtered.reduce((s, i) => s + (i.total || 0), 0);
    const totalCollect = filtered.reduce((s, i) => {
        const p = i.amountPaid != null ? i.amountPaid : (i.paymentStatus === 'Paid' ? i.total : 0);
        return s + (p || 0);
    }, 0);
    const totalOut = Math.max(0, totalRev - totalCollect);
    const profit   = estProfit(totalRev);
    const margin   = estMargin();

    const setT = (id, v) => { const e = $(id); if(e) e.textContent = v; };
    setT('invPeriodLabel',      periodLabel());
    setT('invSummaryCount',     filtered.length);
    setT('invSummaryRev',       '₹' + num(totalRev));
    setT('invSummaryProfit',    '₹' + num(profit));
    setT('invSummaryMargin',    margin.toFixed(1) + '%');
    setT('invSummaryCollected', '₹' + num(totalCollect));
    setT('invSummaryOutstanding','₹' + num(totalOut));

    renderInvoiceHistoryTable(filtered);
}

function renderInvoiceHistoryTable(invoices) {
    const tbody = $('invHistoryBody');
    if (!invoices.length) {
        tbody.innerHTML = '<tr><td colspan="11" class="empty-row">No invoices found</td></tr>';
        return;
    }
    const margin = estMargin();
    tbody.innerHTML = invoices.map(inv => {
        const total   = inv.total || 0;
        const paid    = inv.amountPaid != null ? inv.amountPaid : total;
        const balance = Math.max(0, total - paid);
        const profit  = estProfit(total);
        const status  = inv.paymentStatus || 'Paid';
        const statusClass = status === 'Paid' ? 'badge-paid' : status === 'Partial' ? 'badge-partial' : 'badge-pending';
        const modeIcon = payModeIcon(inv.paymentMode);
        const invIdSafe = esc(inv.id);
        return `<tr>
            <td class="mono" style="color:var(--accent);font-weight:700">${invIdSafe}</td>
            <td><strong>${esc(inv.customer || 'Walk-in')}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(inv.phone || '')}</span></td>
            <td>${fmtDate(inv.date)}</td>
            <td><div style="display:flex;align-items:center;gap:4px;">${modeIcon} <span>${esc(inv.paymentMode || 'Cash')}</span></div></td>
            <td><strong>₹${num(total)}</strong></td>
            <td class="profit-col-item" style="color:var(--success);font-weight:600;">₹${num(profit)}</td>
            <td class="profit-col-item">${marginBarHTML(margin)}</td>
            <td style="color:var(--success);">₹${num(paid)}</td>
            <td style="color:${balance > 0 ? 'var(--danger)' : 'var(--success)'};">₹${num(balance)}</td>
            <td><span class="pay-status-badge ${statusClass}">${status}</span></td>
            <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-outline btn-sm" onclick="openEditInvoice('${invIdSafe}')"><svg width="13" height="13"><use href="#ico-edit"/></svg> Edit</button>
                    <button class="btn btn-outline btn-sm" onclick="openPaymentModal('${invIdSafe}')"><svg width="13" height="13"><use href="#ico-payment"/></svg> Pay</button>
                    <button class="btn btn-outline btn-sm" onclick="shareInvoiceWhatsAppById('${invIdSafe}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg></button>
                    <button class="btn btn-outline btn-sm" onclick="showInvoice(findInvoice('${invIdSafe}'))"><svg width="13" height="13"><use href="#ico-print"/></svg></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function payModeIcon(mode) {
    const icons = { 
        Cash: '<svg width="14" height="14" style="color:#10b981"><use href="#ico-receipt"/></svg>', 
        UPI: '<svg width="14" height="14" style="color:#0ea5e9"><use href="#ico-link"/></svg>', 
        Card: '<svg width="14" height="14" style="color:#f59e0b"><use href="#ico-accounts"/></svg>', 
        NetBanking: '<svg width="14" height="14" style="color:#6366f1"><use href="#ico-store"/></svg>', 
        Cheque: '<svg width="14" height="14" style="color:#8b5cf6"><use href="#ico-list"/></svg>', 
        Credit: '<svg width="14" height="14" style="color:#f43f5e"><use href="#ico-clock"/></svg>' 
    };
    return icons[mode] || '<svg width="14" height="14"><use href="#ico-payment"/></svg>';
}

// ══════════════════════════════════════════════════════════
// EDIT INVOICE
// ══════════════════════════════════════════════════════════

let _editingInvId = null;
let _editInvItems = []; // local copy of items being edited

function openEditInvoice(invId) {
    const inv = findInvoice(invId);
    if (!inv) { showToast('Invoice not found', 'error'); return; }
    _editingInvId = invId;

    $('editInvId').textContent       = inv.id;
    $('editCustName').value          = inv.customer || '';
    $('editCustPhone').value         = inv.phone    || '';
    $('editCustEmail').value         = inv.email    || '';
    $('editPayMode').value           = inv.paymentMode   || 'Cash';
    $('editPayStatus').value         = inv.paymentStatus || 'Paid';
    $('editAmtPaid').value           = inv.amountPaid != null ? inv.amountPaid : inv.total || 0;
    $('editNotes').value             = inv.notes         || '';

    // Load items — from local store or invoice items state
    _editInvItems = (inv.items && inv.items.length)
        ? inv.items.map(i => ({ ...i }))
        : App.state.invoiceItems
            .filter(it => it.invoiceId === invId)
            .map(it => ({ id: it.productId, name: it.productName, qty: it.quantity, price: it.unitPrice, subtotal: it.subtotal }));

    renderEditInvItems();
    updateEditBalance();
    $('editInvoiceModal').classList.add('show');
}

function renderEditInvItems() {
    const el = $('editInvItemsList');
    if (!el) return;
    if (!_editInvItems.length) {
        el.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:8px;">No products — click Add Product to add items.</p>';
    } else {
        el.innerHTML = _editInvItems.map((item, idx) => `
        <div class="cart-item">
            <div class="cart-item-info">
                <div class="cart-item-name">${esc(item.name)}</div>
                <div class="cart-item-price">₹${num(item.price)} each</div>
            </div>
            <div class="cart-item-qty">
                <button class="qty-btn" onclick="editInvChangeQty(${idx}, -1)">−</button>
                <span class="qty-display">${item.qty}</span>
                <button class="qty-btn" onclick="editInvChangeQty(${idx}, 1)">+</button>
            </div>
            <div class="cart-item-total">₹${num(item.price * item.qty)}</div>
            <button class="cart-remove" onclick="editInvRemoveItem(${idx})" title="Remove">✕</button>
        </div>`).join('');
    }
    updateEditInvTotals();
}

function editInvChangeQty(idx, delta) {
    if (!_editInvItems[idx]) return;
    _editInvItems[idx].qty = Math.max(1, (_editInvItems[idx].qty || 1) + delta);
    _editInvItems[idx].subtotal = _editInvItems[idx].qty * _editInvItems[idx].price;
    renderEditInvItems();
}

function editInvRemoveItem(idx) {
    _editInvItems.splice(idx, 1);
    renderEditInvItems();
}

function editInvAddProduct() {
    const searchDiv = $('editInvProductSearch');
    if (searchDiv) {
        searchDiv.classList.toggle('hidden');
        const inp = $('editProdSearchInput');
        if (inp) { inp.value = ''; inp.focus(); }
        filterEditProdSearch();
    }
}

function filterEditProdSearch() {
    const q = ($('editProdSearchInput')?.value || '').toLowerCase();
    const results = $('editProdSearchResults');
    if (!results) return;
    const matches = App.state.products.filter(p =>
        p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    ).slice(0, 10);
    if (!matches.length) {
        results.innerHTML = '<div class="cust-dropdown-item" style="color:var(--text-muted);">No products found</div>';
    } else {
        results.innerHTML = matches.map(p => `
            <div class="cust-dropdown-item" onclick="editInvSelectProduct('${esc(p.id)}')">
                <strong>${esc(p.name)}</strong>
                <span style="font-size:11px;color:var(--text-muted)">₹${num(p.price)} · Stock: ${p.stock}</span>
            </div>`).join('');
    }
    results.classList.remove('hidden');
}

function editInvSelectProduct(prodId) {
    const prod = App.state.products.find(p => p.id === prodId);
    if (!prod) return;
    const existing = _editInvItems.find(i => i.id === prodId);
    if (existing) {
        existing.qty++;
        existing.subtotal = existing.qty * existing.price;
    } else {
        _editInvItems.push({ id: prod.id, name: prod.name, qty: 1, price: prod.price, subtotal: prod.price });
    }
    const searchDiv = $('editInvProductSearch');
    if (searchDiv) searchDiv.classList.add('hidden');
    renderEditInvItems();
    showToast(`Added: ${prod.name}`, 'success');
}

function updateEditInvTotals() {
    const inv = findInvoice(_editingInvId);
    const sub = _editInvItems.reduce((s, i) => s + (i.price * i.qty), 0);
    const discPct = inv ? (inv.discPct || inv.discount / (inv.subtotal || 1) * 100 || 0) : 0;
    const gstPct  = inv ? (inv.gstRate || 0) : 0;
    const discAmt = sub * (discPct / 100);
    const taxable = Math.max(0, sub - discAmt);
    const gstAmt  = taxable * (gstPct / 100);
    const total   = taxable + gstAmt;

    const setT = (id, v) => { const e = $(id); if(e) e.textContent = v; };
    setT('editInvSubtotal', '₹' + num(sub));
    setT('editInvDiscPct',  discPct.toFixed(1));
    setT('editInvDiscount', '-₹' + num(discAmt));
    setT('editInvGstPct',   gstPct);
    setT('editInvGst',      '₹' + num(gstAmt));
    setT('editInvTotal',    '₹' + num(total));

    // Also update amount paid cap
    const paidInput = $('editAmtPaid');
    if (paidInput && parseFloat(paidInput.value) > total) paidInput.value = total;
    updateEditBalance(total);
}

function updateEditBalance(overrideTotal) {
    if (!_editingInvId) return;
    const inv = findInvoice(_editingInvId);
    const total = overrideTotal != null ? overrideTotal : (inv ? (inv.total || 0) : 0);
    const paid = parseFloat($('editAmtPaid')?.value) || 0;
    const balance = Math.max(0, total - paid);
    const el = $('editBalanceDue');
    if (el) el.textContent = '₹' + num(balance);
}

function closeEditInvoice() {
    $('editInvoiceModal').classList.remove('show');
    _editingInvId = null;
    _editInvItems = [];
    const searchDiv = $('editInvProductSearch');
    if (searchDiv) searchDiv.classList.add('hidden');
}

async function saveEditInvoice() {
    if (!_editingInvId) return;
    const invoices = getLocalInvoices();
    let inv = invoices.find(i => i.id === _editingInvId);

    if (!inv) {
        const sheetsInv = App.state.invoices.find(i => i.id === _editingInvId);
        if (!sheetsInv) { showToast('Invoice not found', 'error'); return; }
        inv = { ...sheetsInv };
        invoices.unshift(inv);
    }

    inv.customer      = $('editCustName').value.trim();
    inv.phone         = $('editCustPhone').value.trim();
    inv.email         = $('editCustEmail').value.trim();
    inv.paymentMode   = $('editPayMode').value;
    inv.paymentStatus = $('editPayStatus').value;
    inv.amountPaid    = parseFloat($('editAmtPaid').value) || 0;
    inv.notes         = $('editNotes').value.trim();

    // Recalculate totals if items changed
    if (_editInvItems.length) {
        const sub = _editInvItems.reduce((s, i) => s + (i.price * i.qty), 0);
        const discPct = inv.discPct || 0;
        const gstPct  = inv.gstRate || 0;
        const discAmt = sub * (discPct / 100);
        const taxable = Math.max(0, sub - discAmt);
        const gstAmt  = taxable * (gstPct / 100);
        inv.subtotal  = sub;
        inv.discount  = discAmt;
        inv.gst       = gstAmt;
        inv.total     = taxable + gstAmt;
        inv.items     = _editInvItems.map(i => ({ ...i }));
    }

    if (inv.amountPaid >= inv.total)     inv.paymentStatus = 'Paid';
    else if (inv.amountPaid > 0)         inv.paymentStatus = 'Partial';
    else                                 inv.paymentStatus = 'Pending';

    saveLocalInvoices(invoices);

    // Push updated invoice to Google Sheets if connected
    if (App.state.connected && App.state.settings.appUrl) {
        try {
            await apiCall('saveInvoice', { ...inv, skipStockDeduct: true });
            showToast(`Invoice ${inv.id} updated in Sheets!`, 'success');
        } catch(err) {
            showToast(`Saved locally. Sheets sync failed: ${err.message}`, 'info');
        }
    } else {
        showToast(`Invoice ${inv.id} updated locally!`, 'success');
    }

    closeEditInvoice();
    filterInvoiceHistory();
    refreshAccounts();
}

// ══════════════════════════════════════════════════════════
// PAYMENT MODAL
// ══════════════════════════════════════════════════════════

let _payingInvId = null;

function openPaymentModal(invId) {
    const inv = findInvoice(invId);
    if (!inv) { showToast('Invoice not found', 'error'); return; }
    _payingInvId = invId;

    $('payInvId').textContent = inv.id;
    $('payInvTotal').value    = '₹' + num(inv.total || 0);
    const prevPaid = inv.amountPaid != null ? inv.amountPaid : (inv.paymentStatus === 'Paid' ? inv.total : 0);
    $('payPrevPaid').value    = '₹' + num(prevPaid);
    $('payNowAmt').value      = '';
    const balance = Math.max(0, (inv.total || 0) - prevPaid);
    $('payBalance').value     = '₹' + num(balance);
    $('payMode').value        = inv.paymentMode || 'Cash';
    $('payRef').value         = '';

    // Show minimum payment row for Credit invoices
    const minRow = $('payMinAmtRow');
    if (minRow) {
        if (inv.paymentMode === 'Credit' && balance > 0) {
            minRow.classList.remove('hidden');
            // Suggest 10% or ₹100 as minimum, whichever is higher
            const suggestedMin = Math.max(100, Math.ceil(inv.total * 0.1));
            $('payMinAmt').value = '₹' + num(Math.min(suggestedMin, balance));
        } else {
            minRow.classList.add('hidden');
        }
    }

    $('paymentModal').classList.add('show');
}

function updatePayBalance() {
    const inv = findInvoice(_payingInvId);
    if (!inv) return;
    const prevPaid    = inv.amountPaid != null ? inv.amountPaid : 0;
    const nowAmt      = parseFloat($('payNowAmt').value) || 0;
    const newTotal    = prevPaid + nowAmt;
    const balance     = Math.max(0, (inv.total || 0) - newTotal);
    $('payBalance').value = '₹' + num(balance);
}

function closePaymentModal() {
    $('paymentModal').classList.remove('show');
    _payingInvId = null;
}

async function confirmPayment() {
    if (!_payingInvId) return;
    const invoices = getLocalInvoices();
    let idx = invoices.findIndex(i => i.id === _payingInvId);

    if (idx < 0) {
        const sheetsInv = App.state.invoices.find(i => i.id === _payingInvId);
        if (!sheetsInv) { showToast('Invoice not found', 'error'); return; }
        invoices.unshift({ ...sheetsInv });
        idx = 0;
    }

    const inv    = invoices[idx];
    const nowAmt = parseFloat($('payNowAmt').value) || 0;
    if (nowAmt <= 0) { showToast('Enter a valid payment amount', 'error'); return; }

    const prevPaid    = inv.amountPaid != null ? inv.amountPaid : 0;
    const newPaid     = Math.min(inv.total, prevPaid + nowAmt);
    inv.amountPaid    = newPaid;
    inv.paymentMode   = $('payMode').value;
    inv.paymentStatus = newPaid >= inv.total ? 'Paid' : newPaid > 0 ? 'Partial' : 'Pending';

    if (!inv.paymentLog) inv.paymentLog = [];
    const payEntry = {
        date:   new Date().toISOString().split('T')[0],
        amount: nowAmt,
        mode:   $('payMode').value,
        ref:    $('payRef').value.trim()
    };
    inv.paymentLog.push(payEntry);
    saveLocalInvoices(invoices);

    // ── Push to Google Sheets Payments ledger ──────────────
    if (App.state.connected && App.state.settings.appUrl) {
        const confirmBtn = document.querySelector('#paymentModal .btn-primary');
        if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saving…'; }
        try {
            await apiCall('recordPayment', {
                invoiceId: _payingInvId,
                date:      payEntry.date,
                amount:    nowAmt,
                mode:      payEntry.mode,
                reference: payEntry.ref,
                note:      ''
            });
            await apiCall('updateInvoice', { ...inv, skipStockDeduct: true });
            showToast(`₹${num(nowAmt)} recorded & synced to Sheets!`, 'success');
            fetchData('getInvoices').catch(() => {});
        } catch (err) {
            showToast(`Saved locally — Sheets sync failed: ${err.message}`, 'info');
        } finally {
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Payment'; }
        }
    } else {
        showToast(`Payment of ₹${num(nowAmt)} recorded locally`, 'success');
    }

    closePaymentModal();
    filterInvoiceHistory();
    refreshAccounts();
}

// ══════════════════════════════════════════════════════════
// ACCOUNTS PAGE
// ══════════════════════════════════════════════════════════

function refreshAccounts() {
    // Guard: show empty state when not connected to Sheets
    if (!App.state.connected) {
        const zeros = ['accTotalSales','accCollected','accPending','accPartial','accEstProfit','accNetMargin'];
        zeros.forEach(id => { const e = $(id); if(e) e.textContent = id === 'accNetMargin' ? '0%' : '₹0'; });
        const subs = { accTotalInvCount:'0 invoices', accPaidCount:'0 fully paid', accPendingCount:'0 pending, 0 partial', accPartialCount:'0 invoices partial', accCogsPct:'after ~30% COGS' };
        Object.entries(subs).forEach(([id,v]) => { const e=$(id); if(e) e.textContent=v; });
        const md = $('accPayModeBreakdown'); if(md) md.innerHTML = '<p class="empty-row">Connect to Google Sheets to view data</p>';
        const pt = $('accPendingTable');     if(pt) pt.innerHTML = '<tr><td colspan="6" class="empty-row">Connect to Google Sheets to view data</td></tr>';
        const mb = $('monthlyPLBody');       if(mb) mb.innerHTML = '<tr><td colspan="7" class="empty-row">Connect to Google Sheets to view data</td></tr>';
        return;
    }
    // Connected: Sheets is source of truth.
    const sheetsInvoices = App.state.invoices || [];
    const sheetsIds2     = new Set(sheetsInvoices.map(i => i.id));
    const localInvoices  = getLocalInvoices();
    const localOnly2     = localInvoices.filter(li => !sheetsIds2.has(li.id));
    const allMerged      = [...sheetsInvoices, ...localOnly2];

    // Apply period filter
    const merged = applyPeriodFilter(allMerged);

    let totalSales = 0, collected = 0, pending = 0, partial = 0;
    let paidCount = 0, pendingCount = 0, partialCount = 0;
    const byMode = {};

    merged.forEach(inv => {
        const total   = inv.total || 0;
        const paid    = inv.amountPaid != null ? inv.amountPaid : (inv.paymentStatus === 'Paid' ? total : 0);
        const balance = Math.max(0, total - paid);
        totalSales += total;
        collected  += paid;

        const status = inv.paymentStatus || 'Paid';
        if (status === 'Paid')    { paidCount++;    }
        if (status === 'Pending') { pendingCount++;  pending += balance; }
        if (status === 'Partial') { partialCount++;  partial += balance; }

        const mode = inv.paymentMode || 'Cash';
        if (!byMode[mode]) byMode[mode] = 0;
        byMode[mode] += paid;
    });

    pending += partial;

    // Profit calculations
    const profit = estProfit(totalSales);
    const margin = estMargin();

    const fmtAmt = v => '₹' + (v >= 1000 ? (v/1000).toFixed(1)+'K' : num(v));

    $('accTotalSales').textContent    = fmtAmt(totalSales);
    $('accTotalInvCount').textContent = `${merged.length} invoice${merged.length !== 1 ? 's' : ''}`;
    $('accCollected').textContent     = fmtAmt(collected);
    $('accPaidCount').textContent     = `${paidCount} fully paid`;
    $('accPending').textContent       = fmtAmt(pending);
    $('accPendingCount').textContent  = `${pendingCount} pending, ${partialCount} partial`;
    $('accPartial').textContent       = fmtAmt(partial);
    $('accPartialCount').textContent  = `${partialCount} invoice${partialCount !== 1 ? 's' : ''} partial`;

    // NEW: Profit KPIs
    const ep = $('accEstProfit');   if (ep) ep.textContent = fmtAmt(profit);
    const nm = $('accNetMargin');   if (nm) nm.textContent = margin.toFixed(1) + '%';
    const cp = $('accCogsPct');     if (cp) cp.textContent = `after ~${(App.filter.cogsPct*100).toFixed(0)}% COGS`;

    // Payment mode breakdown
    const modeDiv = $('accPayModeBreakdown');
    const modeEntries = Object.entries(byMode).sort((a, b) => b[1] - a[1]);
    if (!modeEntries.length) {
        modeDiv.innerHTML = '<p class="empty-row">No data yet</p>';
    } else {
        const maxVal = modeEntries[0][1];
        modeDiv.innerHTML = modeEntries.map(([mode, amt]) => `
            <div class="pay-mode-row">
                <div class="pay-mode-label">${payModeIcon(mode)} ${mode}</div>
                <div class="pay-mode-bar-wrap">
                    <div class="pay-mode-bar" style="width:${maxVal > 0 ? Math.round(amt/maxVal*100) : 0}%"></div>
                </div>
                <div class="pay-mode-amt">₹${num(amt)}</div>
            </div>`).join('');
    }

    // Pending invoices table
    const pendingInvs = merged.filter(inv => {
        const status = inv.paymentStatus || 'Paid';
        return status === 'Pending' || status === 'Partial';
    });
    const pt = $('accPendingTable');
    if (!pendingInvs.length) {
        pt.innerHTML = '<tr><td colspan="6" class="empty-row">No pending payments <svg width="14" height="14" style="color:var(--success)"><use href="#ico-check"/></svg></td></tr>';
    } else {
        pt.innerHTML = pendingInvs.map(inv => {
            const paid    = inv.amountPaid != null ? inv.amountPaid : 0;
            const balance = Math.max(0, (inv.total || 0) - paid);
            return `<tr>
                <td class="mono" style="color:var(--accent);font-weight:700">${esc(inv.id)}</td>
                <td><strong>${esc(inv.customer || 'Walk-in')}</strong></td>
                <td>₹${num(inv.total)}</td>
                <td style="color:var(--success);">₹${num(paid)}</td>
                <td style="color:var(--danger);font-weight:700;">₹${num(balance)}</td>
                <td><button class="btn btn-primary btn-sm" onclick="openPaymentModal('${esc(inv.id)}');navigate('invoices');"><svg width="13" height="13"><use href="#ico-payment"/></svg> Pay</button></td>
            </tr>`;
        }).join('');
    }

    // NEW: Monthly P&L table — always uses ALL invoices regardless of period filter
    const monthlyMap = {};
    allMerged.forEach(inv => {
        const m = (inv.date || '').slice(0, 7);
        if (!m) return;
        if (!monthlyMap[m]) monthlyMap[m] = { rev: 0, collected: 0, outstanding: 0, count: 0 };
        const total = inv.total || 0;
        const paid  = inv.amountPaid != null ? inv.amountPaid : (inv.paymentStatus === 'Paid' ? total : 0);
        monthlyMap[m].rev         += total;
        monthlyMap[m].collected   += (paid || 0);
        monthlyMap[m].outstanding += Math.max(0, total - (paid || 0));
        monthlyMap[m].count++;
    });

    const monthlyBody = $('monthlyPLBody');
    if (monthlyBody) {
        const monthEntries = Object.entries(monthlyMap).sort((a, b) => b[0] > a[0] ? 1 : -1);
        if (!monthEntries.length) {
            monthlyBody.innerHTML = '<tr><td colspan="7" class="empty-row">No data yet</td></tr>';
        } else {
            monthlyBody.innerHTML = monthEntries.map(([month, d]) => {
                const mProfit = estProfit(d.rev);
                const mMargin = estMargin();
                return `<tr>
                    <td class="mono" style="font-weight:700;">${month}</td>
                    <td>${d.count}</td>
                    <td><strong>₹${num(d.rev)}</strong></td>
                    <td style="color:var(--success);font-weight:600;">₹${num(mProfit)}</td>
                    <td>${marginBarHTML(mMargin)}</td>
                    <td style="color:var(--success);">₹${num(d.collected)}</td>
                    <td style="color:${d.outstanding > 0 ? 'var(--danger)' : 'var(--success)'};">₹${num(d.outstanding)}</td>
                </tr>`;
            }).join('');
        }
    }
}

// ══════════════════════════════════════════════════════════
// PRODUCT MANAGEMENT
// ══════════════════════════════════════════════════════════
let _editingProdId = null;

function openProductModal(prodId = null) {
    _editingProdId = prodId;
    if (prodId) {
        const p = App.state.products.find(x => x.id === prodId);
        if (p) {
            $('editProdId').value = p.id;
            $('editProdId').disabled = true;
            $('editProdName').value = p.name;
            $('editProdPrice').value = p.price;
            $('editProdStock').value = p.stock;
        }
    } else {
        $('editProdId').value = 'PROD-' + String(Date.now()).slice(-4);
        $('editProdId').disabled = false;
        $('editProdName').value = '';
        $('editProdPrice').value = '';
        $('editProdStock').value = '0';
    }
    $('productModal').classList.add('show');
}

function closeProductModal() {
    $('productModal').classList.remove('show');
}

async function saveProduct() {
    const btn = $('productModal').querySelector('.btn-primary');
    const originalText = btn.innerHTML;
    
    const id = $('editProdId').value.trim();
    const name = $('editProdName').value.trim();
    const price = parseFloat($('editProdPrice').value) || 0;
    const stock = parseInt($('editProdStock').value) || 0;
    
    if (!name) { showToast('Product name is required', 'error'); return; }
    
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
    
    try {
        if (App.state.connected && App.state.settings.appUrl) {
            await apiCall('saveProduct', { id, name, price, stock });
        }
        
        const existingIdx = App.state.products.findIndex(x => x.id === id);
        if (existingIdx >= 0) {
            App.state.products[existingIdx] = { id, name, price, stock };
        } else {
            App.state.products.push({ id, name, price, stock });
        }
        
        renderProducts();
        renderDataTable('products');
        updateStats();
        closeProductModal();
        showToast(App.state.connected ? 'Product saved to Sheets' : 'Product saved (local)', 'success');
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;
    
    try {
        if (App.state.connected && App.state.settings.appUrl) {
            await apiCall('deleteProduct', { id });
        }
        
        App.state.products = App.state.products.filter(p => p.id !== id);
        
        const cartIdx = App.state.cart.findIndex(c => c.id === id);
        if (cartIdx >= 0) {
            App.state.cart.splice(cartIdx, 1);
            saveCartToStorage();
            renderCart();
        }
        
        renderProducts();
        renderDataTable('products');
        updateStats();
        showToast(App.state.connected ? 'Product deleted from Sheets' : 'Product deleted', 'success');
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    }
}

// ══════════════════════════════════════════════════════════
// WHATSAPP SHARE — PDF + Text
// ══════════════════════════════════════════════════════════

let _currentShownInv = null;

const _origShowInvoice = showInvoice;
showInvoice = function(inv) {
    _currentShownInv = inv;
    _origShowInvoice(inv);
};

// ── Get the correct element to render (A4 or thermal) ─────
function getInvoiceElement() {
    const billType = App.state.settings.billType || 'a4';
    if (billType === '80mm') {
        // Capture just the receipt card, not the grey wrapper
        const el = document.getElementById('thermalDoc');
        return el;
    }
    return document.getElementById('invoiceDoc');
}

// ── Generate PDF blob from rendered invoice DOM ────────────
async function generateInvoicePDFBlob(inv) {
    const element = getInvoiceElement();
    if (!element) throw new Error('Invoice element not found');

    const billType = App.state.settings.billType || 'a4';
    const is80mm   = billType === '80mm';

    let opt;
    if (is80mm) {
        // Measure actual rendered height of the receipt
        const renderedH = element.scrollHeight || 400;
        // Convert px to mm: 1px = 0.2646mm at 96dpi
        const heightMm  = Math.ceil(renderedH * 0.2646) + 10;
        opt = {
            margin:      [4, 3, 4, 3],
            filename:    `${inv.id}.pdf`,
            image:       { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale:           3,
                useCORS:         true,
                backgroundColor: '#ffffff',
                width:           302,     // exact receipt width in px
                windowWidth:     302
            },
            jsPDF: { unit: 'mm', format: [80, heightMm], orientation: 'portrait' }
        };
    } else {
        opt = {
            margin:      10,
            filename:    `${inv.id}.pdf`,
            image:       { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
    }

    const worker = html2pdf().set(opt).from(element);
    const blob   = await worker.outputPdf('blob');
    return blob;
}

// ── Download PDF to device ─────────────────────────────────
async function downloadInvoicePDF() {
    const inv = _currentShownInv;
    if (!inv) { showToast('No invoice loaded', 'error'); return; }

    if (typeof html2pdf === 'undefined') {
        showToast('PDF library loading… try again in a moment', 'info');
        return;
    }

    const btn = document.getElementById('whatsappShareBtn');
    const prevText = document.getElementById('whatsappBtnText');
    showToast('Generating PDF…', 'info');

    try {
        const blob    = await generateInvoicePDFBlob(inv);
        const url     = URL.createObjectURL(blob);
        const a       = document.createElement('a');
        a.href        = url;
        a.download    = `${inv.id}_${(inv.customer || 'invoice').replace(/\s+/g,'_')}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('PDF downloaded!', 'success');
    } catch(err) {
        showToast('PDF error: ' + err.message, 'error');
    }
}

// ── WhatsApp share: download PDF + open wa.me directly ────
async function shareInvoiceWhatsApp() {
    const inv = _currentShownInv;
    if (!inv) { showToast('No invoice to share', 'error'); return; }

    const btn      = document.getElementById('whatsappShareBtn');
    const btnLabel = document.getElementById('whatsappBtnText');

    // ── CRITICAL: open WhatsApp SYNCHRONOUSLY before any await ──
    // Browsers block window.open after async gaps unless it's from a direct user gesture.
    const rawPhone = (inv.phone || '').replace(/\D/g, '');
    const waPhone  = rawPhone
        ? (rawPhone.startsWith('91') && rawPhone.length >= 12 ? rawPhone : '91' + rawPhone)
        : '';
    const msg      = buildWhatsAppMessage(inv);
    const waUrl    = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
    const waWindow = window.open(waUrl, '_blank');   // opens immediately on user click

    if (btn)      btn.disabled = true;
    if (btnLabel) btnLabel.textContent = 'Generating PDF…';

    try {
        // Auto-save to Sheets in background
        _autoSaveInvoice(inv).catch(() => {});

        // Generate PDF and download
        if (typeof html2pdf !== 'undefined') {
            try {
                const blob     = await generateInvoicePDFBlob(inv);
                const fileName = `Invoice_${inv.id}_${(inv.customer || 'bill').replace(/\s+/g, '_')}.pdf`;
                _downloadBlob(blob, fileName);
                showToast('PDF downloaded! Attach it in WhatsApp 📎', 'success');
            } catch (pdfErr) {
                showToast('PDF failed — WhatsApp opened with text summary', 'info');
            }
        } else {
            showToast('WhatsApp opened!', 'success');
        }

    } finally {
        if (btn)      btn.disabled  = false;
        if (btnLabel) btnLabel.textContent = 'WhatsApp';
    }
}

async function shareInvoiceWhatsAppById(invId) {
    const inv = findInvoice(invId);
    if (!inv) { showToast('Invoice not found', 'error'); return; }
    // Populate _currentShownInv without opening the modal
    _currentShownInv = inv;
    await shareInvoiceWhatsApp();
}

// ── Helpers ───────────────────────────────────────────────
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function _openWhatsAppText(inv) {
    // Always clean phone to digits only, prepend India +91 if needed
    const rawPhone = (inv.phone || '').replace(/\D/g, '');
    const waPhone  = rawPhone
        ? (rawPhone.startsWith('91') && rawPhone.length >= 12 ? rawPhone : '91' + rawPhone)
        : '';

    const msg     = buildWhatsAppMessage(inv);
    const encoded = encodeURIComponent(msg);

    // wa.me with phone goes directly to that contact in WhatsApp
    // wa.me without phone opens WhatsApp to choose recipient
    const url = `https://wa.me/${waPhone}?text=${encoded}`;
    window.open(url, '_blank');
}

async function _autoSaveInvoice(inv) {
    if (!App.state.connected || !App.state.settings.appUrl) {
        saveInvoiceLocally(inv);
        return;
    }
    const already = App.state.invoices.find(i => i.id === inv.id);
    if (!already) {
        try {
            await apiCall('saveInvoice', { ...inv, skipStockDeduct: true });
            await fetchData('getInvoices');
        } catch(err) {
            saveInvoiceLocally(inv);
        }
    }
}

function buildWhatsAppMessage(inv) {
    if (!inv) return '';
    const s = App.state.settings;
    const lines = [];
    lines.push(`🧾 *${s.shopName || 'Invoice'}*`);
    lines.push(`Invoice: *${inv.id}*   Date: ${fmtDate(inv.date)}`);
    lines.push('');
    lines.push(`👤 *${inv.customer || 'Walk-in Customer'}*`);
    if (inv.phone) lines.push(`📞 ${inv.phone}`);
    lines.push('');
    lines.push('*─── Items ───*');
    (inv.items || []).forEach(it => {
        lines.push(`• ${it.name}  ×${it.qty}  ₹${num(it.price * it.qty)}`);
    });
    lines.push('');
    if (inv.discount > 0) lines.push(`Discount: -₹${num(inv.discount)}`);
    lines.push(`GST (${inv.gstRate || 0}%): ₹${num(inv.gst)}`);
    lines.push(`*💰 Total: ₹${num(inv.total)}*`);
    if (inv.amountPaid != null && inv.amountPaid < inv.total) {
        lines.push(`Paid: ₹${num(inv.amountPaid)}  |  Due: ₹${num(inv.total - inv.amountPaid)}`);
    }
    lines.push('');
    lines.push(`Payment: ${inv.paymentMode || 'Cash'}`);
    if (s.shopPhone) lines.push(`\n📍 ${s.shopName}  |  ${s.shopPhone}`);
    lines.push('');
    lines.push(s.invFooter || 'Thank you for your business! 🙏');
    return lines.join('\n');
}

// ══════════════════════════════════════════════════════════
// BILL TYPE — Settings toggle + thermal rendering
// ══════════════════════════════════════════════════════════

function onBillTypeChange(val) {
    App.state.settings.billType = val;
    saveSettingsToStorage();
    const opts = document.getElementById('thermalOptions');
    if (opts) opts.classList.toggle('hidden', val !== '80mm');
}

function populateBillTypeSettings() {
    const bt = App.state.settings.billType || 'a4';
    const a4  = document.getElementById('billTypeA4');
    const mm  = document.getElementById('billType80');
    if (a4) a4.checked = bt === 'a4';
    if (mm) mm.checked = bt === '80mm';
    const opts = document.getElementById('thermalOptions');
    if (opts) opts.classList.toggle('hidden', bt !== '80mm');

    const s = App.state.settings;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ''; };
    set('setThermalTagline', s.thermalTagline);
    set('setThermalCashier', s.thermalCashier);
    set('setThermalFooter',  s.thermalFooter);
    const hsnEl = document.getElementById('setShowHsn');
    if (hsnEl) hsnEl.value = s.showHsn || 'no';
}

// ── Save thermal settings (call from saveSettings) ────────
function saveThermalSettings() {
    const get = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    App.state.settings.billType       = App.state.settings.billType || 'a4';
    App.state.settings.thermalTagline = get('setThermalTagline');
    App.state.settings.thermalCashier = get('setThermalCashier');
    App.state.settings.thermalFooter  = get('setThermalFooter');
    App.state.settings.showHsn        = get('setShowHsn');
    const bt = document.querySelector('input[name="billType"]:checked');
    if (bt) App.state.settings.billType = bt.value;
}

// ── Populate & show the correct bill layout ────────────────
function showInvoiceInCorrectFormat(inv) {
    const bt        = App.state.settings.billType || 'a4';
    const a4El      = document.getElementById('invoiceDoc');
    const wrapEl    = document.getElementById('thermalWrap');
    const thermalEl = document.getElementById('thermalDoc');

    if (bt === '80mm') {
        if (a4El)   a4El.classList.add('hidden');
        if (wrapEl) { wrapEl.classList.remove('hidden'); populateThermal(inv); }
    } else {
        if (wrapEl) wrapEl.classList.add('hidden');
        if (a4El)   a4El.classList.remove('hidden');
    }
}

// ── Fill thermal receipt DOM ───────────────────────────────
function populateThermal(inv) {
    const s = App.state.settings;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = String(v ?? ''); };
    const hide = (id, yes) => { const e = document.getElementById(id); if (e) e.style.display = yes ? 'none' : ''; };

    // Header
    set('trShopName', s.shopName  || 'Store');
    set('trTagline',  s.thermalTagline || '');
    set('trAddr',     s.shopAddress   || '');
    set('trPhone',    s.shopPhone ? '📞 ' + s.shopPhone : '');
    set('trGstin',    s.shopGstin ? 'GSTIN: ' + s.shopGstin : '');

    // Meta
    set('trInvNum',   inv.id);
    set('trDate',     fmtDate(inv.date) + '  ' + (inv.time || ''));
    set('trCashier',  s.thermalCashier || 'Counter 1');
    set('trCustName', inv.customer || 'Walk-in');

    const phoneEl = document.getElementById('trCustPhone');
    if (phoneEl) phoneEl.textContent = inv.phone || '';
    hide('trPhoneRow', !inv.phone);

    // Items table
    const showHsn = s.showHsn === 'yes';
    const tbody = document.getElementById('trItems');
    if (tbody) {
        tbody.innerHTML = (inv.items || []).map(it => {
            const qty       = it.qty || 0;
            const price     = it.price || 0;
            const lineTotal = it.subtotal != null ? it.subtotal : price * qty;
            const hsnRow    = (showHsn && it.hsn)
                ? `<tr><td colspan="4" style="font-size:9px;color:#888;padding:0 0 1px 0;">${esc(it.hsn)}</td></tr>`
                : '';
            return `${hsnRow}<tr>
                <td style="font-weight:600;">${esc(it.name)}</td>
                <td>${qty}</td>
                <td>₹${num(price)}</td>
                <td style="font-weight:700;">₹${num(lineTotal)}</td>
            </tr>`;
        }).join('');
    }

    // Totals
    const sub     = inv.subtotal ?? (inv.items || []).reduce((s, i) => s + i.price * i.qty, 0);
    const discAmt = inv.discount  || 0;
    const gstAmt  = inv.gst       || 0;
    const total   = inv.total     ?? (sub - discAmt + gstAmt);

    set('trSub', '₹' + num(sub));

    const discRow = document.getElementById('trDiscRow');
    if (discRow) {
        if (discAmt > 0) {
            discRow.style.display = '';
            const dl = document.getElementById('trDiscLabel');
            if (dl) dl.textContent = `Discount (${inv.discPct || 0}%)`;
            set('trDisc', '-₹' + num(discAmt));
        } else {
            discRow.style.display = 'none';
        }
    }

    const gstLabel = document.getElementById('trGstLabel');
    if (gstLabel) gstLabel.textContent = `GST (${inv.gstRate || 0}%)`;
    set('trGst',   '₹' + num(gstAmt));
    set('trGrand', '₹' + num(total));

    // Payment
    set('trPayMode', inv.paymentMode || 'Cash');
    const paid    = inv.amountPaid != null ? inv.amountPaid : total;
    const balance = Math.max(0, total - paid);
    set('trPaid',  '₹' + num(paid));

    const balRow = document.getElementById('trBalRow');
    if (balRow) balRow.style.display = balance > 0 ? '' : 'none';
    set('trBal', '₹' + num(balance));

    // GST breakdown block
    const gstBlock = document.getElementById('trGstBlock');
    if (gstBlock && inv.gstRate > 0) {
        const rate    = inv.gstRate || 0;
        const taxable = Math.max(0, sub - discAmt);
        const cgst    = (taxable * (rate / 2) / 100).toFixed(2);
        const sgst    = cgst;
        gstBlock.innerHTML = `<div style="padding-top:4px;margin-top:2px;border-top:1px dashed #ccc;">
            <div style="display:flex;justify-content:space-between;">
                <span>Taxable Amt</span><span>₹${num(taxable)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
                <span>CGST @ ${(rate/2).toFixed(1)}%</span><span>₹${cgst}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
                <span>SGST @ ${(rate/2).toFixed(1)}%</span><span>₹${sgst}</span>
            </div>
        </div>`;
    } else if (gstBlock) {
        gstBlock.innerHTML = '';
    }

    // Footer
    set('trFooterMsg', s.thermalFooter || s.invFooter || 'Thank you! Visit again 🙏');
}