/* 九源祥销售系统 · 手机端
 * 独立前端，复用现有 FastAPI 后端，与电脑端/EXE 数据完全同源。
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'billing_mobile_token';
  const BASE_KEY = 'billing_mobile_api_base';
  const $ = (id) => document.getElementById(id);

  const M = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    base: '',
    user: null,
    shop: null,
    customers: [],
    goods: [],
    allGoods: [],
    priceMap: {},
    customer: null,
    cart: [],
    orderNo: '',
    editingOrderId: null,
    editingOrder: null,
    saleDate: today(),
    saleRemark: '',
    saleReturn: false,
    orderRange: 'all',
    page: 'home',
    stats: null,
    purchaseDraft: null,
    purchaseNo: '',
    purchaseSupplier: '',
    purchaseDate: today(),
    searchTimer: null,
    customerTimer: null,
    loadingCount: 0
  };

  /* ---------------- 基础工具 ---------------- */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - num(n));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function monthStart() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function money(v) {
    const n = Number(v || 0);
    return n.toFixed(2);
  }
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function round4(v) { return Math.round(num(v) * 10000) / 10000; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function addDays(text, days) {
    if (!text) return '';
    const d = new Date(text + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + Number(days || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function normalizeBase(value) {
    let base = String(value || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (!/^https?:\/\//i.test(base) && !base.startsWith('/')) {
      base = (location.protocol === 'https:' ? 'https://' : 'http://') + base;
    }
    try {
      const url = new URL(base);
      if (url.pathname.replace(/\/+$/, '') === '') base += '/api';
    } catch (e) { /* 相对路径 */ }
    return base;
  }
  function getBase() {
    return M.base || normalizeBase(localStorage.getItem(BASE_KEY) || (window.MOBILE_CONFIG && window.MOBILE_CONFIG.API_BASE) || '');
  }
  function setLoading(on) {
    M.loadingCount = Math.max(0, M.loadingCount + (on ? 1 : -1));
    $('loading').classList.toggle('hidden', M.loadingCount === 0);
  }
  let toastTimer = null;
  function toast(text, type) {
    const el = $('toast');
    el.textContent = text || '';
    el.className = 'toast show' + (type === 'err' ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, type === 'err' ? 3200 : 2200);
  }
  async function api(path, opts) {
    opts = opts || {};
    const base = getBase();
    if (!base) throw new Error('请先设置服务器 API 地址');
    const headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (M.token) headers.Authorization = 'Bearer ' + M.token;
    let response;
    try {
      response = await fetch(base + path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store'
      });
    } catch (e) {
      throw new Error('无法连接服务器，请检查网络或 API 地址');
    }
    let json = null;
    try { json = await response.json(); } catch (e) { /* ignore */ }
    if (response.status === 401) {
      logout(true);
      throw new Error((json && json.error) || '登录已过期，请重新登录');
    }
    if (!response.ok || !json || json.ok !== true) {
      throw new Error((json && json.error) || ('请求失败（HTTP ' + response.status + '）'));
    }
    return json.data;
  }
  function parseHash() { return (location.hash || '').replace(/^#/, ''); }

  /* ---------------- 登录 ---------------- */
  function showLogin(message) {
    $('loginView').classList.remove('hidden');
    $('appView').classList.add('hidden');
    const saved = localStorage.getItem(BASE_KEY) || (window.MOBILE_CONFIG && window.MOBILE_CONFIG.API_BASE) || '';
    $('loginApiBase').value = saved;
    $('loginError').textContent = message || '';
  }
  async function doLogin(event) {
    if (event) event.preventDefault();
    const base = normalizeBase($('loginApiBase').value);
    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value;
    const error = $('loginError');
    error.textContent = '';
    if (!base) { error.textContent = '请填写服务器 API 地址'; return; }
    if (!username || !password) { error.textContent = '请填写账号和密码'; return; }
    const btn = $('loginBtn');
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const response = await fetch(base + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json || json.ok !== true) throw new Error((json && json.error) || '登录失败');
      M.base = base;
      M.token = json.data.token;
      M.user = json.data.staff;
      localStorage.setItem(BASE_KEY, base);
      localStorage.setItem(TOKEN_KEY, M.token);
      $('loginPassword').value = '';
      await enterApp();
    } catch (e) {
      error.textContent = e.message || '登录失败';
    } finally {
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  }
  async function enterApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    setLoading(true);
    try {
      if (!M.user) M.user = await api('/auth/me');
      M.shop = await api('/shop');
      $('topShopName').textContent = (M.shop && M.shop.name) || '九源祥销售';
      $('topSub').textContent = (M.user.display_name || M.user.username || '') + ' · 手机开单';
      await loadCustomers();
      await refreshOrderNo();
      await loadStats();
      go(parseHash() && parseHash() !== '' ? parseHash() : 'home');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }
  function logout(silent) {
    M.token = '';
    M.user = null;
    M.shop = null;
    M.customers = [];
    M.goods = [];
    M.priceMap = {};
    M.customer = null;
    M.cart = [];
    M.editingOrderId = null;
    M.editingOrder = null;
    localStorage.removeItem(TOKEN_KEY);
    if (silent) showLogin('登录已过期，请重新登录');
    else showLogin('');
  }

  /* ---------------- 通用数据 ---------------- */
  async function loadCustomers(force) {
    if (M.customers.length && !force) return M.customers;
    M.customers = await fetchAll('/customers');
    return M.customers;
  }
  async function fetchAll(path) {
    let page = 1, all = [];
    while (page <= 20) {
      const sep = path.indexOf('?') >= 0 ? '&' : '?';
      const data = await api(path + sep + 'page=' + page + '&page_size=500');
      const items = data.items || [];
      all = all.concat(items);
      if (all.length >= Number(data.total || 0) || !items.length) break;
      page += 1;
    }
    return all;
  }
  async function refreshOrderNo() {
    try {
      const data = await api('/orders/next-no');
      M.orderNo = data.order_no || '';
    } catch (e) {
      M.orderNo = localOrderNo();
    }
  }
  function localOrderNo() {
    const d = new Date();
    return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
      String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
  }
  function displaySpec(row) {
    const spec = String(row.spec || '').trim();
    if (!spec || spec === '无规格' || spec.indexOf('*') >= 0 || spec.indexOf('×') >= 0) return spec === '无规格' ? '' : spec;
    const unitName = String(row.unit || '').trim();
    const baseUnit = row.baseUnit || ((row.units || []).find((u) => u.is_base) || {}).unit || '';
    const slashIndex = spec.indexOf('/');
    if (slashIndex >= 0) {
      const specUnit = spec.slice(slashIndex + 1).trim();
      if (unitName && specUnit === unitName) return spec;
      if (unitName && baseUnit && unitName === baseUnit) return '';
      if (!baseUnit && Number(row.unit_factor) === 1) return '';
      return spec;
    }
    if (baseUnit && spec.toLowerCase().slice(-baseUnit.length) === baseUnit.toLowerCase()) return spec;
    const unit = (row.units || []).find((u) => u.unit === unitName);
    const factor = Number((unit && unit.factor) || 1);
    if (factor > 1 && baseUnit) return spec + '*' + String(factor) + baseUnit;
    return spec;
  }
  function findCustomer(id) {
    return M.customers.find((c) => String(c.id) === String(id));
  }
  function findGoods(id) {
    return M.allGoods.find((g) => Number(g.id) === Number(id)) || M.goods.find((g) => Number(g.id) === Number(id));
  }
  async function loadCustomerPrices() {
    if (!M.customer || !M.customer.id) { M.priceMap = {}; return; }
    try {
      const list = await api('/customers/' + encodeURIComponent(M.customer.id) + '/prices');
      M.priceMap = {};
      list.forEach((it) => { M.priceMap[Number(it.goods_id)] = it; });
    } catch (e) {
      M.priceMap = {};
    }
  }

  /* ---------------- 路由与页面 ---------------- */
  function go(page) {
    closeSheet();
    M.page = page;
    document.querySelectorAll('.tab-item').forEach((el) => el.classList.toggle('is-active', el.dataset.page === page));
    location.hash = page;
    const content = $('pageContent');
    content.innerHTML = '';
    document.body.classList.toggle('page-sale', page === 'sale');
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (page === 'home') renderHome(content);
    else if (page === 'sale') renderSale(content);
    else if (page === 'orders') renderOrders(content);
    else if (page === 'customers') renderCustomers(content);
    else if (page === 'goods') renderGoods(content);
    else if (page === 'purchases') renderPurchases(content);
    else if (page === 'stats') renderStats(content);
    else if (page === 'more') renderMore(content);
    else renderHome(content);
  }
  function pageHead(title, sub, extra) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1><p>' + esc(sub || '') + '</p></div>' +
      (extra || '') + '</div>';
  }

  /* ---------------- 首页 ---------------- */
  async function loadStats() {
    try { M.stats = await api('/stats/summary'); } catch (e) { M.stats = null; }
    return M.stats;
  }
  async function renderHome(content) {
    const s = (await loadStats()) || M.stats;
    const todayData = (s && s.today) || {};
    const monthData = (s && s.month) || {};
    const recent = (s && s.recent_orders) || [];
    content.innerHTML =
      '<div class="hero">' +
        '<div class="hero-top"><div><div class="hero-label">今日销售额</div>' +
          '<div class="hero-amount"><small>￥</small>' + money(todayData.amount) + '</div></div>' +
          '<div class="hero-badge">' + (M.shop && M.shop.name ? esc(M.shop.name) : '九源祥销售') + '</div></div>' +
        '<div class="hero-meta">' +
          '<div class="hero-meta-item">今日单量<b>' + num(todayData.order_count) + '</b></div>' +
          '<div class="hero-meta-item">本月金额<b>￥' + money(monthData.amount) + '</b></div>' +
          '<div class="hero-meta-item">本月单量<b>' + num(monthData.order_count) + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="quick-grid">' +
        '<button class="quick-item" onclick="Mobile.go(\'sale\')"><div class="quick-icon"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div><span>开单</span></button>' +
        '<button class="quick-item" onclick="Mobile.go(\'orders\')"><div class="quick-icon"><svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6"/></svg></div><span>订单</span></button>' +
        '<button class="quick-item" onclick="Mobile.go(\'customers\')"><div class="quick-icon"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg></div><span>客户</span></button>' +
        '<button class="quick-item" onclick="Mobile.go(\'goods\')"><div class="quick-icon"><svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 21v-9"/></svg></div><span>商品</span></button>' +
      '</div>' +
      '<div class="section-title"><h2>经营概览</h2><span class="link" onclick="Mobile.go(\'stats\')">统计</span></div>' +
      '<div class="stat-cards">' +
        '<div class="stat-card"><div class="stat-label">客户总数</div><div class="stat-value">' + num(s && s.customer_count) + ' <small>位</small></div></div>' +
        '<div class="stat-card"><div class="stat-label">在售商品</div><div class="stat-value">' + num(s && s.goods_count) + ' <small>种</small></div></div>' +
      '</div>' +
      '<div class="section-title"><h2>最近订单</h2><span class="link" onclick="Mobile.go(\'orders\')">全部</span></div>' +
      '<div class="recent-list">' +
        (recent.length ? recent.map((o) => (
          '<button class="recent-row" onclick="Mobile.openOrderDetail(' + o.id + ')">' +
            '<div class="recent-main"><div class="recent-title">' + esc(o.customer_name || '散客') + '</div>' +
              '<div class="recent-sub">' + esc(o.order_no) + ' · ' + esc(o.bill_date) + '</div></div>' +
            '<div class="recent-amount">￥' + money(o.total_amount) + '</div>' +
          '</button>'
        )).join('') : '<div class="empty"><span class="empty-icon">🧾</span>还没有订单，去开第一单吧</div>') +
      '</div>';
  }

  /* ---------------- 销售开单 ---------------- */
  function newSaleDate() { return today(); }
  function renderSale(content) {
    if (M.editingOrderId) return renderSaleEdit(content);
    if (!M.saleDate) M.saleDate = newSaleDate();
    const customerName = M.customer ? M.customer.name : '散客';
    const customerMeta = M.customer
      ? (M.customer.customer_no ? '#' + M.customer.customer_no : (M.customer.tel || '已绑定客户'))
      : '点击选择客户，默认散客';
    content.innerHTML =
      '<div class="sale-head">' +
        '<div><div class="sale-kicker">SALE ORDER</div><h1>手机开单</h1>' +
          '<p>搜索商品，调数量、单位与效期，确认后保存</p></div>' +
        '<div class="sale-head-side"><span class="pill pill-blue">新增</span>' +
          '<div class="order-no">' + esc(M.orderNo || '') + '</div></div>' +
      '</div>' +
      '<div class="sale-meta-card">' +
        '<button class="customer-line" type="button" onclick="Mobile.openCustomerPicker()">' +
          '<span class="customer-avatar">' + esc(String(customerName || '散').slice(0, 1)) + '</span>' +
          '<span class="customer-copy"><b>' + esc(customerName) + '</b><i>' + esc(customerMeta) + '</i></span>' +
          '<span class="chev">›</span>' +
        '</button>' +
        '<div class="meta-divider"></div>' +
        '<div class="date-line"><span class="meta-label">销售日期</span>' +
          '<input class="inline-date" type="date" id="saleDate" value="' + esc(M.saleDate) + '"></div>' +
        '<label class="return-line"><span class="meta-label">退货单</span>' +
          '<input type="checkbox" id="saleReturn"' + (M.saleReturn ? ' checked' : '') + '>' +
          '<span class="switch-track"><i></i></span></label>' +
      '</div>' +
      '<div class="search-box sale-search-box">' +
        '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input id="saleSearch" placeholder="输入品名 / 编码 / 规格" autocomplete="off">' +
        '<button class="search-add" type="button" onclick="Mobile.focusSaleSearch()">添加</button>' +
      '</div>' +
      '<div id="saleSearchResults"></div>' +
      '<div id="cartWrap">' + renderCart() + '</div>' +
      '<div class="bill-note-card"><label class="meta-label">单据备注</label>' +
        '<textarea id="saleRemark" rows="2" placeholder="选填，例如：送货时间、赊账说明">' + esc(M.saleRemark) + '</textarea></div>' +
      '<div class="sale-dock">' +
        '<div class="dock-total"><span>合计 <em id="dockCount">' + M.cart.length + ' 项</em></span>' +
          '<b><small>￥</small><span id="dockTotal">' + money(cartTotal()) + '</span></b></div>' +
        '<div class="dock-actions">' +
          '<button class="btn btn-ghost" type="button" onclick="Mobile.clearSale()">清空</button>' +
          '<button class="btn btn-primary" id="saveSaleBtn" type="button" onclick="Mobile.saveSale()">保存单据</button>' +
        '</div>' +
      '</div>';
    bindSaleSearch();
    $('saleDate').addEventListener('change', (e) => { M.saleDate = e.target.value || today(); });
    $('saleReturn').addEventListener('change', (e) => { M.saleReturn = e.target.checked; });
    $('saleRemark').addEventListener('input', (e) => { M.saleRemark = e.target.value; });
    updateDock();
  }
  function focusSaleSearch() {
    const input = $('saleSearch');
    if (input) input.focus();
  }
  function bindSaleSearch() {
    const input = $('saleSearch');
    if (!input) return;
    input.addEventListener('input', () => {
      const kw = input.value.trim();
      clearTimeout(M.searchTimer);
      const box = $('saleSearchResults');
      if (!kw) { box.innerHTML = ''; return; }
      M.searchTimer = setTimeout(() => searchGoods(kw), 280);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const kw = input.value.trim(); if (kw) searchGoods(kw); }
    });
  }
  async function searchGoods(kw) {
    const box = $('saleSearchResults');
    if (!box) return;
    box.innerHTML = '<div class="search-results"><div class="loading-inline">搜索中…</div></div>';
    try {
      const data = await api('/goods/names?kw=' + encodeURIComponent(kw) + '&limit=20');
      const items = data.items || [];
      box.innerHTML = '<div class="search-results">' +
        (items.length ? items.map((g) => (
          '<button class="search-result-row" onclick="Mobile.pickGoodsName(\'' + escapeAttr(g.name) + '\')">' +
            '<div class="sr-main"><div class="sr-name">' + esc(g.name) + '</div>' +
              '<div class="sr-sub">' + num(g.spec_count) + ' 个规格 · ' + esc(g.sample_code || '') + '</div></div>' +
            '<span class="sr-add">＋</span>' +
          '</button>'
        )).join('') : '<div class="loading-inline">没有匹配的商品，换个关键词试试</div>') +
        '</div>';
    } catch (e) {
      box.innerHTML = '<div class="search-results"><div class="loading-inline">' + esc(e.message) + '</div></div>';
    }
  }
  async function pickGoodsName(name) {
    const box = $('saleSearchResults');
    if (box) box.innerHTML = '<div class="search-results"><div class="loading-inline">读取规格…</div></div>';
    try {
      const data = await api('/goods/specs?name=' + encodeURIComponent(name) + (M.customer ? '&customer_id=' + encodeURIComponent(M.customer.id) : ''));
      const items = data.items || [];
      if (!items.length) { toast('该商品没有可用规格', 'err'); return; }
      if (items.length === 1) { addGoodsToCart(items[0]); return; }
      openSheet('选择规格', '<div class="sheet-sub">' + esc(name) + ' 有 ' + items.length + ' 个规格</div><div class="sheet-list">' +
        items.map((it, i) => (
          '<button class="sheet-item" onclick="Mobile.chooseSpec(' + i + ')">' +
            '<div class="main"><div class="title">' + esc(it.spec || '无规格') + '</div>' +
              '<div class="sub">' + esc(it.code) + ' · 默认 ' + esc(it.default_sale_unit || it.base_unit || '') + '</div></div>' +
            '<div class="side"><b>￥' + money(priceForGoods(it, it.default_sale_unit || it.base_unit)) + '</b><span>/' + esc(it.default_sale_unit || it.base_unit || '') + '</span></div>' +
          '</button>'
        )).join('') + '</div>');
      window.__specChoices = items;
    } catch (e) { toast(e.message, 'err'); }
  }
  function chooseSpec(index) {
    const items = window.__specChoices || [];
    const item = items[index];
    if (!item) return;
    closeSheet();
    addGoodsToCart(item);
  }
  function priceForGoods(item, unitName) {
    const entry = M.priceMap[Number(item.goods_id || item.id)];
    if (entry) {
      const up = entry.unit_prices && entry.unit_prices[unitName];
      if (up && up.price !== null && up.price !== undefined) return Number(up.price);
      if (unitName === (item.base_unit || '') && entry.price !== null && entry.price !== undefined) return Number(entry.price);
      if (entry.price !== null && entry.price !== undefined) {
        const u = (item.units || []).find((x) => x.unit === unitName);
        return round4(Number(entry.price) * Number((u && u.factor) || 1));
      }
    }
    const u = (item.units || []).find((x) => x.unit === unitName);
    if (u && u.price !== null && u.price !== undefined) return Number(u.price);
    const base = (item.units || []).find((x) => x.is_base);
    const basePrice = base && base.price !== null && base.price !== undefined ? Number(base.price) : Number(item.default_price);
    return round4((basePrice || 0) * Number((u && u.factor) || 1));
  }
  function addGoodsToCart(item) {
    const units = item.units || [];
    const unit = item.default_sale_unit || item.base_unit || item.unit || (units[0] && units[0].unit) || '件';
    const factor = Number((units.find((u) => u.unit === unit) || {}).factor || 1);
    const existing = M.cart.find((r) => Number(r.goods_id) === Number(item.goods_id || item.id) && r.unit === unit);
    let row = existing;
    if (existing) {
      existing.qty = round4(Number(existing.qty) + 1);
      existing.amount = round4(existing.qty * Number(existing.price));
    } else {
      row = {
        goods_id: Number(item.goods_id || item.id),
        code: item.code || '',
        name: item.name || '',
        spec: item.spec || '',
        baseUnit: item.base_unit || item.unit || '',
        units: clone(units),
        unit,
        factor,
        qty: 1,
        price: priceForGoods(item, unit),
        amount: round4(priceForGoods(item, unit)),
        shelfLifeDays: Number(item.shelf_life_days || 0),
        makeDate: '',
        expDate: '',
        expireManual: false
      };
      M.cart.push(row);
      loadDateMemoForRow(row);
    }
    if ($('saleSearch')) $('saleSearch').value = '';
    if ($('saleSearchResults')) $('saleSearchResults').innerHTML = '';
    updateCart();
    toast('已添加 ' + (item.name || '') + ' · ' + unit, 'ok');
  }
  async function loadDateMemoForRow(row) {
    if (!row || !row.goods_id) return;
    try {
      const m = await api('/goods/' + row.goods_id + '/date-memo');
      if (!m) return;
      if (!row.makeDate && m.produce_date) row.makeDate = m.produce_date;
      if (!row.expDate) {
        row.expDate = m.expire_date || (row.makeDate && row.shelfLifeDays > 0 ? addDays(row.makeDate, row.shelfLifeDays) : '');
      }
      if (row.makeDate || row.expDate) updateCart();
    } catch (e) { /* 效期记忆失败不影响开单 */ }
  }
  function renderCart() {
    if (!M.cart.length) {
      return '<div class="cart-empty"><div class="cart-empty-icon"><svg viewBox="0 0 24 24"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.5L19 8H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg></div>' +
        '<div class="txt">还没有添加商品<br><span>在上方搜索品名、编码或规格</span></div></div>';
    }
    return '<div class="cart-list">' + M.cart.map((r, i) => {
      const hasExp = Number(r.shelfLifeDays) > 0 || r.makeDate || r.expDate;
      return '<div class="cart-card">' +
        '<div class="cart-top"><div class="cart-main"><div class="cart-name">' + esc(r.name) + '</div>' +
          '<div class="cart-spec">' + (displaySpec(r) ? esc(displaySpec(r)) + ' · ' : '') + esc(r.code) +
            (hasExp ? ' · <span class="shelf-tag">保质 ' + Number(r.shelfLifeDays) + ' 天</span>' : '') + '</div></div>' +
          '<button class="cart-del" type="button" aria-label="删除" onclick="Mobile.removeCart(' + i + ')">×</button></div>' +
        '<div class="cart-controls">' +
          unitSelect(r, i) +
          '<div class="qty-box"><button class="qty-btn" type="button" onclick="Mobile.stepQty(' + i + ',-1)">−</button>' +
            '<input class="qty-input" type="number" inputmode="decimal" step="0.01" value="' + esc(r.qty) + '" onchange="Mobile.setQty(' + i + ',this.value)">' +
            '<button class="qty-btn" type="button" onclick="Mobile.stepQty(' + i + ',1)">＋</button></div>' +
          '<div class="price-box"><div class="price-label">单价 / ' + esc(r.unit) + '</div>' +
            '<input class="price-input" type="number" inputmode="decimal" step="0.01" value="' + esc(r.price) + '" onchange="Mobile.setPrice(' + i + ',this.value)"></div>' +
        '</div>' +
        '<div class="cart-exp">' +
          '<label class="exp-field"><span>生产日期</span><input type="date" value="' + esc(r.makeDate || '') + '" onchange="Mobile.setMakeDate(' + i + ',this.value)"></label>' +
          '<label class="exp-field"><span>保质期至</span><input type="date" value="' + esc(r.expDate || '') + '" onchange="Mobile.setExpDate(' + i + ',this.value)"></label>' +
        '</div>' +
        '<div class="cart-bottom"><span>' + esc(r.qty) + ' ' + esc(r.unit) + ' × ￥' + money(r.price) + '</span>' +
          '<span class="cart-amount">￥' + money(r.amount) + '</span></div>' +
      '</div>';
    }).join('') + '</div>';
  }
  function unitSelect(row, index) {
    const units = row.units || [];
    if (units.length <= 1) {
      return '<input class="unit-select" value="' + esc(row.unit) + '" onchange="Mobile.setUnit(' + index + ',this.value)">';
    }
    return '<select class="unit-select" onchange="Mobile.setUnit(' + index + ',this.value)">' +
      units.map((u) => '<option value="' + esc(u.unit) + '"' + (u.unit === row.unit ? ' selected' : '') + '>' + esc(u.unit) + '</option>').join('') +
      '</select>';
  }
  function cartTotal() { return M.cart.reduce((sum, r) => sum + num(r.amount), 0); }
  function updateCart() {
    const wrap = $('cartWrap');
    if (wrap) wrap.innerHTML = renderCart();
    updateDock();
  }
  function updateDock() {
    const total = $('dockTotal');
    const count = $('dockCount');
    if (total) total.textContent = money(cartTotal());
    if (count) count.textContent = M.cart.length + ' 项';
    const btn = $('saveSaleBtn');
    if (btn && !btn.disabled) btn.textContent = M.editingOrderId ? '保存修改' : '保存单据';
  }
  function setQty(index, value) {
    const row = M.cart[index];
    if (!row) return;
    row.qty = Math.max(0, round4(value));
    row.amount = round4(row.qty * num(row.price));
    updateCart();
  }
  function stepQty(index, delta) {
    const row = M.cart[index];
    if (!row) return;
    row.qty = Math.max(0, round4(num(row.qty) + delta));
    row.amount = round4(row.qty * num(row.price));
    updateCart();
  }
  function setPrice(index, value) {
    const row = M.cart[index];
    if (!row) return;
    row.price = Math.max(0, round4(value));
    row.amount = round4(num(row.qty) * row.price);
    updateCart();
  }
  function setMakeDate(index, value) {
    const row = M.cart[index];
    if (!row) return;
    row.makeDate = value || '';
    if (!row.expireManual) row.expDate = value && Number(row.shelfLifeDays) > 0 ? addDays(value, Number(row.shelfLifeDays)) : '';
    updateCart();
  }
  function setExpDate(index, value) {
    const row = M.cart[index];
    if (!row) return;
    row.expDate = value || '';
    row.expireManual = !!value;
    updateCart();
  }
  function setUnit(index, unit) {
    const row = M.cart[index];
    if (!row) return;
    if (!String(unit || '').trim()) return;
    row.unit = unit;
    const u = (row.units || []).find((x) => x.unit === unit);
    row.factor = Number((u && u.factor) || 1);
    row.price = priceForGoods({
      goods_id: row.goods_id,
      code: row.code,
      name: row.name,
      spec: row.spec,
      base_unit: row.baseUnit,
      units: row.units,
      default_sale_unit: row.unit
    }, unit);
    row.amount = round4(num(row.qty) * num(row.price));
    updateCart();
  }
  function removeCart(index) {
    M.cart.splice(index, 1);
    updateCart();
  }
  function clearSale() {
    if (!confirm('清空当前单据？')) return;
    M.cart = [];
    M.customer = null;
    M.priceMap = {};
    M.editingOrderId = null;
    M.editingOrder = null;
    M.saleDate = today();
    M.saleRemark = '';
    M.saleReturn = false;
    refreshOrderNo().then(() => go('sale'));
  }
  async function saveSale() {
    if (!M.cart.length) return toast('请先添加商品', 'err');
    const valid = M.cart.filter((r) => r.code && num(r.qty) > 0 && num(r.price) >= 0);
    if (!valid.length) return toast('至少需要一行有效商品', 'err');
    const btn = $('saveSaleBtn');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      const customer = M.customer || { name: '散客' };
      const payload = {
        order_no: M.editingOrderId ? (M.editingOrder && M.editingOrder.order_no) : M.orderNo,
        customer_id: customer.id || null,
        customer_no: customer.customer_no || null,
        customer_name: customer.name || '散客',
        customer_addr: customer.addr || '',
        customer_tel: customer.tel || '',
        bill_date: M.saleDate || today(),
        is_return: !!M.saleReturn,
        remark: M.saleRemark || '',
        items: valid.map((r) => ({
          goods_id: r.goods_id || null,
          goods_code: r.code,
          goods_name: r.name,
          spec: displaySpec(r),
          unit: r.unit,
          qty: Number(r.qty),
          price: Number(r.price),
          make_date: r.makeDate || null,
          exp_date: r.expDate || null,
          remark: ''
        }))
      };
      const saved = M.editingOrderId
        ? await api('/orders/' + M.editingOrderId, {
            method: 'PUT',
            body: {
              bill_date: payload.bill_date,
              is_return: payload.is_return,
              remark: payload.remark,
              items: payload.items
            }
          })
        : await api('/orders', { method: 'POST', body: payload });
      toast((M.editingOrderId ? '订单已更新' : '单据已保存') + ' ￥' + money(saved.total_amount), 'ok');
      M.cart = [];
      M.customer = null;
      M.priceMap = {};
      M.editingOrderId = null;
      M.editingOrder = null;
      M.saleDate = today();
      M.saleRemark = '';
      M.saleReturn = false;
      await loadCustomers();
      await loadStats();
      await refreshOrderNo();
      go('sale');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = M.editingOrderId ? '保存修改' : '保存单据'; }
    }
  }
  async function renderSaleEdit(content) {
    const o = M.editingOrder;
    content.innerHTML =
      '<div class="sale-head">' +
        '<div><div class="sale-kicker">EDIT ORDER</div><h1>修改订单</h1>' +
          '<p>客户信息已锁定，可调整商品、数量、价格与效期</p></div>' +
        '<div class="sale-head-side"><span class="pill pill-green">编辑中</span>' +
          '<div class="order-no">' + esc(o ? o.order_no : '') + '</div></div>' +
      '</div>' +
      '<div class="sale-meta-card">' +
        '<div class="customer-line is-readonly"><span class="customer-avatar">' + esc(String(o ? o.customer_name : '散').slice(0, 1)) + '</span>' +
          '<span class="customer-copy"><b>' + esc(o ? o.customer_name : '') + '</b><i>#' + esc(o ? o.customer_no : '') + '</i></span></div>' +
        '<div class="meta-divider"></div>' +
        '<div class="date-line"><span class="meta-label">销售日期</span><input class="inline-date" type="date" id="saleDate" value="' + esc(M.saleDate) + '"></div>' +
        '<label class="return-line"><span class="meta-label">退货单</span><input type="checkbox" id="saleReturn"' + (M.saleReturn ? ' checked' : '') + '><span class="switch-track"><i></i></span></label>' +
      '</div>' +
      '<div class="search-box sale-search-box">' +
        '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input id="saleSearch" placeholder="搜索商品，继续添加明细" autocomplete="off">' +
        '<button class="search-add" type="button" onclick="Mobile.focusSaleSearch()">添加</button>' +
      '</div>' +
      '<div id="saleSearchResults"></div>' +
      '<div id="cartWrap">' + renderCart() + '</div>' +
      '<div class="bill-note-card"><label class="meta-label">单据备注</label>' +
        '<textarea id="saleRemark" rows="2" placeholder="选填">' + esc(M.saleRemark) + '</textarea></div>' +
      '<div class="sale-dock">' +
        '<div class="dock-total"><span>合计 <em id="dockCount">' + M.cart.length + ' 项</em></span>' +
          '<b><small>￥</small><span id="dockTotal">' + money(cartTotal()) + '</span></b></div>' +
        '<div class="dock-actions"><button class="btn btn-ghost" type="button" onclick="Mobile.backToOrders()">返回</button>' +
          '<button class="btn btn-primary" id="saveSaleBtn" type="button" onclick="Mobile.saveSale()">保存修改</button></div>' +
      '</div>';
    bindSaleSearch();
    $('saleDate').addEventListener('change', (e) => { M.saleDate = e.target.value || today(); });
    $('saleReturn').addEventListener('change', (e) => { M.saleReturn = e.target.checked; });
    $('saleRemark').addEventListener('input', (e) => { M.saleRemark = e.target.value; });
    updateDock();
  }
  function backToOrders() {
    M.editingOrderId = null;
    M.editingOrder = null;
    M.cart = [];
    go('orders');
  }

  /* ---------------- 客户选择/管理 ---------------- */
  function openCustomerPicker() {
    loadCustomers(true).then(() => {
      if (!M.customers.length) {
        openSheet('选择客户', '<div class="empty">暂无客户，可直接按散客开单</div>');
        return;
      }
      openSheet('选择客户', '<div class="sheet-sub">可直接选散客，或搜索客户名称/编号/电话</div>' +
        '<div class="sheet-search"><span>🔍</span><input id="pickerCustomerSearch" placeholder="搜索客户" autocomplete="off"></div>' +
        '<div class="sheet-list" id="pickerCustomerList">' + pickerCustomers('') + '</div>');
      const input = $('pickerCustomerSearch');
      input.addEventListener('input', () => {
        $('pickerCustomerList').innerHTML = pickerCustomers(input.value);
      });
    }).catch((e) => toast(e.message, 'err'));
  }
  function pickerCustomers(kw) {
    const q = String(kw || '').trim().toLowerCase();
    const list = M.customers.filter((c) => !q ||
      String(c.name || '').toLowerCase().includes(q) ||
      String(c.customer_no || '').includes(q) ||
      String(c.tel || '').includes(q));
    return '<button class="sheet-item" onclick="Mobile.chooseCustomer(null)">' +
      '<div class="customer-ava">散</div><div class="main"><div class="title">散客</div><div class="sub">不绑定客户，直接开单</div></div>' +
      '<span class="sr-add">›</span></button>' +
      list.slice(0, 60).map((c) => (
        '<button class="sheet-item" onclick="Mobile.chooseCustomer(\'' + escapeAttr(c.id) + '\')">' +
          '<div class="customer-ava">' + esc(String(c.name || '客').slice(0, 1)) + '</div>' +
          '<div class="main"><div class="title">' + esc(c.name) + '</div>' +
            '<div class="sub">#' + esc(c.customer_no || '-') + ' · ' + esc(c.tel || '无电话') + '</div></div>' +
          '<div class="side"><b style="font-size:11px;color:var(--muted)">' + num(c.order_count) + ' 单</b><span>￥' + money(c.total_amount) + '</span></div>' +
        '</button>'
      )).join('') +
      ((!q && list.length > 60) ? '<div class="sheet-note">仅显示前 60 位，输入姓名/编号/电话查找更多</div>' : '');
  }
  async function chooseCustomer(id) {
    closeSheet();
    if (!id) {
      M.customer = null;
      M.priceMap = {};
      if (M.cart.length) { M.cart.forEach((r) => { r.price = priceForGoods(r, r.unit); r.amount = round4(num(r.qty) * num(r.price)); }); }
      go('sale');
      return;
    }
    const c = findCustomer(id);
    if (!c) return;
    M.customer = { id: c.id, customer_no: c.customer_no, name: c.name, addr: c.addr, tel: c.tel };
    await loadCustomerPrices();
    if (M.cart.length) {
      M.cart.forEach((r) => {
        r.price = priceForGoods({
          goods_id: r.goods_id, code: r.code, name: r.name, spec: r.spec,
          base_unit: r.baseUnit, units: r.units
        }, r.unit);
        r.amount = round4(num(r.qty) * num(r.price));
      });
    }
    go('sale');
    toast('已选择客户：' + c.name, 'ok');
  }

  /* ---------------- 订单列表与详情 ---------------- */
  async function renderOrders(content) {
    const ranges = [['today', '今天'], ['week', '近7天'], ['month', '本月'], ['all', '全部']];
    content.innerHTML =
      '<div class="page-head"><div><h1>销售订单</h1><p>查单、改单、作废与对账</p></div>' +
        '<button class="head-action" type="button" onclick="Mobile.go(\'sale\')">＋ 开单</button></div>' +
      '<div class="segmented order-seg" id="orderSeg">' +
        ranges.map((r) => '<button type="button" data-range="' + r[0] + '" class="' + (M.orderRange === r[0] ? 'is-active' : '') + '">' + r[1] + '</button>').join('') +
      '</div>' +
      '<div class="search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input id="orderKw" placeholder="搜索订单号 / 客户" autocomplete="off"></div>' +
      '<div class="list-caption" id="orderCaption"></div>' +
      '<div id="orderList"><div class="loading-inline">加载中…</div></div>';
    const seg = $('orderSeg');
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-range]');
      if (!btn) return;
      M.orderRange = btn.dataset.range;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
      loadOrderList(($('orderKw') || {}).value || '');
    });
    let timer = null;
    const input = $('orderKw');
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadOrderList(input.value.trim()), 300);
    });
    await loadOrderList('');
  }
  function orderRangeDates() {
    if (M.orderRange === 'today') return { from: today(), to: today() };
    if (M.orderRange === 'week') return { from: daysAgo(6), to: today() };
    if (M.orderRange === 'month') return { from: monthStart(), to: today() };
    return { from: '', to: '' };
  }
  async function loadOrderList(kw) {
    const box = $('orderList');
    if (!box) return;
    try {
      const d = orderRangeDates();
      let url = '/orders?kw=' + encodeURIComponent(kw || '') + '&page=1&page_size=80';
      if (d.from) url += '&date_from=' + d.from + '&date_to=' + d.to;
      const data = await api(url);
      const items = data.items || [];
      const caption = $('orderCaption');
      if (caption) {
        const total = items.reduce((s, o) => s + (Number(o.is_void) === 1 ? 0 : Number(o.total_amount || 0)), 0);
        caption.innerHTML = '<span>' + items.length + ' 张单据</span><b>有效金额 ￥' + money(total) + '</b>';
      }
      box.innerHTML = items.length ? '<div class="order-list">' + items.map((o) => {
        const voided = Number(o.is_void) === 1;
        return '<button class="order-card" type="button" onclick="Mobile.openOrderDetail(' + o.id + ')">' +
          '<div class="order-head"><span class="order-no">' + esc(o.order_no) + '</span>' +
            '<span class="pill ' + (voided ? 'pill-red' : 'pill-green') + '">' + (voided ? '已作废' : '正常') + '</span></div>' +
          '<div class="order-customer">' + esc(o.customer_name || '散客') + '</div>' +
          '<div class="order-meta"><div class="order-sub">' + esc(o.bill_date) + ' · ' + num(o.item_count) + ' 行 · 共 ' + num(o.total_qty) + '</div>' +
            '<div class="order-total">￥' + money(o.total_amount) + ' <span class="order-chev">›</span></div></div>' +
        '</button>';
      }).join('') + '</div>' : '<div class="empty"><span class="empty-icon">🧾</span>这个时间段暂无订单</div>';
    } catch (e) {
      box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }
  async function openOrderDetail(id) {
    openSheet('订单详情', '<div class="loading-inline">加载中…</div>');
    try {
      const o = await api('/orders/' + id);
      const voided = Number(o.is_void) === 1;
      $('sheetTitle').textContent = '订单详情';
      $('sheetBody').innerHTML =
        '<div class="detail-hero"><div style="display:flex;justify-content:space-between;align-items:flex-start">' +
          '<div><div style="font-size:16px;font-weight:800">' + esc(o.customer_name || '散客') + '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:4px">' + esc(o.order_no) + ' · ' + esc(o.bill_date) + '</div>' +
            (o.remark ? '<div class="detail-remark">' + esc(o.remark) + '</div>' : '') + '</div>' +
          '<div class="detail-badges"><span class="pill ' + (voided ? 'pill-red' : 'pill-green') + '">' + (voided ? '已作废' : '正常') + '</span>' +
            (Number(o.is_return) === 1 ? '<span class="pill pill-orange">退货</span>' : '') + '</div></div>' +
          '<div class="detail-total" style="margin-top:14px">￥' + money(o.total_amount) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:3px">' + num(o.item_count) + ' 行 · 共 ' + num(o.total_qty) + '</div></div>' +
        '<div class="detail-rows">' + (o.items || []).map((it) => (
          '<div class="detail-row"><div class="detail-row-top"><span class="detail-row-name">' + esc(it.goods_name) + '</span>' +
            '<span class="detail-row-amount">￥' + money(it.amount) + '</span></div>' +
            '<div class="detail-row-sub"><span>' + (displaySpec(it) ? esc(displaySpec(it)) + ' · ' : '') + esc(it.unit) + ' × ' + num(it.qty) + '</span>' +
            '<span>单价 ￥' + money(it.price) + '</span></div>' +
            ((it.make_date || it.exp_date) ? '<div class="detail-row-date">生产 ' + esc(it.make_date || '-') + ' · 保质至 ' + esc(it.exp_date || '-') + '</div>' : '') +
          '</div>'
        )).join('') + '</div>' +
        '<div class="sheet-actions">' +
          (voided ? '' : '<button class="btn btn-ghost" onclick="Mobile.editOrder(' + o.id + ')">修改</button>') +
          (voided ? '' : '<button class="btn btn-danger" onclick="Mobile.voidOrder(' + o.id + ')">作废</button>') +
          '<button class="btn btn-primary" onclick="Mobile.closeSheet()">关闭</button>' +
        '</div>';
    } catch (e) {
      $('sheetBody').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }
  async function editOrder(id) {
    closeSheet();
    try {
      setLoading(true);
      const o = await api('/orders/' + id);
      if (!M.allGoods.length) {
        const names = Array.from(new Set((o.items || []).map((it) => it.goods_name).filter(Boolean)));
        const sets = await Promise.all(names.map((name) => api('/goods/specs?name=' + encodeURIComponent(name)).catch(() => ({ items: [] }))));
        M.allGoods = sets.flatMap((s) => s.items || []);
      }
      M.editingOrderId = o.id;
      M.editingOrder = o;
      M.saleDate = o.bill_date || today();
      M.saleRemark = o.remark || '';
      M.saleReturn = Number(o.is_return) === 1;
      M.customer = o.user_id ? {
        id: o.user_id, customer_no: o.customer_no, name: o.customer_name, addr: o.customer_addr, tel: o.customer_tel
      } : null;
      await loadCustomerPrices();
      M.cart = (o.items || []).map((it) => {
        const goods = findGoods(it.goods_id) || {};
        return {
          goods_id: it.goods_id,
          code: it.goods_code,
          name: it.goods_name,
          spec: it.spec,
          baseUnit: goods.base_unit || it.unit,
          units: clone(goods.units || []),
          unit: it.unit,
          factor: Number(it.unit_factor || 1),
          qty: Number(it.qty),
          price: Number(it.price),
          amount: Number(it.amount),
          shelfLifeDays: Number(goods.shelf_life_days || 0),
          makeDate: it.make_date || '',
          expDate: it.exp_date || '',
          expireManual: !!(it.exp_date && it.make_date)
        };
      });
      go('sale');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }
  async function voidOrder(id) {
    if (!confirm('确定作废这张订单？作废后保留单据，但不可再编辑。')) return;
    try {
      await api('/orders/' + id + '/void', { method: 'POST' });
      closeSheet();
      toast('订单已作废', 'ok');
      if (M.page === 'orders') loadOrderList($('orderKw') ? $('orderKw').value : '');
      await loadStats();
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- 客户管理 ---------------- */
  async function renderCustomers(content) {
    await loadCustomers(true);
    content.innerHTML =
      '<div class="page-head"><div><h1>客户</h1><p>共 ' + M.customers.length + ' 位客户，价格与地址随单带出</p></div>' +
        '<button class="head-action" type="button" onclick="Mobile.openCustomerEdit(null)">＋ 新增</button></div>' +
      '<div class="search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input id="customerKw" placeholder="搜索客户名称 / 编号 / 电话" autocomplete="off"></div>' +
      '<div id="customerList" class="customer-list"></div>';
    const input = $('customerKw');
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      const list = M.customers.filter((c) => !q || String(c.name || '').toLowerCase().includes(q) ||
        String(c.customer_no || '').includes(q) || String(c.tel || '').includes(q));
      $('customerList').innerHTML = list.length ? list.map((c) => (
        '<button class="customer-card" style="width:100%;text-align:left" onclick="Mobile.openCustomerEdit(\'' + escapeAttr(c.id) + '\')">' +
          '<div class="customer-ava">' + esc(String(c.name || '客').slice(0, 1)) + '</div>' +
          '<div class="customer-main"><div class="customer-name">' + esc(c.name) + '</div>' +
            '<div class="customer-sub">#' + esc(c.customer_no || '-') + ' · ' + esc(c.tel || c.addr || '暂无联系方式') + '</div></div>' +
          '<div class="customer-side"><div class="customer-total">￥' + money(c.total_amount) + '</div><div class="customer-orders">' + num(c.order_count) + ' 单</div></div>' +
        '</button>'
      )).join('') : '<div class="empty"><span class="empty-icon">👤</span>没有匹配的客户</div>';
    };
    input.addEventListener('input', paint);
    paint();
  }
  function openCustomerEdit(id) {
    const c = id ? findCustomer(id) : null;
    openSheet(c ? '编辑客户' : '新增客户',
      '<form class="sheet-form" id="customerForm">' +
        '<label class="field-label">客户名称 *</label><input class="input" id="cfName" value="' + esc(c && c.name) + '" placeholder="例如：小朱">' +
        '<label class="field-label">客户编号</label><input class="input" id="cfNo" value="' + esc(c && c.customer_no) + '" readonly placeholder="由系统自动生成">' +
        '<label class="field-label">联系电话</label><input class="input" id="cfTel" type="tel" value="' + esc(c && c.tel) + '" placeholder="手机号">' +
        '<label class="field-label">地址</label><input class="input" id="cfAddr" value="' + esc(c && c.addr) + '" placeholder="收货地址">' +
        '<label class="field-label">备注</label><input class="input" id="cfRemark" value="' + esc(c && c.remark) + '" placeholder="选填">' +
      '</form>' +
      '<div class="sheet-actions"><button class="btn btn-ghost" onclick="Mobile.closeSheet()">取消</button>' +
        '<button class="btn btn-primary" onclick="Mobile.saveCustomer(\'' + (c ? escapeAttr(c.id) : '') + '\')">保存</button></div>');
  }
  async function saveCustomer(id) {
    const name = $('cfName').value.trim();
    if (!name) return toast('客户名称不能为空', 'err');
    const body = {
      name,
      addr: $('cfAddr').value.trim(),
      tel: $('cfTel').value.trim(),
      remark: $('cfRemark').value.trim()
    };
    try {
      if (id) await api('/customers/' + encodeURIComponent(id), { method: 'PUT', body });
      else await api('/customers', { method: 'POST', body });
      closeSheet();
      M.customers = [];
      await loadCustomers();
      toast(id ? '客户已更新' : '客户已新增', 'ok');
      if (M.page === 'customers') go('customers');
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- 商品 ---------------- */
  async function renderGoods(content) {
    content.innerHTML =
      '<div class="page-head"><div><h1>商品资料</h1><p>可新增、改价、改包装；点“开单”直接加入单据</p></div>' +
        '<button class="head-action" type="button" onclick="Mobile.openGoodsForm()">＋ 商品</button></div>' +
      '<div class="search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input id="goodsKw" placeholder="搜索商品名称 / 编码" autocomplete="off"></div>' +
      '<div id="goodsList" class="goods-list"><div class="loading-inline">加载中…</div></div>';
    let timer = null;
    const input = $('goodsKw');
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadGoodsList(input.value.trim()), 300); });
    await loadGoodsList('');
  }
  async function loadGoodsList(kw) {
    try {
      const data = await api('/goods?kw=' + encodeURIComponent(kw || '') + '&page=1&page_size=500');
      const items = data.items || [];
      if (!kw) { M.allGoods = items; }
      M.goods = items;
      const box = $('goodsList');
      box.innerHTML = items.length ? items.map((g, i) => {
        const price = referencePrice(g);
        const spec = String(g.spec || '').trim();
        const specText = spec && spec !== '无规格' ? spec : '无规格';
        const units = (g.units || []).map((u) => u.unit).filter(Boolean);
        const life = Number(g.shelf_life_days) > 0 ? num(g.shelf_life_days) + ' 天' : '';
        return '<div class="goods-card"><div class="goods-top"><span class="goods-code">' + esc(g.code) + '</span>' +
          '<div class="goods-name">' + esc(g.name) + '</div>' +
          '<div class="goods-actions"><button class="goods-edit" type="button" onclick="Mobile.openGoodsForm(' + i + ')">编辑</button>' +
          '<button class="goods-del" type="button" onclick="Mobile.deleteGoods(' + i + ')">删除</button>' +
          '<button class="goods-add" type="button" onclick="Mobile.addFromGoods(' + i + ')">开单</button></div></div>' +
          '<div class="goods-spec">' + esc(specText) + (life ? ' · 保质 ' + life : '') + '</div>' +
          '<div class="goods-foot"><span class="unit-chips">' + (units.length ? units.map((u) => '<em>' + esc(u) + '</em>').join('') : '<em>' + esc(g.base_unit || g.unit || '件') + '</em>') + '</span>' +
            '<span class="goods-price">' + (price > 0 ? '￥' + money(price) + '<small>/' + esc(g.base_unit || g.unit || '件') + '</small>' : '<span class="goods-unpriced">未定价</span>') + '</span></div></div>';
      }).join('') : '<div class="empty"><span class="empty-icon">📦</span>没有匹配的商品</div>';
    } catch (e) {
      $('goodsList').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }
  function addFromGoods(index) {
    const g = (M.goods || [])[index];
    if (!g) return;
    addGoodsToCart(g);
    go('sale');
  }
  async function deleteGoods(index) {
    const g = (M.goods || [])[index];
    if (!g) return;
    const tip = '确定删除商品“' + g.name + '”（' + g.code + '）？\n\n' +
      '没有历史单据的商品会彻底删除并释放编码；有历史单据的商品只停用，编码和单据保留。';
    if (!confirm(tip)) return;
    try {
      const result = await api('/goods/' + g.id, { method: 'DELETE' });
      toast(result.message || (result.deleted ? '商品已删除' : '商品已停用'), result.deleted ? 'ok' : 'warn');
      M.allGoods = [];
      const kw = $('goodsKw') ? $('goodsKw').value.trim() : '';
      await loadGoodsList(kw);
    } catch (e) {
      toast(e.message, 'err');
    }
  }
  function referencePrice(g) {
    if (g.default_price !== null && g.default_price !== undefined) return Number(g.default_price);
    const u = (g.units || []).find((x) => x.is_base);
    return Number((u && u.price) || 0);
  }
  function shelfPartsFromDays(days) {
    const value = Number(days || 0);
    if (!value || value <= 0) return { value: '', unit: 'day' };
    if (value % 365 === 0) return { value: value / 365, unit: 'year' };
    if (value % 30 === 0) return { value: value / 30, unit: 'month' };
    return { value: value, unit: 'day' };
  }
  function shelfDaysFromInput(value, unit) {
    const num = Number(value || 0);
    if (!num || num <= 0) return 0;
    if (unit === 'year') return Math.round(num * 365);
    if (unit === 'month') return Math.round(num * 30);
    return Math.round(num);
  }
  function goodsPackRowHtml(unit, factor) {
    return '<div class="pack-row">' +
      '<input class="input pack-unit" value="' + esc(unit || '') + '" placeholder="袋 / 箱 / 件" oninput="Mobile.markGoodsBaseChips();Mobile.syncGoodsPrice()">' +
      '<span class="pack-eq">=</span>' +
      '<input class="input pack-factor" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(factor || '') + '" placeholder="数量" oninput="Mobile.syncGoodsPrice()">' +
      '<span class="pack-base">' + esc($('goodsBaseUnit') ? $('goodsBaseUnit').value : '') + '</span>' +
      '<button class="pack-del" type="button" aria-label="删除包装" onclick="Mobile.removeGoodsPackRow(this)">×</button>' +
      '</div>';
  }
  function openGoodsForm(index) {
    const g = (typeof index === 'number' && M.goods) ? M.goods[index] : null;
    const baseUnit = g ? (g.base_unit || g.unit || '件') : '件';
    const allUnits = (g && g.units) || [];
    const packs = allUnits.filter((u) => u.unit !== baseUnit && Number(u.factor) > 1);
    const maxPack = packs.reduce((a, b) => (!a || Number(b.factor) > Number(a.factor)) ? b : a, null);
    const baseUnitRow = allUnits.find((u) => u.is_base || u.unit === baseUnit);
    const basePrice = g
      ? (g.default_price !== null && g.default_price !== undefined ? Number(g.default_price) : (baseUnitRow && baseUnitRow.price !== null && baseUnitRow.price !== undefined ? Number(baseUnitRow.price) : null))
      : null;
    const casePrice = g
      ? (maxPack
        ? (maxPack.price !== null && maxPack.price !== undefined ? Number(maxPack.price) : (basePrice !== null ? round4(basePrice * Number(maxPack.factor)) : null))
        : basePrice)
      : null;
    const shelf = shelfPartsFromDays(g ? g.shelf_life_days : 0);
    const code = g ? g.code : '';
    const commonUnits = ['kg', '袋', '包', '瓶', '件', '盒', '箱'];
    openSheet(g ? '编辑商品' : '新增商品',
      '<div class="goods-form">' +
        '<div class="form-intro"><div class="form-intro-icon">' + (g ? '✎' : '＋') + '</div>' +
          '<div><b>' + (g ? '修改商品资料' : '建立新商品') + '</b><span>' + (g ? '保存后立即同步到开单页' : '编码由系统自动分配，不用手填') + '</span></div></div>' +
        '<div class="form-section">' +
          '<div class="form-section-head"><b>基础信息</b><span>品名必填</span></div>' +
          '<label class="field-label">商品编码</label>' +
          '<input class="input code-input" id="goodsCode" value="' + esc(code) + '" readonly placeholder="保存后自动分配">' +
          '<label class="field-label">品名 <i>*</i></label>' +
          '<input class="input" id="goodsName" value="' + esc(g ? g.name : '') + '" placeholder="例如 金苗K1小米" autocomplete="off">' +
          '<div class="form-row">' +
            '<div><label class="field-label">规格</label><input class="input" id="goodsSpec" value="' + esc(g ? (g.spec || '') : '') + '" placeholder="如 24kg/袋，可留空"></div>' +
            '<div><label class="field-label">分类</label><input class="input" id="goodsCategory" value="' + esc(g ? (g.category || '') : '') + '" placeholder="选填"></div>' +
          '</div>' +
        '</div>' +
        '<div class="form-section">' +
          '<div class="form-section-head"><b>单位与包装</b><span>先定最小单位，再加包装</span></div>' +
          '<label class="field-label">最小单位 <i>*</i></label>' +
          '<input class="input" id="goodsBaseUnit" value="' + esc(baseUnit) + '" placeholder="kg / 袋 / 瓶 / 件" oninput="Mobile.markGoodsBaseChips();Mobile.syncGoodsPrice()">' +
          '<div class="unit-options" id="goodsBaseChips">' + commonUnits.map((u) => '<button class="unit-chip' + (u === baseUnit ? ' is-active' : '') + '" type="button" onclick="Mobile.setGoodsBaseUnit(\'' + escapeAttr(u) + '\')">' + esc(u) + '</button>').join('') + '</div>' +
          '<label class="field-label">包装换算</label>' +
          '<div class="form-tip">单包装商品不用添加。有袋/箱/件时，填“1 个包装 = 多少最小单位”，例如 袋 = 24 kg。</div>' +
          '<div id="goodsPackRows">' + (packs.length ? packs.map((p) => goodsPackRowHtml(p.unit, Number(p.factor))).join('') : '') + '</div>' +
          '<button class="add-pack-btn" type="button" onclick="Mobile.addGoodsPackRow()"><span>＋</span> 添加包装单位</button>' +
          '<div class="form-error" id="goodsPackError"></div>' +
        '</div>' +
        '<div class="price-card">' +
          '<div class="price-card-head"><span id="goodsPriceLabel">整件价</span><span class="price-card-badge">参考售价</span></div>' +
          '<div class="goods-price-row"><span>￥</span><input id="goodsCasePrice" type="number" inputmode="decimal" min="0" step="0.01" value="' + (casePrice === null ? '' : esc(Math.round(casePrice * 100) / 100)) + '" placeholder="0.00" oninput="Mobile.syncGoodsPrice()"><em id="goodsCaseSuffix">/' + esc(maxPack ? maxPack.unit : baseUnit) + '</em></div>' +
          '<div class="price-convert"><span id="goodsCaseFormula">' + (maxPack ? '1 ' + esc(maxPack.unit) + ' = ' + Number(maxPack.factor) + ' ' + esc(baseUnit) : '按最小单位录入') + '</span>' +
            '<b>最小单价 <i id="goodsMinPrice">￥—</i></b></div>' +
          '<div class="price-note">修改这里只影响商品建议价，客户历史价格记忆不会被改动。</div>' +
        '</div>' +
        '<div class="form-section">' +
          '<div class="form-section-head"><b>保质期</b><span>选填，用于自动推算保质期至</span></div>' +
          '<div class="form-row shelf-row">' +
            '<div><label class="field-label">保质时长</label><input class="input" id="goodsShelfLife" type="number" inputmode="numeric" min="0" step="1" value="' + esc(shelf.value) + '" placeholder="如 12"></div>' +
            '<div><label class="field-label">单位</label><select class="input" id="goodsShelfUnit"><option value="day"' + (shelf.unit === 'day' ? ' selected' : '') + '>天</option><option value="month"' + (shelf.unit === 'month' ? ' selected' : '') + '>个月</option><option value="year"' + (shelf.unit === 'year' ? ' selected' : '') + '>年</option></select></div>' +
          '</div>' +
        '</div>' +
        '<input type="hidden" id="goodsFormId" value="' + (g ? g.id : '') + '">' +
        '<input type="hidden" id="goodsDefaultSale" value="' + esc(g ? (g.default_sale_unit || baseUnit) : baseUnit) + '">' +
        '<input type="hidden" id="goodsDefaultPurchase" value="' + esc(g ? (g.default_purchase_unit || (maxPack ? maxPack.unit : baseUnit)) : (maxPack ? maxPack.unit : baseUnit)) + '">' +
        '<div class="sheet-actions goods-form-actions">' +
          '<button class="btn btn-ghost" type="button" onclick="Mobile.closeSheet()">取消</button>' +
          '<button class="btn btn-primary" id="goodsSaveBtn" type="button" onclick="Mobile.saveGoodsForm()">' + (g ? '保存修改' : '保存商品') + '</button>' +
        '</div>' +
      '</div>');
    syncGoodsPrice();
  }
  function setGoodsBaseUnit(unit) {
    const input = $('goodsBaseUnit');
    if (input) input.value = unit;
    markGoodsBaseChips();
    syncGoodsPrice();
  }
  function markGoodsBaseChips() {
    const base = String(($('goodsBaseUnit') && $('goodsBaseUnit').value) || '').trim();
    document.querySelectorAll('#goodsBaseChips .unit-chip').forEach((chip) => {
      chip.classList.toggle('is-active', chip.textContent.trim() === base);
    });
    document.querySelectorAll('#goodsPackRows .pack-base').forEach((el) => { el.textContent = base || '单位'; });
  }
  function addGoodsPackRow() {
    const rows = $('goodsPackRows');
    if (!rows) return;
    rows.insertAdjacentHTML('beforeend', goodsPackRowHtml('', ''));
    const inputs = rows.querySelectorAll('.pack-unit');
    if (inputs.length) inputs[inputs.length - 1].focus();
    syncGoodsPrice();
  }
  function removeGoodsPackRow(btn) {
    const row = btn && btn.closest ? btn.closest('.pack-row') : null;
    if (row) row.remove();
    syncGoodsPrice();
  }
  function readGoodsPackRows() {
    const rows = Array.from(document.querySelectorAll('#goodsPackRows .pack-row'));
    return rows.map((row) => ({
      unit: String((row.querySelector('.pack-unit') || {}).value || '').trim(),
      factor: Number((row.querySelector('.pack-factor') || {}).value || 0)
    })).filter((r) => r.unit || r.factor);
  }
  function syncGoodsPrice() {
    const base = String(($('goodsBaseUnit') && $('goodsBaseUnit').value) || '').trim();
    const rows = readGoodsPackRows();
    const errorBox = $('goodsPackError');
    const priceInput = $('goodsCasePrice');
    if (!priceInput) return;
    let err = '';
    const valid = [];
    rows.forEach((r) => {
      if (!r.unit) err = err || '包装单位不能为空';
      else if (r.unit === base) err = err || '包装单位不能和最小单位相同';
      else if (valid.some((v) => v.unit === r.unit)) err = err || '包装单位不能重复';
      else if (!(r.factor > 1)) err = err || '包装数量必须大于 1';
      else valid.push(r);
    });
    const maxPack = valid.reduce((a, b) => (!a || b.factor > a.factor) ? b : a, null);
    if (errorBox) { errorBox.textContent = err; errorBox.classList.toggle('show', !!err); }
    document.querySelectorAll('#goodsPackRows .pack-base').forEach((el) => { el.textContent = base || '单位'; });
    const factor = maxPack ? maxPack.factor : 1;
    const label = $('goodsPriceLabel');
    const suffix = $('goodsCaseSuffix');
    const formula = $('goodsCaseFormula');
    const mode = maxPack ? '整件价' : '参考价';
    if (label) label.textContent = mode;
    if (suffix) suffix.textContent = '/' + (maxPack ? maxPack.unit : (base || '件'));
    if (formula) formula.textContent = maxPack ? ('1 ' + maxPack.unit + ' = ' + round4(factor) + ' ' + (base || '单位')) : ('按最小单位 ' + (base || '件') + ' 录入');
    const raw = String(priceInput.value || '').trim();
    const casePrice = raw === '' ? null : Number(raw);
    const minPrice = casePrice !== null && Number.isFinite(casePrice) ? round4(casePrice / factor) : null;
    const minEl = $('goodsMinPrice');
    if (minEl) minEl.textContent = minPrice === null ? '￥—' : '￥' + minPrice + ' / ' + (base || '件');
    return { base, rows, valid, maxPack, factor, casePrice, minPrice, error: err };
  }
  async function saveGoodsForm() {
    const data = syncGoodsPrice();
    const name = String(($('goodsName') && $('goodsName').value) || '').trim();
    if (!name) { toast('品名必填', 'err'); $('goodsName').focus(); return; }
    if (!data.base) { toast('最小单位必填', 'err'); $('goodsBaseUnit').focus(); return; }
    if (data.error) { toast(data.error, 'err'); return; }
    if (data.casePrice !== null && (!Number.isFinite(data.casePrice) || data.casePrice < 0)) {
      toast('价格格式不正确', 'err'); return;
    }
    const id = String((($('goodsFormId') || {}).value) || '');
    const units = [{ unit: data.base, factor: 1, price: data.minPrice }];
    data.valid.forEach((r) => {
      units.push({ unit: r.unit, factor: r.factor, price: data.minPrice === null ? null : round4(data.minPrice * r.factor) });
    });
    const unitNames = units.map((u) => u.unit);
    const savedSaleUnit = String((($('goodsDefaultSale') || {}).value) || '');
    const savedPurchaseUnit = String((($('goodsDefaultPurchase') || {}).value) || '');
    const defaultSaleUnit = unitNames.includes(savedSaleUnit) ? savedSaleUnit : data.base;
    const defaultPurchaseUnit = unitNames.includes(savedPurchaseUnit) ? savedPurchaseUnit : (data.maxPack ? data.maxPack.unit : data.base);
    const body = {
      code: id ? String((($('goodsCode') || {}).value) || '') : '',
      name,
      spec: String((($('goodsSpec') || {}).value) || '').trim(),
      unit: data.base,
      base_unit: data.base,
      default_sale_unit: defaultSaleUnit,
      default_purchase_unit: defaultPurchaseUnit,
      units,
      category: String((($('goodsCategory') || {}).value) || '').trim(),
      shelf_life_days: shelfDaysFromInput(($('goodsShelfLife') || {}).value, ($('goodsShelfUnit') || {}).value),
      default_price: data.minPrice
    };
    const btn = $('goodsSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      const saved = await api(id ? ('/goods/' + id) : '/goods', { method: id ? 'PUT' : 'POST', body });
      closeSheet();
      go('goods');
      toast(id ? '商品已更新；客户价格记忆未改动' : '商品已新增，编码 ' + (saved.code || ''), 'ok');
    } catch (e) {
      toast(e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = id ? '保存修改' : '保存商品'; }
    }
  }

  /* ---------------- 进货 ---------------- */
  async function renderPurchases(content) {
    content.innerHTML =
      '<div class="page-head"><div><h1>进货管理</h1><p>查看入库单、单价与批次效期</p></div>' +
        '<button class="head-action" type="button" onclick="Mobile.startPurchase()">＋ 进货</button></div>' +
      '<div id="purchaseList"><div class="loading-inline">加载中…</div></div>';
    await loadPurchaseList();
  }
  async function loadPurchaseList() {
    try {
      const data = await api('/purchases?page=1&page_size=50');
      const items = data.items || [];
      $('purchaseList').innerHTML = items.length ? '<div class="order-list">' + items.map((p) => (
        '<button class="order-card" type="button" onclick="Mobile.openPurchaseDetail(' + p.id + ')">' +
          '<div class="order-head"><span class="order-no">' + esc(p.purchase_no) + '</span>' +
          '<span class="pill ' + (Number(p.is_void) === 1 ? 'pill-red' : 'pill-blue') + '">' + (Number(p.is_void) === 1 ? '已作废' : '已入库') + '</span></div>' +
          '<div class="order-customer">' + esc(p.supplier || '未填供应商') + '</div>' +
          '<div class="order-meta"><span class="order-sub">' + esc(p.bill_date) + ' · ' + num(p.item_count) + ' 行</span>' +
            '<span class="order-total">￥' + money(p.total_amount) + ' <span class="order-chev">›</span></span></div></button>'
      )).join('') + '</div>' : '<div class="empty"><span class="empty-icon">📥</span>暂无进货单</div>';
    } catch (e) {
      $('purchaseList').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }
  async function openPurchaseDetail(id) {
    openSheet('进货单详情', '<div class="loading-inline">加载中…</div>');
    try {
      const p = await api('/purchases/' + id);
      const voided = Number(p.is_void) === 1;
      $('sheetBody').innerHTML =
        '<div class="detail-hero"><div style="display:flex;justify-content:space-between;align-items:flex-start">' +
          '<div><div style="font-size:16px;font-weight:800">' + esc(p.supplier || '未填供应商') + '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:4px">' + esc(p.purchase_no) + ' · ' + esc(p.bill_date) + '</div></div>' +
          '<span class="pill ' + (voided ? 'pill-red' : 'pill-blue') + '">' + (voided ? '已作废' : '已入库') + '</span></div>' +
          '<div class="detail-total" style="margin-top:14px">￥' + money(p.total_amount) + '</div></div>' +
        '<div class="detail-rows">' + (p.items || []).map((it) => (
          '<div class="detail-row"><div class="detail-row-top"><span class="detail-row-name">' + esc(it.goods_name) + '</span>' +
            '<span class="detail-row-amount">￥' + money(it.amount) + '</span></div>' +
            '<div class="detail-row-sub"><span>' + esc(it.unit) + ' × ' + num(it.qty) + '</span><span>进价 ￥' + money(it.price) + '</span></div>' +
            ((it.make_date || it.exp_date) ? '<div class="detail-row-date">生产 ' + esc(it.make_date || '-') + ' · 保质至 ' + esc(it.exp_date || '-') + '</div>' : '') +
          '</div>'
        )).join('') + '</div>' +
        '<div class="sheet-actions">' +
          (voided ? '' : '<button class="btn btn-danger" onclick="Mobile.voidPurchase(' + p.id + ')">作废</button>') +
          '<button class="btn btn-primary" onclick="Mobile.closeSheet()">关闭</button></div>';
    } catch (e) { $('sheetBody').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }
  async function voidPurchase(id) {
    if (!confirm('确定作废这张进货单？库存与效期将同步回退。')) return;
    try {
      await api('/purchases/' + id + '/void', { method: 'POST' });
      closeSheet();
      toast('进货单已作废', 'ok');
      await loadPurchaseList();
      await loadStats();
    } catch (e) { toast(e.message, 'err'); }
  }
  function newPurchaseItem(item, unit) {
    const units = item.units || [];
    const unitRow = units.find((u) => u.unit === unit) || {};
    return {
      goods_id: Number(item.goods_id || item.id), code: item.code, name: item.name, spec: item.spec,
      baseUnit: item.base_unit || '',
      units: clone(units), unit,
      qty: 1, price: Number(unitRow.purchase_price || 0),
      makeDate: '', expDate: '',
      shelfLifeDays: Number(item.shelf_life_days || 0)
    };
  }
  async function startPurchase() {
    try {
      const data = await api('/purchases/next-no');
      M.purchaseDraft = { no: data.purchase_no, supplier: '', date: today(), items: [] };
      M.purchaseNo = data.purchase_no;
      M.purchaseSupplier = '';
      M.purchaseDate = today();
      renderPurchaseDraft();
    } catch (e) { toast(e.message, 'err'); }
  }
  function renderPurchaseDraft() {
    const d = M.purchaseDraft;
    if (!d) return;
    document.body.classList.add('page-sale');
    $('pageContent').innerHTML =
      '<div class="sale-head"><div><div class="sale-kicker">PURCHASE</div><h1>新增进货</h1>' +
        '<p>选择商品，填写数量、整件进价与生产日期</p></div>' +
        '<div class="sale-head-side"><span class="pill pill-blue">入库</span><div class="order-no">' + esc(d.no) + '</div></div></div>' +
      '<div class="sale-meta-card">' +
        '<div class="date-line"><span class="meta-label">供应商</span>' +
          '<input class="inline-date" id="purchaseSupplier" value="' + esc(d.supplier) + '" placeholder="供应商名称" style="text-align:left"></div>' +
        '<div class="meta-divider"></div>' +
        '<div class="date-line"><span class="meta-label">进货日期</span>' +
          '<input class="inline-date" type="date" id="purchaseDate" value="' + esc(d.date) + '"></div>' +
      '</div>' +
      '<div class="search-box sale-search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input id="purchaseSearch" placeholder="搜索商品，添加进货明细" autocomplete="off">' +
        '<span class="search-add">添加</span></div>' +
      '<div id="purchaseSearchResults"></div>' +
      '<div id="purchaseCartWrap"></div>' +
      '<div class="sale-dock">' +
        '<div class="dock-total"><span>进货合计 <em id="purchaseDockCount">0 项</em></span>' +
          '<b><small>￥</small><span id="purchaseDockTotal">' + money(purchaseTotal()) + '</span></b></div>' +
        '<div class="dock-actions"><button class="btn btn-ghost" type="button" onclick="Mobile.backToPurchases()">返回</button>' +
          '<button class="btn btn-primary" type="button" onclick="Mobile.savePurchase()">保存进货</button></div>' +
      '</div>';
    const input = $('purchaseSearch');
    input.addEventListener('input', () => {
      clearTimeout(M.searchTimer);
      const kw = input.value.trim();
      if (!kw) { $('purchaseSearchResults').innerHTML = ''; return; }
      M.searchTimer = setTimeout(() => searchPurchaseGoods(kw), 280);
    });
    $('purchaseSupplier').addEventListener('change', (e) => { d.supplier = e.target.value; });
    $('purchaseDate').addEventListener('change', (e) => { d.date = e.target.value; });
    updatePurchaseDraft();
  }
  async function searchPurchaseGoods(kw) {
    const box = $('purchaseSearchResults');
    box.innerHTML = '<div class="search-results"><div class="loading-inline">搜索中…</div></div>';
    try {
      const data = await api('/goods/names?kw=' + encodeURIComponent(kw) + '&limit=20');
      box.innerHTML = '<div class="search-results">' + ((data.items || []).length ? data.items.map((g) => (
        '<button class="search-result-row" onclick="Mobile.pickPurchaseName(\'' + escapeAttr(g.name) + '\')">' +
          '<div class="sr-main"><div class="sr-name">' + esc(g.name) + '</div><div class="sr-sub">' + num(g.spec_count) + ' 规格 · ' + esc(g.sample_code || '') + '</div></div>' +
          '<span class="sr-add">＋</span></button>'
      )).join('') : '<div class="loading-inline">没有匹配商品</div>') + '</div>';
    } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }
  async function pickPurchaseName(name) {
    try {
      const data = await api('/goods/specs?name=' + encodeURIComponent(name));
      const items = data.items || [];
      if (items.length === 1) { addPurchaseItem(items[0]); return; }
      window.__purchaseSpecs = items;
      openSheet('选择进货规格', '<div class="sheet-list">' + items.map((it, i) => (
        '<button class="sheet-item" onclick="Mobile.choosePurchaseSpec(' + i + ')">' +
          '<div class="main"><div class="title">' + esc(it.spec || '无规格') + '</div><div class="sub">' + esc(it.code) + ' · 默认 ' + esc(it.default_purchase_unit || it.base_unit) + '</div></div>' +
          '<span class="sr-add">＋</span></button>'
      )).join('') + '</div>');
    } catch (e) { toast(e.message, 'err'); }
  }
  function choosePurchaseSpec(i) {
    const item = (window.__purchaseSpecs || [])[i];
    closeSheet();
    if (item) addPurchaseItem(item);
  }
  function addPurchaseItem(item) {
    const unit = item.default_purchase_unit || item.base_unit || item.unit;
    M.purchaseDraft.items.push(newPurchaseItem(item, unit));
    $('purchaseSearch').value = '';
    $('purchaseSearchResults').innerHTML = '';
    updatePurchaseDraft();
    toast('已添加 ' + item.name, 'ok');
  }
  function purchaseTotal() { return M.purchaseDraft ? M.purchaseDraft.items.reduce((s, r) => s + num(r.qty) * num(r.price), 0) : 0; }
  function updatePurchaseDraft() {
    const wrap = $('purchaseCartWrap');
    if (!wrap || !M.purchaseDraft) return;
    const items = M.purchaseDraft.items;
    wrap.innerHTML = items.length ? '<div class="cart-list">' + items.map((r, i) => (
      '<div class="cart-card"><div class="cart-top"><div class="cart-main"><div class="cart-name">' + esc(r.name) + '</div>' +
        '<div class="cart-spec">' + (displaySpec(r) ? esc(displaySpec(r)) + ' · ' : '') + esc(r.code) + '</div></div>' +
        '<button class="cart-del" type="button" onclick="Mobile.removePurchaseItem(' + i + ')">×</button></div>' +
        '<div class="cart-controls">' +
          '<select class="unit-select" onchange="Mobile.setPurchaseUnit(' + i + ',this.value)">' +
            (r.units.length ? r.units.map((u) => '<option value="' + esc(u.unit) + '"' + (u.unit === r.unit ? ' selected' : '') + '>' + esc(u.unit) + '</option>').join('') : '<option>' + esc(r.unit) + '</option>') +
          '</select>' +
          '<div class="qty-box"><button class="qty-btn" type="button" onclick="Mobile.stepPurchaseQty(' + i + ',-1)">−</button>' +
            '<input class="qty-input" type="number" inputmode="decimal" step="0.01" value="' + esc(r.qty) + '" onchange="Mobile.setPurchaseQty(' + i + ',this.value)">' +
            '<button class="qty-btn" type="button" onclick="Mobile.stepPurchaseQty(' + i + ',1)">＋</button></div>' +
          '<div class="price-box"><div class="price-label">进价 / ' + esc(r.unit) + '</div>' +
            '<input class="price-input" type="number" inputmode="decimal" step="0.01" value="' + esc(r.price) + '" onchange="Mobile.setPurchasePrice(' + i + ',this.value)"></div></div>' +
        '<div class="cart-exp">' +
          '<label class="exp-field"><span>生产日期</span><input type="date" value="' + esc(r.makeDate || '') + '" onchange="Mobile.setPurchaseMakeDate(' + i + ',this.value)"></label>' +
          '<label class="exp-field"><span>保质期至（自动）</span><input type="date" value="' + esc(r.expDate || '') + '" readonly></label>' +
        '</div>' +
        '<div class="cart-bottom"><span>' + esc(r.qty) + ' ' + esc(r.unit) + ' × ￥' + money(r.price) + '</span>' +
          '<span class="cart-amount">￥' + money(num(r.qty) * num(r.price)) + '</span></div>' +
      '</div>'
    )).join('') + '</div>' : '<div class="cart-empty"><div class="cart-empty-icon"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg></div><div class="txt">还没有进货商品<br><span>在上方搜索商品并选择规格</span></div></div>';
    const total = $('purchaseDockTotal');
    const count = $('purchaseDockCount');
    if (total) total.textContent = money(purchaseTotal());
    if (count) count.textContent = items.length + ' 项';
  }
  function removePurchaseItem(i) { M.purchaseDraft.items.splice(i, 1); updatePurchaseDraft(); }
  function setPurchaseQty(i, v) { M.purchaseDraft.items[i].qty = Math.max(0, round4(v)); updatePurchaseDraft(); }
  function stepPurchaseQty(i, d) { const r = M.purchaseDraft.items[i]; r.qty = Math.max(0, round4(num(r.qty) + d)); updatePurchaseDraft(); }
  function setPurchasePrice(i, v) { M.purchaseDraft.items[i].price = Math.max(0, round4(v)); updatePurchaseDraft(); }
  function setPurchaseUnit(i, unit) {
    const r = M.purchaseDraft.items[i];
    const oldFactor = Number(((r.units || []).find((u) => u.unit === r.unit) || {}).factor || 1);
    const newFactor = Number(((r.units || []).find((u) => u.unit === unit) || {}).factor || 1);
    if (oldFactor > 0 && newFactor > 0 && num(r.price) > 0) r.price = round4(num(r.price) / oldFactor * newFactor);
    r.unit = unit;
    updatePurchaseDraft();
  }
  function setPurchaseMakeDate(i, v) {
    const r = M.purchaseDraft.items[i];
    r.makeDate = v;
    r.expDate = r.shelfLifeDays > 0 ? addDays(v, r.shelfLifeDays) : '';
    updatePurchaseDraft();
  }
  async function savePurchase() {
    const d = M.purchaseDraft;
    if (!d || !d.items.length) return toast('请先添加进货商品', 'err');
    try {
      setLoading(true);
      const result = await api('/purchases', {
        method: 'POST',
        body: {
          purchase_no: d.no,
          supplier: d.supplier || '',
          bill_date: d.date,
          remark: '',
          items: d.items.map((r) => ({
            goods_id: r.goods_id, goods_code: r.code, goods_name: r.name, spec: displaySpec(r),
            unit: r.unit, qty: Number(r.qty), price: Number(r.price),
            make_date: r.makeDate || null, exp_date: r.expDate || null, remark: ''
          }))
        }
      });
      toast('进货单已保存 ￥' + money(result.total_amount), 'ok');
      M.purchaseDraft = null;
      go('purchases');
    } catch (e) { toast(e.message, 'err'); } finally { setLoading(false); }
  }
  function backToPurchases() { M.purchaseDraft = null; go('purchases'); }

  /* ---------------- 统计 ---------------- */
  async function renderStats(content) {
    content.innerHTML = pageHead('数据统计', '今日、本月、客户与商品排行') + '<div id="statTop"><div class="loading-inline">加载中…</div></div>' +
      '<div class="section-title"><h2>客户排行</h2></div><div class="card" id="statCustomers"><div class="loading-inline">加载中…</div></div>' +
      '<div class="section-title"><h2>商品销量</h2></div><div class="card" id="statGoods"><div class="loading-inline">加载中…</div></div>';
    try {
      const s = await api('/stats/summary');
      $('statTop').innerHTML = '<div class="stat-cards">' +
        '<div class="stat-card"><div class="stat-label">今日销售额</div><div class="stat-value">￥' + money(s.today && s.today.amount) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">今日单量</div><div class="stat-value">' + num(s.today && s.today.order_count) + ' <small>单</small></div></div>' +
        '<div class="stat-card"><div class="stat-label">本月销售额</div><div class="stat-value">￥' + money(s.month && s.month.amount) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">本月单量</div><div class="stat-value">' + num(s.month && s.month.order_count) + ' <small>单</small></div></div>' +
        '</div>';
      const [cust, goods] = await Promise.all([
        api('/stats/customers?dim=month'),
        api('/stats/goods')
      ]);
      $('statCustomers').innerHTML = cust.length ? cust.slice(0, 15).map((r, i) => (
        '<div class="rank-row"><div class="rank-no">' + (i + 1) + '</div><div class="rank-main">' +
          '<div class="rank-name">' + esc(r.customer_name) + '</div><div class="rank-sub">' + esc(r.period_label) + ' · ' + num(r.order_count) + ' 单</div></div>' +
          '<div class="rank-amount">￥' + money(r.total_amount) + '</div></div>'
      )).join('') : '<div class="empty">暂无客户统计</div>';
      $('statGoods').innerHTML = goods.length ? goods.slice(0, 15).map((r, i) => (
        '<div class="rank-row"><div class="rank-no">' + (i + 1) + '</div><div class="rank-main">' +
          '<div class="rank-name">' + esc(r.goods_name) + '</div><div class="rank-sub">' + esc(r.goods_code) + ' · 销量 ' + num(r.total_qty) + '</div></div>' +
          '<div class="rank-amount">￥' + money(r.total_amount) + '</div></div>'
      )).join('') : '<div class="empty">暂无商品统计</div>';
    } catch (e) {
      $('statTop').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }

  /* ---------------- 更多 ---------------- */
  function renderMore(content) {
    const name = (M.user && (M.user.display_name || M.user.username)) || '管理员';
    const shop = (M.shop && M.shop.name) || '九源祥销售';
    content.innerHTML =
      '<div class="page-head"><div><h1>更多</h1><p>业务入口、统计与账号设置</p></div></div>' +
      '<div class="profile-card"><div class="profile-name">' + esc(name) + '</div>' +
      '<div class="profile-sub">' + esc(shop) + ' · 手机端</div>' +
      '<div class="profile-actions"><button class="btn btn-sm" onclick="Mobile.openApiSettings()">服务器设置</button>' +
        '<button class="btn btn-sm" onclick="Mobile.logout()">退出登录</button></div></div>' +
      '<div class="section-title"><h2>业务功能</h2></div>' +
      '<div class="more-grid">' +
        '<button class="more-item" onclick="Mobile.go(\'goods\')"><div class="more-icon">📦</div><div><div class="more-label">商品资料</div><div class="more-desc">规格 · 单位 · 价格</div></div></button>' +
        '<button class="more-item" onclick="Mobile.go(\'purchases\')"><div class="more-icon">📥</div><div><div class="more-label">进货管理</div><div class="more-desc">进货单 · 入库</div></div></button>' +
        '<button class="more-item" onclick="Mobile.go(\'stats\')"><div class="more-icon">📊</div><div><div class="more-label">数据统计</div><div class="more-desc">销售 · 客户 · 商品</div></div></button>' +
        '<button class="more-item" onclick="Mobile.go(\'customers\')"><div class="more-icon">👤</div><div><div class="more-label">客户管理</div><div class="more-desc">资料 · 历史金额</div></div></button>' +
      '</div>' +
      '<div class="section-title"><h2>说明</h2></div>' +
      '<div class="card" style="font-size:12px;color:var(--muted);line-height:1.8">手机端与电脑端、EXE 共用同一个服务器和数据库。手机端保存的订单会立即出现在电脑端“销售订单”里；电脑端修改的商品价格、客户资料，手机端刷新后同步显示。</div>';
  }
  function openApiSettings() {
    openSheet('服务器设置', '<div class="sheet-form"><label class="field-label">API 地址</label>' +
      '<input class="input" id="apiBaseInput" value="' + esc(getBase()) + '" inputmode="url">' +
      '<div class="sheet-sub" style="margin-top:8px">修改后需要重新登录。</div></div>' +
      '<div class="sheet-actions"><button class="btn btn-ghost" onclick="Mobile.closeSheet()">取消</button>' +
        '<button class="btn btn-primary" onclick="Mobile.saveApiBase()">保存并重新登录</button></div>');
  }
  function saveApiBase() {
    const base = normalizeBase($('apiBaseInput').value);
    if (!base) return toast('API 地址不能为空', 'err');
    localStorage.setItem(BASE_KEY, base);
    closeSheet();
    logout();
    showLogin('接口地址已保存，请重新登录');
  }

  /* ---------------- 弹层 ---------------- */
  function openSheet(title, html) {
    $('sheetTitle').textContent = title || '';
    const body = $('sheetBody');
    body.innerHTML = html || '';
    body.scrollTop = 0;
    $('sheetMask').classList.remove('hidden');
    $('sheet').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('sheetMask').classList.add('hidden');
    $('sheet').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  /* ---------------- 启动 ---------------- */
  function bindShell() {
    $('loginForm').addEventListener('submit', doLogin);
    document.querySelectorAll('.tab-item').forEach((el) => {
      el.addEventListener('click', () => go(el.dataset.page));
    });
    $('sheetClose').addEventListener('click', closeSheet);
    $('sheetMask').addEventListener('click', closeSheet);
    $('avatarBtn').addEventListener('click', () => go('more'));
    window.addEventListener('hashchange', () => {
      const page = parseHash();
      if (page && page !== M.page) go(page);
    });
  }
  async function boot() {
    bindShell();
    if (!M.token) { showLogin(''); return; }
    setLoading(true);
    try {
      await enterApp();
    } catch (e) {
      showLogin(e.message || '登录已过期');
    } finally {
      setLoading(false);
    }
  }

  window.Mobile = {
    go, logout, doLogin, refreshOrderNo,
    openCustomerPicker, chooseCustomer, openCustomerEdit, saveCustomer,
    pickGoodsName, chooseSpec, addGoodsToCart, addFromGoods, deleteGoods, removeCart, setQty, stepQty, setPrice, setUnit,
    openGoodsForm, addGoodsPackRow, removeGoodsPackRow, setGoodsBaseUnit, markGoodsBaseChips, syncGoodsPrice, saveGoodsForm,
    setMakeDate, setExpDate, focusSaleSearch,
    clearSale, saveSale, backToOrders,
    openOrderDetail, editOrder, voidOrder,
    startPurchase, choosePurchaseSpec, pickPurchaseName, removePurchaseItem, setPurchaseQty,
    stepPurchaseQty, setPurchasePrice, setPurchaseUnit, setPurchaseMakeDate, savePurchase, backToPurchases,
    openPurchaseDetail, voidPurchase,
    openApiSettings, saveApiBase, closeSheet
  };

  boot();
})();
