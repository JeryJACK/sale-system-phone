'use strict';

/* ============================================================
 * 打单系统前端逻辑（纯静态，可放 GitHub Pages）
 * 所有业务数据都通过后端 JSON API 读写，浏览器本地只保存登录令牌和 API 地址。
 * ============================================================ */

const TOKEN_KEY = 'billing_token';
const API_KEY = 'billing_api_base';

let token = localStorage.getItem(TOKEN_KEY) || '';
let currentUser = null;
let shopInfo = { name: '', addr: '', tel: '' };
let customers = [];
let goodsList = [];
let priceMap = {};              // goods_id -> {price, history, ...}（当前客户）
let printPrefMap = {};          // goods_id -> true：该客户打印这张商品时隐藏规格
let currentCustomer = null;
let sellRows = [];
let currentEditRowIndex = null;
let nameSuggestTimer = null;
let nameSuggest = { index: null, items: [], active: -1, kw: '', offset: 0, hasMore: false, loading: false };
let specSuggest = { index: null, items: [], active: -1, name: '', loading: false };
let specCache = {};             // 品名+客户 -> 规格列表（含该客户价格记忆）
let batchTargetRow = null;
let editingOrder = null;
let editingOrderId = null;
let printSaving = false;
let purchaseRows = [];
let purchaseNo = '';
let stockConfig = { mode: 'weight', strategy: 'fifo', allow_negative: false, close_month: '' };
let statRows = [];
let statBarChart = null;
let statTrendChart = null;
let statPieChart = null;
let statTrendRows = [];
let statPieData = [];
let statSelectedTarget = '';
let statGoodsIds = [];
let statCustomerNos = [];
let statTablePage = 1;
let statTableSortKey = 'time_label';
let statTableSortDir = -1;
const statPageSize = 20;
let priceModalCustomer = null;
let priceModalRows = [];
let loaded = { customers: false, goods: false };

/* ==================== 基础工具 ==================== */
function $(id) { return document.getElementById(id); }

function esc(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function money(value) {
  const n = Number(value);
  return isFinite(n) ? n.toFixed(2) : '0.00';
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function toast(message, type) {
  const wrap = $('toastWrap');
  if (!wrap) return;
  const item = document.createElement('div');
  item.className = 'toast-item toast-' + (type || 'info');
  item.textContent = message;
  wrap.appendChild(item);
  setTimeout(function () {
    item.style.opacity = '0';
    item.style.transition = 'opacity .25s';
    setTimeout(function () { item.remove(); }, 260);
  }, type === 'err' ? 4200 : 2600);
}

function showLogin(message) {
  const overlay = $('loginOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
  }
  const shell = $('appShell');
  if (shell) { shell.classList.add('hidden'); shell.classList.remove('flex'); }
  const err = $('loginError');
  if (err) err.textContent = message || '';
}

function showApp() {
  const overlay = $('loginOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }
  const shell = $('appShell');
  if (shell) { shell.classList.remove('hidden'); shell.classList.add('flex'); }
  initSideMenuAutoCollapse();
}

function handleAuthExpired() {
  token = '';
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  showLogin('登录已过期，请重新登录');
}

/* ==================== API 访问 ==================== */
function sanitizeBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

// 用户只填 https://api.example.com 或 IP:端口 时自动补协议和 /api；已带路径的保持原样
function normalizeApiBase(value) {
  let base = sanitizeBase(value);
  if (!base) return '';
  if (!/^https?:\/\//i.test(base) && !base.startsWith('/')) {
    base = (location.protocol === 'https:' ? 'https://' : 'http://') + base;
  }
  try {
    const url = new URL(base);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '') base = base.replace(/\/+$/, '') + '/api';
  } catch (err) { /* 允许相对路径，交给 fetch 处理 */ }
  return base;
}

function getApiBase() {
  const stored = localStorage.getItem(API_KEY) || '';
  const fallback = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || '';
  return normalizeApiBase(stored || fallback);
}

async function api(path, options) {
  options = options || {};
  const base = getApiBase();
  if (!base) throw new Error('请先设置服务器 API 地址');
  const headers = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;

  let response;
  try {
    response = await fetch(base + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
  } catch (err) {
    throw new Error('无法连接服务器，请检查 API 地址、网络或 HTTPS 配置');
  }

  let json = null;
  try { json = await response.json(); } catch (err) { /* 非 JSON 响应 */ }

  if (response.status === 401 && options.auth !== false) {
    handleAuthExpired();
    throw new Error((json && json.error) || '登录已过期');
  }
  if (!response.ok || !json || json.ok !== true) {
    throw new Error((json && json.error) || ('请求失败（HTTP ' + response.status + '）'));
  }
  return json.data;
}

async function fetchAll(path, pageSize) {
  const size = pageSize || 500;
  let page = 1;
  let all = [];
  while (page <= 20) {
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    const data = await api(path + sep + 'page=' + page + '&page_size=' + size);
    const items = data.items || [];
    all = all.concat(items);
    if (all.length >= Number(data.total || 0) || items.length === 0) break;
    page += 1;
  }
  return all;
}

/* ==================== 开单输入审计（只写后端日志，无界面） ==================== */
let auditQueue = [];
let auditFlushTimer = null;
let auditDebounceTimer = null;
let auditFlushing = false;

function auditSessionId() {
  try {
    let id = sessionStorage.getItem('billing_audit_session');
    if (!id) {
      id = 's' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('billing_audit_session', id);
    }
    return id;
  } catch (err) {
    return 's' + Date.now().toString(36);
  }
}

function auditRowSnapshot(row, index) {
  return {
    row_index: index,
    goods_id: row.goods_id || null,
    goods_code: row.pid || '',
    goods_name: row.pname || '',
    spec: row.spec || '',
    unit: row.unit || '',
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
    amount: Number(row.amount) || 0,
    hide_spec: !!row.hideSpec,
    valid: !!(row.pid && Number(row.qty) > 0 && Number(row.price) > 0),
    stock_id: row.stock_id || null,
    make_date: row.makeDate || '',
    exp_date: row.expDate || '',
    remark: row.remark || ''
  };
}

function auditRowsSnapshot() {
  return sellRows.map(function (row, index) { return auditRowSnapshot(row, index); });
}

function auditOrder(action, extra) {
  if (!token) return;
  const event = Object.assign({
    action: action,
    order_no: ($('sellOrderNo') && $('sellOrderNo').value) || '',
    client_time: new Date().toISOString()
  }, extra || {});
  auditQueue.push(event);
  if (auditQueue.length > 200) auditQueue.splice(0, auditQueue.length - 200);
  if (auditQueue.length >= 8) {
    flushOrderAudit();
  } else {
    clearTimeout(auditFlushTimer);
    auditFlushTimer = setTimeout(flushOrderAudit, 800);
  }
}

async function flushOrderAudit() {
  clearTimeout(auditFlushTimer);
  auditFlushTimer = null;
  if (auditFlushing) {
    await new Promise(function (resolve) { setTimeout(resolve, 120); });
    return flushOrderAudit();
  }
  if (!auditQueue.length) return;
  auditFlushing = true;
  const batch = auditQueue.splice(0, 50);
  try {
    await api('/order-input-logs', {
      method: 'POST',
      body: { session_id: auditSessionId(), events: batch }
    });
  } catch (err) {
    // 审计失败不能影响开单，也不能弹错误打扰操作员
    console.warn('开单审计日志写入失败：', err.message);
  } finally {
    auditFlushing = false;
    if (auditQueue.length) setTimeout(flushOrderAudit, 300);
  }
}

function scheduleAudit(action, extra, delay) {
  clearTimeout(auditDebounceTimer);
  auditDebounceTimer = setTimeout(function () {
    auditOrder(action, Object.assign({ detail: { rows: auditRowsSnapshot() } }, extra || {}));
  }, delay || 900);
}

function buildQuery(obj) {
  const params = new URLSearchParams();
  Object.keys(obj).forEach(function (key) {
    const value = obj[key];
    if (value !== '' && value !== null && value !== undefined) params.append(key, value);
  });
  return params.toString();
}

/* ==================== 登录 ==================== */
async function doLogin() {
  const base = normalizeApiBase($('loginApiBase').value);
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  const errorBox = $('loginError');
  errorBox.textContent = '';

  if (!base) { errorBox.textContent = '请填写服务器 API 地址'; return; }
  if (!username || !password) { errorBox.textContent = '请填写账号和密码'; return; }
  $('loginApiBase').value = base;

  const button = document.querySelector('#loginOverlay button');
  button.disabled = true;
  button.textContent = '登录中…';
  try {
    const response = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    });
    const json = await response.json().catch(function () { return null; });
    if (!response.ok || !json || json.ok !== true) {
      throw new Error((json && json.error) || '登录失败');
    }
    localStorage.setItem(API_KEY, base);
    token = json.data.token;
    localStorage.setItem(TOKEN_KEY, token);
    currentUser = json.data.staff;
    $('loginPassword').value = '';
    showApp();
    await initApp();
  } catch (err) {
    errorBox.textContent = err.message || '登录失败';
  } finally {
    button.disabled = false;
    button.textContent = '登 录';
  }
}

function doLogout() {
  token = '';
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  customers = [];
  goodsList = [];
  priceMap = {};
  printPrefMap = {};
  currentCustomer = null;
  sellRows = [];
  showLogin('');
  $('loginPassword').value = '';
}

async function restoreSession() {
  try {
    currentUser = await api('/auth/me');
    showApp();
    await initApp();
  } catch (err) {
    if (token) showLogin(err.message || '');
  }
}

/* ==================== 初始化 ==================== */
async function initApp() {
  try {
    if (!currentUser) currentUser = await api('/auth/me');
    $('currentUserName').textContent = (currentUser.display_name || currentUser.username || '') + '（' + (currentUser.username || '') + '）';
    shopInfo = await api('/shop');
    await Promise.all([refreshCustomers(), refreshGoods()]);
    renderShopInfo();
    fillSettings();
    resetNewCustomerNo();
    $('sellDate').value = todayStr();
    if (!sellRows.length) addRow();
    await refreshOrderNo();
    switchPage('sale');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ==================== 页面切换 ==================== */
function setMenuActive(pageName) {
  document.querySelectorAll('.menu-item').forEach(function (el) {
    el.classList.toggle('side-item-active', el.dataset.page === pageName);
  });
}

function bindMenuClick() {
  document.querySelectorAll('.menu-item').forEach(function (item) {
    item.addEventListener('click', function () {
      const page = this.dataset.page;
      if (page === 'sale' && editingOrderId) exitOrderEdit();
      switchPage(page);
      scheduleSideMenuCollapse();
    });
  });
}

/* ==================== 左侧菜单自动折叠 ==================== */
let sideMenuTimer = null;
let sideMenuBound = false;
let sideMenuHovered = false;

function expandSideMenu() {
  const menu = $('sideMenu');
  if (!menu) return;
  if (sideMenuTimer) {
    clearTimeout(sideMenuTimer);
    sideMenuTimer = null;
  }
  menu.classList.remove('is-collapsed');
}

function collapseSideMenu() {
  const menu = $('sideMenu');
  if (!menu) return;
  sideMenuTimer = null;
  if (sideMenuHovered || menu.matches(':hover')) return;
  const active = document.activeElement;
  if (active && active.matches && active.matches('input, textarea, select') &&
      !active.disabled && !active.readOnly && active.closest && active.closest('#page-sale')) {
    return;
  }
  menu.classList.add('is-collapsed');
}

function scheduleSideMenuCollapse() {
  const menu = $('sideMenu');
  if (!menu || menu.classList.contains('is-collapsed') || sideMenuTimer) return;
  sideMenuTimer = setTimeout(collapseSideMenu, 2000);
}

function initSideMenuAutoCollapse() {
  const menu = $('sideMenu');
  if (!menu) return;
  if (!sideMenuBound) {
    sideMenuBound = true;
    menu.addEventListener('mouseenter', function () {
      sideMenuHovered = true;
      expandSideMenu();
    });
    menu.addEventListener('mouseleave', function () {
      sideMenuHovered = false;
      scheduleSideMenuCollapse();
    });
    menu.addEventListener('click', function () {
      if (menu.classList.contains('is-collapsed')) expandSideMenu();
    });
    document.addEventListener('mousemove', function (e) {
      const rect = menu.getBoundingClientRect();
      // 鼠标贴到屏幕左边缘，或已经进入展开后的菜单，立即展开
      if (e.clientX <= 10 || (rect.width > 20 && e.clientX >= rect.left && e.clientX <= rect.right)) {
        expandSideMenu();
      } else if (!menu.classList.contains('is-collapsed') && e.clientX > rect.right + 10) {
        scheduleSideMenuCollapse();
      }
    });
  }
  scheduleSideMenuCollapse();
}

function releaseHiddenFocus() {
  const active = document.activeElement;
  if (active && active !== document.body && active.closest && active.closest('.hidden')) {
    try { active.blur(); } catch (e) {}
    return true;
  }
  return false;
}

function switchPage(pageName, keepOrderEdit) {
  // 从其它页面（含首页“去开单”）进入新增销售时，必须彻底退出上一张订单的编辑态，
  // 否则 editingOrderId 残留会把客户、日期、明细全部禁用，表现为“点输入框没反应”。
  if (pageName === 'sale' && !keepOrderEdit && editingOrderId) {
    exitOrderEdit();
  }
  // 切页时把可能残留的弹窗层收掉，避免透明遮罩盖住新页面导致“鼠标点了没反应”。
  ['productModal', 'batchModal', 'priceModal', 'customerModal', 'goodsModal', 'printPreviewModal'].forEach(function (id) {
    const modal = $(id);
    if (modal && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  });
  setMenuActive(pageName);
  closeNameSuggest();
  closeSpecSuggest();
  closePurchaseNameSuggest();
  closePurchaseSpecSuggest();
  ['home', 'sale', 'orderList', 'detail', 'customerManage', 'purchase', 'stock', 'stat', 'import', 'setting'].forEach(function (id) {
    const page = $('page-' + id);
    if (page) page.classList.add('hidden');
  });
  const target = $('page-' + pageName);
  if (target) target.classList.remove('hidden');
  const focusWasHidden = releaseHiddenFocus();

  if (['sale', 'purchase', 'stock', 'customerManage', 'setting'].indexOf(pageName) >= 0) {
    refreshGoods().catch(function () {});
  }
  if (['sale', 'customerManage'].indexOf(pageName) >= 0) {
    refreshCustomers().catch(function () {});
  }

  if (pageName === 'sale') {
    renderShopInfo();
    setSaleModeUI();
    loadStockConfig();
    if (focusWasHidden || (!editingOrderId && !currentCustomer)) {
      setTimeout(function () {
        const input = $('sellCustomerInput');
        if (input && !input.disabled) input.focus();
      }, 0);
    }
  }
  if (pageName === 'home') loadHome();
  if (pageName === 'orderList') loadOrders();
  if (pageName === 'detail') loadDetailList();
  if (pageName === 'customerManage') renderCustomerManage();
  if (pageName === 'purchase') loadPurchasePage();
  if (pageName === 'stock') { renderGoodsManage(); refreshGoods().catch(function () {}); }
  if (pageName === 'stat') initStatPage();
  if (pageName === 'setting') { fillSettings(); loadStockConfig(); loadMemoGoodsSelect(); }
}

/* ==================== 店铺信息 ==================== */
function renderShopInfo() {
  $('shopNameShow').textContent = shopInfo.name || '【未设置店铺名称，请前往系统设置填写】';
  $('shopAddrShow').textContent = shopInfo.addr || '--';
  $('shopTelShow').textContent = shopInfo.tel || '--';
}

function fillSettings() {
  $('setShopName').value = shopInfo.name || '';
  $('setShopAddr').value = shopInfo.addr || '';
  $('setShopTel').value = shopInfo.tel || '';
  $('setApiBase').value = getApiBase();
}

async function saveShopInfo() {
  try {
    shopInfo = await api('/shop', {
      method: 'PUT',
      body: {
        name: $('setShopName').value.trim(),
        addr: $('setShopAddr').value.trim(),
        tel: $('setShopTel').value.trim()
      }
    });
    renderShopInfo();
    toast('店铺信息已保存', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

async function changePassword() {
  const oldPassword = $('setOldPassword').value;
  const newPassword = $('setNewPassword').value;
  if (!oldPassword || !newPassword) return toast('请填写原密码和新密码', 'err');
  if (newPassword.length < 6) return toast('新密码至少 6 位', 'err');
  try {
    await api('/auth/change-password', { method: 'POST', body: { old_password: oldPassword, new_password: newPassword } });
    $('setOldPassword').value = '';
    $('setNewPassword').value = '';
    toast('密码修改成功', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

function saveApiBase() {
  const base = normalizeApiBase($('setApiBase').value);
  if (!base) return toast('API 地址不能为空', 'err');
  localStorage.setItem(API_KEY, base);
  toast('接口地址已保存，请重新登录', 'ok');
  doLogout();
  $('loginApiBase').value = base;
}

/* ==================== 首页 ==================== */
async function loadHome() {
  try {
    const data = await api('/stats/summary');
    $('homeTodayAmount').textContent = money(data.today && data.today.amount);
    $('homeTodayOrders').textContent = (data.today && data.today.order_count) || 0;
    $('homeMonthAmount').textContent = money(data.month && data.month.amount);
    $('homeMonthOrders').textContent = (data.month && data.month.order_count) || 0;
    $('homeCustomerCount').textContent = data.customer_count || 0;
    $('homeGoodsCount').textContent = data.goods_count || 0;
    const rows = data.recent_orders || [];
    $('homeRecentBody').innerHTML = rows.length ? rows.map(function (order) {
      return '<tr class="border-b">' +
        '<td class="border px-2 py-1">' + esc(order.order_no) + '</td>' +
        '<td class="border px-2 py-1">' + esc(order.bill_date) + '</td>' +
        '<td class="border px-2 py-1">' + esc(order.customer_name) + '</td>' +
        '<td class="border px-2 py-1">￥' + money(order.total_amount) + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="4" class="text-center text-gray-400 py-6">暂无数据</td></tr>';
  } catch (err) { toast(err.message, 'err'); }
}

/* ==================== 客户 ==================== */
async function refreshCustomers() {
  customers = await fetchAll('/customers');
  loaded.customers = true;
  specCache = {};
  purchaseSpecCache = {};
  if (currentCustomer) {
    const fresh = customers.find(function (c) { return String(c.id) === String(currentCustomer.id); });
    if (fresh) {
      currentCustomer = {
        id: fresh.id, customer_no: fresh.customer_no, name: fresh.name, addr: fresh.addr, tel: fresh.tel
      };
      if ($('sellCustomerInput')) $('sellCustomerInput').value = fresh.name || '';
      if ($('custNo')) $('custNo').value = fresh.customer_no || '';
      if ($('custAddr')) $('custAddr').value = fresh.addr || '';
      if ($('custTel')) $('custTel').value = fresh.tel || '';
    }
  }
  renderCustomerManage();
}

function findCustomer(id) {
  return customers.find(function (c) { return String(c.id) === String(id); });
}

function resetNewCustomerNo() {
  const field = $('newCustomerNo');
  if (field) field.value = '';
}

function renderCustomerManage() {
  const wrap = $('customerListWrap');
  if (!wrap) return;
  const keyword = ($('customerSearch') ? $('customerSearch').value : '').trim().toLowerCase();
  const list = keyword ? customers.filter(function (c) {
    return String(c.customer_no || '').toLowerCase().indexOf(keyword) >= 0 ||
      (c.name || '').toLowerCase().indexOf(keyword) >= 0 ||
      (c.addr || '').toLowerCase().indexOf(keyword) >= 0 ||
      (c.tel || '').indexOf(keyword) >= 0;
  }) : customers;

  wrap.innerHTML = '<table class="w-full text-sm border">' +
    '<thead class="bg-gray-100"><tr>' +
    '<th class="border px-2 py-2">客户编号</th>' +
    '<th class="border px-2 py-2 text-left">客户名称</th>' +
    '<th class="border px-2 py-2 text-left">地址</th>' +
    '<th class="border px-2 py-2">电话</th>' +
    '<th class="border px-2 py-2">订单数</th>' +
    '<th class="border px-2 py-2">累计金额</th>' +
    '<th class="border px-2 py-2">最近开单</th>' +
    '<th class="border px-2 py-2">操作</th>' +
    '</tr></thead><tbody>' +
    (list.length ? list.map(function (c) {
      return '<tr class="border-b hover:bg-blue-50">' +
        '<td class="border px-2 py-1 font-mono text-primaryBlue">' + esc(c.customer_no || '-') + '</td>' +
        '<td class="border px-2 py-1 font-medium">' + esc(c.name) + '</td>' +
        '<td class="border px-2 py-1 text-gray-600">' + esc(c.addr || '-') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(c.tel || '-') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + (c.order_count || 0) + '</td>' +
        '<td class="border px-2 py-1 text-center">￥' + money(c.total_amount) + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(c.last_order_date || '-') + '</td>' +
        '<td class="border px-2 py-1 text-center whitespace-nowrap">' +
        '<button onclick="openPriceModalById(\'' + esc(c.id) + '\')" class="text-primaryBlue mr-2">价格表</button>' +
        '<button onclick="openCustomerEdit(\'' + esc(c.id) + '\')" class="text-gray-600 mr-2">编辑</button>' +
        '<button onclick="deleteCustomer(\'' + esc(c.id) + '\')" class="text-red-500">停用</button>' +
        '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="text-center text-gray-400 py-6">暂无客户，请新增或到“数据导入”导入客户信息</td></tr>') +
    '</tbody></table>';
}

async function addCustomer() {
  const name = $('newCustomerName').value.trim();
  if (!name) return toast('客户名称不能为空', 'err');
  try {
    await api('/customers', {
      method: 'POST',
      body: {
        name: name,
        addr: $('newCustomerAddr').value.trim(),
        tel: $('newCustomerTel').value.trim(),
        remark: $('newCustomerRemark').value.trim()
      }
    });
    ['newCustomerNo', 'newCustomerName', 'newCustomerAddr', 'newCustomerTel', 'newCustomerRemark'].forEach(function (id) {
      $(id).value = '';
    });
    await refreshCustomers();
    toast('客户已新增，客户编号由数据库自动生成', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

function openCustomerEdit(id) {
  const customer = findCustomer(id);
  if (!customer) return;
  $('editCustomerId').value = customer.id;
  $('editCustomerNo').value = customer.customer_no || '';
  $('editCustomerName').value = customer.name || '';
  $('editCustomerAddr').value = customer.addr || '';
  $('editCustomerTel').value = customer.tel || '';
  $('editCustomerRemark').value = customer.remark || '';
  const modal = $('customerModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeCustomerModal() {
  const modal = $('customerModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function saveCustomerEdit() {
  const id = $('editCustomerId').value;
  try {
    await api('/customers/' + encodeURIComponent(id), {
      method: 'PUT',
      body: {
        name: $('editCustomerName').value.trim(),
        addr: $('editCustomerAddr').value.trim(),
        tel: $('editCustomerTel').value.trim(),
        remark: $('editCustomerRemark').value.trim()
      }
    });
    closeCustomerModal();
    await refreshCustomers();
    if (currentCustomer && String(currentCustomer.id) === String(id)) {
      const fresh = findCustomer(id);
      if (fresh) {
        currentCustomer = fresh;
        $('sellCustomerInput').value = fresh.name;
        $('custNo').value = fresh.customer_no || '';
        $('custAddr').value = fresh.addr || '';
        $('custTel').value = fresh.tel || '';
      }
    }
    toast('客户信息已保存', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

async function deleteCustomer(id) {
  const customer = findCustomer(id);
  if (!customer) return;
  if (!confirm('确定停用客户“' + customer.name + '”？停用后不会再出现在打单搜索中，历史订单不受影响。')) return;
  try {
    await api('/customers/' + encodeURIComponent(id), { method: 'DELETE' });
    if (currentCustomer && String(currentCustomer.id) === String(id)) {
      currentCustomer = null;
      priceMap = {};
      printPrefMap = {};
      $('sellCustomerInput').value = '';
      $('custNo').value = '';
    }
    await refreshCustomers();
    toast('客户已停用', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

/* ==================== 客户选择与价格加载 ==================== */
function bindCustomerInput() {
  const input = $('sellCustomerInput');
  const dropdown = $('customerDropdown');

  input.addEventListener('input', function () {
    const keyword = this.value.trim().toLowerCase();
    if (currentCustomer && this.value.trim() !== currentCustomer.name) {
      clearCurrentCustomer();
    }
    if (!keyword) { dropdown.classList.add('hidden'); return; }
    const hits = customers.filter(function (c) {
      return String(c.customer_no || '').toLowerCase().indexOf(keyword) >= 0 ||
        (c.name || '').toLowerCase().indexOf(keyword) >= 0;
    }).slice(0, 20);
    if (!hits.length) { dropdown.classList.add('hidden'); return; }
    dropdown.innerHTML = hits.map(function (c) {
      return '<div class="autocomplete-item" data-id="' + esc(c.id) + '">' +
        '<div><span class="text-primaryBlue font-mono mr-2">#' + esc(c.customer_no || '') + '</span>' + esc(c.name) + '</div>' +
        '<div class="text-xs text-gray-400">' + esc(c.addr || '') + ' ' + esc(c.tel || '') + '</div>' +
        '</div>';
    }).join('');
    dropdown.querySelectorAll('.autocomplete-item').forEach(function (item) {
      item.addEventListener('mousedown', function (event) {
        event.preventDefault();
        const customer = findCustomer(this.dataset.id);
        if (customer) selectCustomer(customer);
      });
    });
    dropdown.classList.remove('hidden');
  });

  input.addEventListener('blur', function () {
    setTimeout(function () {
      dropdown.classList.add('hidden');
      const text = input.value.trim();
      if (!text) { clearCurrentCustomer(); return; }
      const exact = customers.find(function (c) {
        return c.name === text || String(c.customer_no) === text;
      });
      if (exact) {
        if (!currentCustomer || String(currentCustomer.id) !== String(exact.id)) selectCustomer(exact);
      } else if (currentCustomer) {
        clearCurrentCustomer();
      }
    }, 200);
  });
}

function clearCurrentCustomer() {
  currentCustomer = null;
  priceMap = {};
  printPrefMap = {};
  $('custNo').value = '';
  $('customerPriceTip').classList.add('hidden');
  sellRows.forEach(function (row, index) {
    if (row.priceAuto) {
      row.price = '';
      row.priceAuto = false;
      row.history = [];
      updatePriceCell(index);
      calcRowAmount(index);
    }
    row.specFor = '';
    row.specOptions = [];
    row.hideSpec = false;
    row.hideSpecTouched = false;
    row.hideSpecGoodsId = null;
  });
  renderSellTable();
}

async function selectCustomer(customer) {
  currentCustomer = {
    id: customer.id,
    customer_no: customer.customer_no,
    name: customer.name,
    addr: customer.addr,
    tel: customer.tel
  };
  $('sellCustomerInput').value = customer.name;
  $('custNo').value = customer.customer_no || '';
  $('custAddr').value = customer.addr || '';
  $('custTel').value = customer.tel || '';
  $('customerDropdown').classList.add('hidden');
  await Promise.all([loadCustomerPrices(customer.id), loadCustomerPrintPrefs(customer.id)]);
  sellRows.forEach(function (row) {
    row.hideSpecGoodsId = null;
    row.hideSpecTouched = false;
  });
  applyPricesForCustomer();
  renderSellTable();
}

async function loadCustomerPrintPrefs(customerId) {
  printPrefMap = {};
  try {
    const data = await api('/customers/' + encodeURIComponent(customerId) + '/print-prefs');
    (data.items || []).forEach(function (item) {
      printPrefMap[Number(item.goods_id)] = !!item.hide_spec;
    });
  } catch (err) {
    toast('加载打印隐藏记忆失败：' + err.message, 'err');
  }
}

async function loadCustomerPrices(customerId) {
  try {
    const list = await api('/customers/' + encodeURIComponent(customerId) + '/prices');
    priceMap = {};
    list.forEach(function (item) { priceMap[item.goods_id] = item; });
    const priced = list.filter(function (item) { return item.price !== null && item.price !== undefined; }).length;
    const tip = $('customerPriceTip');
    tip.classList.remove('hidden');
    tip.innerHTML = '已加载 <b>' + esc(currentCustomer ? ('#' + currentCustomer.customer_no + ' ' + currentCustomer.name) : '') + '</b> 的客户价：' +
      priced + ' 个商品有历史价格，输入商品编码会按“客户编号 + 商品编码”带出最近一次价格。' +
      ' <button class="underline text-primaryBlue" onclick="openPriceModalById(\'' + esc(customerId) + '\')">维护价格表</button>';
  } catch (err) {
    toast('加载客户价格失败：' + err.message, 'err');
  }
}

function findGoodsByCode(code) {
  const value = String(code || '').trim().toLowerCase();
  if (!value) return null;
  return goodsList.find(function (g) { return String(g.code).trim().toLowerCase() === value; }) || null;
}

function findGoodsById(id) {
  return goodsList.find(function (g) { return Number(g.id) === Number(id); }) || null;
}

/* ==================== 销售明细行 ==================== */
function newRow() {
  return {
    goods_id: null, pid: '', pname: '', spec: '', unit: '', units: [], baseUnit: '',
    allowUnitEdit: false,
    qty: 1, price: '', priceAuto: false, amount: 0,
    makeDate: '', expDate: '', remark: '', stock_id: null,
    shelfLifeDays: 0, expireManual: false, history: [], defaultPrice: null,
    hideSpec: false, hideSpecTouched: false, hideSpecGoodsId: null,
    specOptions: [], specFor: '', specBusy: false
  };
}

function addRow() {
  if (isOrderLocked()) return;
  closeNameSuggest();
  closeSpecSuggest();
  sellRows.push(newRow());
  renderSellTable();
  auditOrder('row_add', { row_index: sellRows.length - 1, detail: { rows: auditRowsSnapshot() } });
}

function delRow(index) {
  if (isOrderLocked()) return;
  closeNameSuggest();
  closeSpecSuggest();
  const removed = sellRows[index] ? auditRowSnapshot(sellRows[index], index) : null;
  sellRows.splice(index, 1);
  if (!sellRows.length) sellRows.push(newRow());
  renderSellTable();
  auditOrder('row_delete', { row_index: index, detail: { removed: removed, rows: auditRowsSnapshot() } });
}

function rowPriceFactor(row) {
  return 1;
}

function historyText(row) {
  const history = row.history || [];
  if (history.length) return '历史 ' + history.map(function (h) { return money(Number(h.price)); }).join(' · ');
  if (row.defaultPrice !== null && row.defaultPrice !== undefined) return '参考价 ' + money(Number(row.defaultPrice));
  return '';
}

function historyTitle(row) {
  const history = row.history || [];
  if (!history.length) return '';
  return '最近价格：\n' + history.map(function (h) {
    return (h.date || '') + '  ￥' + money(Number(h.price)) + (h.order_no ? '  单号 ' + h.order_no : '');
  }).join('\n');
}

function historyOptions(row) {
  return (row.history || []).map(function (h) {
    return '<option value="' + money(Number(h.price)) + '"></option>';
  }).join('');
}

function customerUnitPriceData(row, unitName) {
  const entry = row && row.goods_id ? priceMap[row.goods_id] : null;
  if (!entry) return null;
  const unitPrices = entry.unit_prices || {};
  return unitPrices[unitName] || null;
}

function historyForUnit(row, unitName) {
  const unitData = customerUnitPriceData(row, unitName);
  if (unitData && unitData.history) return unitData.history;
  const entry = row && row.goods_id ? priceMap[row.goods_id] : null;
  const baseUnit = row.baseUnit || ((row.units || []).find(function (u) { return u.is_base; }) || {}).unit || '';
  if (entry && unitName === baseUnit) return entry.history || [];
  return [];
}

/* 销售单位价：优先客户在这个单位上记过的价格，其次商品单位参考价；进货仍用 unitPrice */
function saleUnitPrice(row, unitName) {
  const entry = row && row.goods_id ? priceMap[row.goods_id] : null;
  if (entry) {
    const unitData = customerUnitPriceData(row, unitName);
    if (unitData && unitData.price !== null && unitData.price !== undefined) return Number(unitData.price);
    const baseUnit = row.baseUnit || ((row.units || []).find(function (u) { return u.is_base; }) || {}).unit || '';
    if (unitName === baseUnit && entry.price !== null && entry.price !== undefined) return Number(entry.price);
    if (entry.price !== null && entry.price !== undefined) {
      const unit = (row.units || []).find(function (u) { return u.unit === unitName; });
      return Math.round(Number(entry.price) * Number((unit && unit.factor) || 1) * 10000) / 10000;
    }
  }
  return unitPrice(row, unitName);
}

function unitSelectHtml(row, index, dis) {
  const units = row.units || [];
  if (!units.length || units.length === 1 || row.allowUnitEdit) {
    return '<input class="w-full min-w-0 border px-1 py-1 bg-gray-50 text-xs" list="unitOptions" placeholder="单位" value="' + esc(row.unit) + '" oninput="sellRows[' + index + '].unit=this.value" onchange="onUnitCommit(' + index + ',this.value)"' + dis + '>';
  }
  return '<select class="w-full min-w-0 border px-1 py-1 bg-gray-50 text-xs" onchange="onUnitCommit(' + index + ',this.value)"' + dis + '>' +
    units.map(function (u) {
      return '<option value="' + esc(u.unit) + '"' + (u.unit === row.unit ? ' selected' : '') + '>' +
        esc(u.unit) + '</option>';
    }).join('') + '</select>';
}

function purchaseUnitSelectHtml(row, index) {
  const units = row.units || [];
  if (!units.length) {
    return '<input class="w-full border px-1 py-1" value="' + esc(row.unit) + '" onchange="purchaseRows[' + index + '].unit=this.value">';
  }
  return '<select class="w-full border px-1 py-1" onchange="onPurchaseUnitCommit(' + index + ',this.value)">' +
    units.map(function (u) {
      return '<option value="' + esc(u.unit) + '"' + (u.unit === row.unit ? ' selected' : '') + '>' +
        esc(u.unit) + '</option>';
    }).join('') + '</select>' +
    '<div class="purchase-base-hint text-[10px] leading-tight text-gray-500 mt-0.5"></div>';
}

function purchaseBaseHint(row) {
  const units = row.units || [];
  const unit = String(row.unit || '');
  const base = String(row.baseUnit || '');
  if (!unit || !base) return '';
  const info = units.filter(function (u) { return u.unit === unit; })[0];
  if (!info) {
    return units.length > 1 ? '未配置「' + unit + '」换算，不能开单' : '';
  }
  const factor = Number(info.factor || 1);
  if (factor <= 1) return '';
  const price = Number(row.price || 0);
  const text = '1' + unit + '=' + (Math.round(factor * 10000) / 10000) + base;
  return price > 0
    ? text + '，折合 ' + (Math.round(price / factor * 10000) / 10000) + ' 元/' + base
    : text;
}

function reconcilePrintPref(row) {
  const goodsId = row && row.goods_id ? Number(row.goods_id) : null;
  if (!goodsId) {
    row.hideSpec = false;
    row.hideSpecTouched = false;
    row.hideSpecGoodsId = null;
    return;
  }
  if (row.hideSpecGoodsId !== null && String(row.hideSpecGoodsId) === String(goodsId)) return;
  row.hideSpecGoodsId = goodsId;
  row.hideSpecTouched = false;
  row.hideSpec = !!printPrefMap[goodsId];
}

async function togglePrintSpec(index, checked) {
  const row = sellRows[index];
  if (!row || !row.goods_id) return toast('请先选择商品，再设置是否打印规格', 'err');
  if (!currentCustomer || !currentCustomer.id) return toast('请先选择客户，系统要按“客户 + 商品”记住这个设置', 'err');
  if (isOrderLocked()) return toast('这张单据已锁定，不能再改打印规格设置', 'err');
  const previous = !!row.hideSpec;
  const hide = typeof checked === 'boolean' ? !checked : !previous;
  row.hideSpec = hide;
  row.hideSpecTouched = true;
  row.hideSpecGoodsId = row.goods_id;
  sellRows.forEach(function (item) {
    if (item.goods_id && String(item.goods_id) === String(row.goods_id)) {
      item.hideSpec = hide;
      item.hideSpecTouched = true;
      item.hideSpecGoodsId = item.goods_id;
    }
  });
  renderSellTable();
  try {
    await api('/customers/' + encodeURIComponent(currentCustomer.id) + '/print-pref', {
      method: 'PUT',
      body: { goods_id: row.goods_id, hide_spec: hide }
    });
    printPrefMap[Number(row.goods_id)] = hide;
    toast(hide
      ? '已记住：这个客户以后打印“' + row.pname + '”时不显示规格'
      : '已恢复：这个客户以后打印“' + row.pname + '”时显示规格', 'ok');
  } catch (err) {
    sellRows.forEach(function (item) {
      if (item.goods_id && String(item.goods_id) === String(row.goods_id)) item.hideSpec = previous;
    });
    renderSellTable();
    toast('保存打印隐藏设置失败：' + err.message, 'err');
  }
}

function specEyeIcon(hidden) {
  if (hidden) {
    return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"></path>' +
      '<circle cx="12" cy="12" r="2.8"></circle>' +
      '<path d="M4 3.5 20 20.5"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"></path>' +
    '<circle cx="12" cy="12" r="2.8"></circle></svg>';
}

function renderSellTable() {
  const tbody = $('sellTableBody');
  const dis = isOrderLocked() ? ' disabled' : '';
  tbody.innerHTML = sellRows.map(function (row, index) {
    reconcilePrintPref(row);
    const ro = row.goods_id ? ' readonly' : '';
    const specHidden = row.hideSpec ? ' spec-hidden' : '';
    const locked = isOrderLocked();
    const canPref = !!(row.goods_id && currentCustomer && currentCustomer.id && !locked);
    const eyeDisabled = canPref ? '' : ' disabled';
    const eyeTitle = !row.goods_id
      ? '请先选择商品'
      : (!currentCustomer || !currentCustomer.id
        ? '请先选择客户'
        : (locked ? '单据已锁定' : (row.hideSpec ? '打印规格已隐藏，点击恢复显示' : '打印时显示规格，点击隐藏')));
    return '<tr class="border-b' + (row.hideSpec ? ' print-spec-hidden-row' : '') + '">' +
      '<td class="text-center"><button onclick="delRow(' + index + ')" class="text-red-500 text-lg leading-none" title="删除本行"' + dis + '>－</button></td>' +
      '<td><input class="w-full min-w-0 border px-1 py-1" value="' + esc(row.pid) + '" placeholder="编码（点此选择）" ' +
      'oninput="sellRows[' + index + '].pid=this.value" onchange="onPidChange(' + index + ')" ' +
      'onclick="if(!this.disabled&&!sellRows[' + index + '].pid)openProductModal(' + index + ')" ' +
      'ondblclick="if(!this.disabled)openProductModal(' + index + ')" ' +
      'onkeydown="if(event.key===\'Enter\'){this.blur();}"' + dis + '></td>' +
      '<td class="relative name-cell"><input class="w-full min-w-0 border px-1 py-1" value="' + esc(row.pname) + '" placeholder="品名（输入联想）" oninput="onPnameInput(' + index + ',this.value)" onkeydown="onNameKeydown(event,' + index + ')"' + dis + '>' +
      '<div class="name-suggest hidden fixed bg-white border shadow-lg z-50 max-h-64 overflow-auto text-xs" onscroll="onNameScroll(event,' + index + ')"></div></td>' +
      '<td class="relative spec-cell">' +
      '<input class="w-full min-w-0 border px-1 py-1 bg-gray-50 spec-input-with-eye' + specHidden + '" value="' + esc(displaySpec(row)) + '" placeholder="点此选择/输入规格" title="' + (row.hideSpec ? '打印时该行规格留空（已按客户记忆）' : '') + '" ' +
      'oninput="onSpecInput(' + index + ',this.value)" onfocus="openSpecSuggest(' + index + ')" ' +
      'onkeydown="onSpecKeydown(event,' + index + ')" onblur="onSpecBlur(' + index + ',event)"' + dis + '>' +
      '<button type="button" class="spec-eye-btn' + (row.hideSpec ? ' is-hidden' : '') + '" title="' + eyeTitle + '" aria-label="' + eyeTitle + '" onclick="togglePrintSpec(' + index + ')"' + eyeDisabled + '>' + specEyeIcon(row.hideSpec) + '</button>' +
      '<div class="spec-suggest hidden fixed bg-white border shadow-lg z-50 max-h-56 overflow-auto text-xs"></div></td>' +
      '<td>' + unitSelectHtml(row, index, dis) + '</td>' +
      '<td><input type="number" step="0.01" min="0" class="w-full border px-1 py-1" value="' + esc(row.qty) + '" placeholder="数量" oninput="updateQty(' + index + ',this.value)"' + dis + '></td>' +
      '<td>' +
      '<input type="number" step="0.01" min="0" class="w-full border px-1 py-1" list="priceList_' + index + '" value="' + esc(row.price) + '" placeholder="单价" oninput="updatePrice(' + index + ',this.value)" onchange="onPriceCommit(' + index + ')"' + dis + '>' +
      '<datalist id="priceList_' + index + '">' + historyOptions(row) + '</datalist>' +
      '<div class="price-history" id="priceHint_' + index + '" title="' + esc(historyTitle(row)) + '">' + esc(historyText(row)) + '</div>' +
      '</td>' +
      '<td><input class="w-full border px-1 py-1 bg-gray-50" readonly value="' + money(row.amount) + '"></td>' +
      '<td><input type="date" class="w-full border px-1 py-1 text-xs" value="' + esc(row.makeDate) + '" onchange="updateMakeDate(' + index + ',this.value)"' + dis + '></td>' +
      '<td><input type="date" class="w-full border px-1 py-1 text-xs" value="' + esc(row.expDate) + '" onchange="updateExpireDate(' + index + ',this.value)"' + dis + '></td>' +
      '<td><input class="w-full min-w-0 border px-1 py-1" value="' + esc(row.remark) + '" placeholder="备注" oninput="sellRows[' + index + '].remark=this.value"' + dis + '></td>' +
      '</tr>';
  }).join('');
  calcTotal();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatch(text, kw) {
  const safe = esc(text);
  if (!kw) return safe;
  try {
    return safe.replace(new RegExp('(' + escapeRegExp(esc(kw)) + ')', 'ig'), '<mark class="bg-yellow-200">$1</mark>');
  } catch (e) {
    return safe;
  }
}

function onPnameInput(index, value) {
  if (isOrderLocked()) return;
  const row = sellRows[index];
  if (!row) return;
  const previous = row.pname;
  row.pname = value;
  scheduleAudit('product_typing', { row_index: index, field: 'goods_name', value: value }, 1000);
  if (row.goods_id && value !== previous) {
    row.goods_id = null;
    row.pid = '';
    row.stock_id = null;
    row.spec = '';
    row.unit = '';
    row.packageQty = 1;
    row.packageUnit = '';
    row.saleUnit = '';
    row.priceUnit = '';
    row.price = '';
    row.priceAuto = false;
    row.specFor = '';
    row.specOptions = [];
    const tr = $('sellTableBody').rows[index];
    if (tr && tr.cells[1]) {
      const codeInput = tr.cells[1].querySelector('input');
      if (codeInput) codeInput.value = '';
      if (tr.cells[3]) {
        const specInput = tr.cells[3].querySelector('input');
        if (specInput) specInput.value = '';
      }
      if (tr.cells[4]) {
        const unitInput = tr.cells[4].querySelector('input');
        if (unitInput) unitInput.value = '';
      }
    }
    updatePriceCell(index);
  }
  clearTimeout(nameSuggestTimer);
  if (!String(value || '').trim()) {
    closeNameSuggest();
    return;
  }
  nameSuggestTimer = setTimeout(function () {
    searchNameSuggest(index, row.pname, false);
  }, 300);
}

async function searchNameSuggest(index, kw, append) {
  kw = String(kw || '').trim();
  if (!kw) return;
  if (!append) {
    nameSuggest = { index: index, items: [], active: -1, kw: kw, offset: 0, hasMore: false, loading: true };
  } else {
    if (nameSuggest.index !== index || nameSuggest.kw !== kw || !nameSuggest.hasMore || nameSuggest.loading) return;
    nameSuggest.loading = true;
  }
  try {
    const offset = append ? nameSuggest.items.length : 0;
    const data = await api('/goods/names?' + buildQuery({ kw: kw, limit: 20, offset: offset }));
    if (nameSuggest.index !== index || nameSuggest.kw !== kw) return;
    const items = data.items || [];
    nameSuggest.items = append ? nameSuggest.items.concat(items) : items;
    nameSuggest.hasMore = items.length >= 20;
    nameSuggest.loading = false;
    nameSuggest.active = -1;
    renderNameSuggest(index);
  } catch (err) {
    if (nameSuggest.index === index) {
      nameSuggest.loading = false;
      nameSuggest.items = [];
      nameSuggest.hasMore = false;
      renderNameSuggest(index, err.message);
    }
  }
}

function renderNameSuggest(index, errorText) {
  const tr = $('sellTableBody').rows[index];
  if (!tr || !tr.cells[2]) return;
  const box = tr.cells[2].querySelector('.name-suggest');
  if (!box) return;
  const input = tr.cells[2].querySelector('input');
  if (input) {
    const rect = input.getBoundingClientRect();
    box.style.left = rect.left + 'px';
    box.style.top = (rect.bottom + 1) + 'px';
    box.style.width = Math.max(rect.width, 340) + 'px';
  }
  if (nameSuggest.index !== index || !nameSuggest.kw) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  if (errorText) {
    box.innerHTML = '<div class="px-2 py-3 text-gray-400">联想暂不可用，可继续手工录入或使用“查”</div>';
    box.classList.remove('hidden');
    return;
  }
  if (!nameSuggest.items.length) {
    box.innerHTML = '<div class="px-2 py-3 text-gray-400">未查询到匹配商品</div>';
    box.classList.remove('hidden');
    return;
  }
  const keepScroll = box.scrollTop;
  box.innerHTML = nameSuggest.items.map(function (g, i) {
    return '<div class="name-suggest-item px-2 py-1.5 border-b cursor-pointer hover:bg-blue-50 ' +
      (i === nameSuggest.active ? 'bg-blue-100' : '') + '" data-name="' + esc(g.name) + '">' +
      '<span class="font-medium">' + highlightMatch(g.name, nameSuggest.kw) + '</span>' +
      '<span class="text-gray-400 ml-2">' + esc(g.spec_count) + ' 个规格</span>' +
      '<span class="text-gray-300 ml-2 font-mono">' + esc(g.sample_code || '') + '</span></div>';
  }).join('') + (nameSuggest.hasMore ? '<div class="px-2 py-1 text-center text-gray-400 name-more">向下滚动加载更多</div>' : '');
  box.querySelectorAll('.name-suggest-item').forEach(function (el) {
    el.addEventListener('mousedown', function (event) { event.preventDefault(); });
    el.addEventListener('click', function () {
      selectNameGoods(index, el.dataset.name);
    });
  });
  box.scrollTop = keepScroll;
  box.classList.remove('hidden');
}

function paintNameActive(index) {
  const tr = $('sellTableBody').rows[index];
  if (!tr) return;
  tr.cells[2].querySelectorAll('.name-suggest-item').forEach(function (el, i) {
    el.classList.toggle('bg-blue-100', i === nameSuggest.active);
  });
}

function onNameKeydown(event, index) {
  const tr = $('sellTableBody').rows[index];
  const box = tr && tr.cells[2] ? tr.cells[2].querySelector('.name-suggest') : null;
  if (!box || box.classList.contains('hidden')) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!nameSuggest.items.length) return;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    nameSuggest.active = (nameSuggest.active + delta + nameSuggest.items.length) % nameSuggest.items.length;
    paintNameActive(index);
    const activeEl = box.querySelectorAll('.name-suggest-item')[nameSuggest.active];
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    if (nameSuggest.items.length) {
      event.preventDefault();
      const item = nameSuggest.items[nameSuggest.active >= 0 ? nameSuggest.active : 0];
      selectNameGoods(index, item.name);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeNameSuggest();
  }
}

function onNameScroll(event, index) {
  const box = event.currentTarget;
  if (box.scrollTop + box.clientHeight >= box.scrollHeight - 12 && nameSuggest.hasMore && !nameSuggest.loading) {
    searchNameSuggest(index, nameSuggest.kw, true);
  }
}

function closeNameSuggest() {
  clearTimeout(nameSuggestTimer);
  document.querySelectorAll('.name-suggest').forEach(function (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
  });
  nameSuggest = { index: null, items: [], active: -1, kw: '', offset: 0, hasMore: false, loading: false };
}

function selectNameGoods(index, name) {
  closeNameSuggest();
  selectProductName(index, name);
}

function cellInput(index, cellIndex) {
  const tr = $('sellTableBody').rows[index];
  return tr && tr.cells[cellIndex] ? tr.cells[cellIndex].querySelector('input') : null;
}

function setCellValue(index, cellIndex, value) {
  const input = cellInput(index, cellIndex);
  if (input) input.value = value;
}

function positionSuggestBox(box, input, minWidth) {
  const rect = input.getBoundingClientRect();
  box.style.left = rect.left + 'px';
  box.style.top = (rect.bottom + 1) + 'px';
  box.style.width = Math.max(rect.width, minWidth) + 'px';
}

function specCacheKey(name) {
  return String(name || '').trim().toLowerCase() + '|' + (currentCustomer ? 'c' + currentCustomer.id : 'anon');
}

function loadSpecOptions(name) {
  const key = specCacheKey(name);
  if (specCache[key]) return Promise.resolve(specCache[key]);
  return api('/goods/specs?' + buildQuery({
    name: name,
    customer_id: currentCustomer ? currentCustomer.id : ''
  })).then(function (data) {
    specCache[key] = data.items || [];
    return specCache[key];
  }).catch(function (err) {
    toast('加载规格失败：' + err.message, 'err');
    return specCache[key] || [];
  });
}

function clearSpecCache(name) {
  const prefix = String(name || '').trim().toLowerCase() + '|';
  Object.keys(specCache).forEach(function (key) {
    if (key.indexOf(prefix) === 0) delete specCache[key];
  });
}

/* 同步规格下拉缓存里的单位/参考价 */
function updateSpecCacheGoods(name, goodsId, patch) {
  const prefix = String(name || '').trim().toLowerCase() + '|';
  Object.keys(specCache).forEach(function (key) {
    if (key.indexOf(prefix) !== 0) return;
    (specCache[key] || []).forEach(function (item) {
      if (Number(item.goods_id) !== Number(goodsId)) return;
      Object.assign(item, patch || {});
    });
  });
}

/* 单位切换：价格按当前单位价自动带出；不再反写商品主档单位 */
async function onUnitCommit(index, value) {
  const row = sellRows[index];
  if (!row) return;
  row.unit = String(value || '').trim();
  row.history = historyForUnit(row, row.unit);
  row.price = saleUnitPrice(row, row.unit);
  row.unitChanged = true;
  updatePriceCell(index);
  calcRowAmount(index);
  renderSellTable();
  auditOrder('unit_changed', {
    row_index: index,
    field: 'unit',
    value: row.unit,
    goods_id: row.goods_id || null,
    goods_code: row.pid || '',
    goods_name: row.pname || '',
    spec: row.spec || '',
    unit: row.unit || '',
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
    detail: { row: auditRowSnapshot(row, index) }
  });
}

function priceForUnit(row, basePrice) {
  if (basePrice === '' || basePrice === null || basePrice === undefined) return '';
  const unit = (row.units || []).find(function (u) { return u.unit === row.unit; });
  const factor = Number((unit && unit.factor) || 1);
  return Math.round(Number(basePrice) * factor * 10000) / 10000;
}

function unitPrice(row, unitName) {
  const unit = (row.units || []).find(function (u) { return u.unit === unitName; });
  if (unit && unit.price !== null && unit.price !== undefined) return Number(unit.price);
  const baseUnit = (row.units || []).find(function (u) { return u.is_base; });
  const basePrice = baseUnit && baseUnit.price !== null && baseUnit.price !== undefined
    ? Number(baseUnit.price)
    : row.defaultPrice;
  if (basePrice === null || basePrice === undefined || basePrice === '') return '';
  return Math.round(basePrice * Number((unit && unit.factor) || 1) * 10000) / 10000;
}

/* 包装单位显示完整规格：400g + 件(40倍/袋) => 400g*40袋 */
function displaySpec(row) {
  const spec = String(row.spec || '').trim();
  if (!spec || spec.indexOf('*') >= 0 || spec.indexOf('×') >= 0) return spec;
  const unitName = String(row.unit || '').trim();
  const baseUnit = row.baseUnit || ((row.units || []).find(function (u) { return u.is_base; }) || {}).unit || '';
  const slashIndex = spec.indexOf('/');
  if (slashIndex >= 0) {
    const specUnit = spec.slice(slashIndex + 1).trim();
    if (unitName && specUnit === unitName) return spec;
    if (unitName && baseUnit && unitName === baseUnit) return '';
    return spec;
  }
  if (baseUnit && spec.toLowerCase().slice(-baseUnit.length) === baseUnit.toLowerCase()) return spec;
  const unit = (row.units || []).find(function (u) { return u.unit === unitName; });
  const factor = Number((unit && unit.factor) || 1);
  if (factor > 1 && baseUnit) {
    return spec + '*' + String(factor) + baseUnit;
  }
  return spec;
}

/* 记住价格后同步规格下拉里的客户价显示 */
function updateSpecCachePrice(name, goodsId, price, history) {
  const prefix = String(name || '').trim().toLowerCase() + '|';
  Object.keys(specCache).forEach(function (key) {
    if (key.indexOf(prefix) !== 0) return;
    (specCache[key] || []).forEach(function (item) {
      if (Number(item.goods_id) !== Number(goodsId)) return;
      item.price = price;
      item.history = history || item.history || [];
    });
  });
}

/* 选定品名后：清空旧规格/编码/价格，加载该品名的全部规格并弹出选择框 */
async function selectProductName(index, name) {
  if (isOrderLocked()) return;
  const row = sellRows[index];
  if (!row) return;
  name = String(name || '').trim();
  if (!name) return;
  row.pname = name;
  row.pid = '';
  row.goods_id = null;
  row.stock_id = null;
  row.spec = '';
  row.unit = '';
  row.price = '';
  row.priceAuto = false;
  row.history = [];
  row.defaultPrice = null;
  row.specFor = '';
  row.specOptions = [];
  setCellValue(index, 2, name);
  setCellValue(index, 1, '');
  setCellValue(index, 3, '');
  setCellValue(index, 4, '');
  updatePriceCell(index);
  calcRowAmount(index);
  const items = await loadSpecOptions(name);
  if (sellRows[index] !== row) return;
  row.specOptions = items;
  row.specFor = name;
  openSpecSuggest(index);
  const input = cellInput(index, 3);
  if (input) input.focus();
}

function openSpecSuggest(index) {
  const row = sellRows[index];
  const tr = $('sellTableBody').rows[index];
  if (!row || !tr || !tr.cells[3]) return;
  const box = tr.cells[3].querySelector('.spec-suggest');
  const input = tr.cells[3].querySelector('input');
  if (!box || !input) return;
  const name = String(row.pname || '').trim();
  if (!name) {
    positionSuggestBox(box, input, 320);
    box.innerHTML = '<div class="px-2 py-3 text-gray-400">请先输入并选择品名，再选择规格</div>';
    box.classList.remove('hidden');
    specSuggest = { index: index, items: [], active: -1, name: '', loading: false };
    return;
  }
  if (row.specFor !== name) {
    specSuggest = { index: index, items: [], active: -1, name: name, loading: true };
    positionSuggestBox(box, input, 340);
    box.innerHTML = '<div class="px-2 py-3 text-gray-400">加载规格…</div>';
    box.classList.remove('hidden');
    loadSpecOptions(name).then(function (items) {
      const current = sellRows[index];
      if (!current) return;
      current.specOptions = items;
      current.specFor = name;
      if (specSuggest.index === index && specSuggest.name === name) {
        specSuggest.items = items;
        specSuggest.loading = false;
        renderSpecSuggest(index);
      }
    });
    return;
  }
  specSuggest = { index: index, items: row.specOptions || [], active: -1, name: name, loading: false };
  renderSpecSuggest(index);
}

function renderSpecSuggest(index) {
  const row = sellRows[index];
  const tr = $('sellTableBody').rows[index];
  if (!row || !tr || !tr.cells[3]) return;
  const box = tr.cells[3].querySelector('.spec-suggest');
  const input = tr.cells[3].querySelector('input');
  if (!box || !input) return;
  const kw = String(row.spec || '').trim().toLowerCase();
  const all = specSuggest.items || [];
  if (specSuggest.loading) {
    positionSuggestBox(box, input, 360);
    box.innerHTML = '<div class="px-2 py-3 text-gray-400">加载规格…</div>';
    box.classList.remove('hidden');
    return;
  }
  const items = kw ? all.filter(function (item) {
    return String(item.spec || '').toLowerCase().indexOf(kw) >= 0 ||
      String(item.code || '').toLowerCase().indexOf(kw) >= 0;
  }) : all;
  positionSuggestBox(box, input, 360);
  if (!items.length) {
    box.innerHTML = '<div class="px-2 py-2 text-gray-500">' + (kw
      ? '没有匹配的规格。按回车或离开输入框，将按“' + esc(row.pname) + ' / ' + esc(row.spec) + '”新建规格并自动生成编码。'
      : '该品名暂无规格。直接输入新规格（如 500g*12），回车或离开输入框后自动生成编码。') + '</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = items.map(function (item, i) {
    const priceText = item.price !== null && item.price !== undefined
      ? '客户价 ￥' + money(item.price)
      : (item.default_price !== null && item.default_price !== undefined ? '参考 ￥' + money(item.default_price) : '无价格记忆');
    return '<div class="spec-suggest-item px-2 py-1.5 border-b cursor-pointer hover:bg-blue-50 ' +
      (i === specSuggest.active ? 'bg-blue-100' : '') + '" data-spec="' + esc(item.spec) + '">' +
      '<span class="font-medium">' + esc(item.spec || '（无规格）') + '</span>' +
      '<span class="text-gray-400 ml-2">' + esc(item.unit || '') + '</span>' +
      '<span class="text-gray-500 ml-2 font-mono">' + esc(item.code) + '</span>' +
      '<span class="text-primaryBlue ml-2">' + esc(priceText) + '</span></div>';
  }).join('') + '<div class="px-2 py-1 text-gray-400 border-t">没有合适规格？直接输入新规格，回车自动生成编码</div>';
  box.querySelectorAll('.spec-suggest-item').forEach(function (el) {
    el.addEventListener('mousedown', function (event) { event.preventDefault(); });
    el.addEventListener('click', function () { chooseSpec(index, el.dataset.spec); });
  });
  box.classList.remove('hidden');
}

function onSpecInput(index, value) {
  const row = sellRows[index];
  if (!row) return;
  const previous = row.spec;
  row.spec = value;
  if (row.goods_id && value !== previous) {
    row.goods_id = null;
    row.pid = '';
    row.stock_id = null;
    row.unit = '';
    row.history = [];
    row.defaultPrice = null;
    row.price = '';
    row.priceAuto = false;
    setCellValue(index, 1, '');
    setCellValue(index, 4, '');
    updatePriceCell(index);
    calcRowAmount(index);
  }
  if (specSuggest.index !== index) openSpecSuggest(index);
  else renderSpecSuggest(index);
}

function onSpecKeydown(event, index) {
  const tr = $('sellTableBody').rows[index];
  const box = tr && tr.cells[3] ? tr.cells[3].querySelector('.spec-suggest') : null;
  if (event.key === 'Escape') {
    closeSpecSuggest();
    return;
  }
  const visible = box && !box.classList.contains('hidden')
    ? Array.prototype.slice.call(box.querySelectorAll('.spec-suggest-item'))
    : [];
  if (!visible.length) {
    if (event.key === 'Enter') {
      event.preventDefault();
      closeSpecSuggest();
      commitSpecText(index);
      setTimeout(function () {
        const unitInput = cellInput(index, 4);
        if (unitInput) unitInput.focus();
      }, 0);
    }
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    specSuggest.active = (specSuggest.active + delta + visible.length) % visible.length;
    visible.forEach(function (el, i) { el.classList.toggle('bg-blue-100', i === specSuggest.active); });
    if (visible[specSuggest.active]) visible[specSuggest.active].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const activeEl = visible[specSuggest.active >= 0 ? specSuggest.active : 0];
    if (activeEl) chooseSpec(index, activeEl.dataset.spec);
    else commitSpecText(index);
    setTimeout(function () {
      const unitInput = cellInput(index, 4);
      if (unitInput) unitInput.focus();
    }, 0);
  }
}

function onSpecBlur(index, event) {
  // 点击同一单元格内的“选”按钮时只展开规格，不触发新规格建档
  const next = event && event.relatedTarget;
  if (next && next.closest && next.closest('.spec-cell')) return;
  setTimeout(function () { commitSpecText(index); }, 150);
}

function toggleSpecSuggest(index) {
  const tr = $('sellTableBody').rows[index];
  const box = tr && tr.cells[3] ? tr.cells[3].querySelector('.spec-suggest') : null;
  if (box && !box.classList.contains('hidden') && specSuggest.index === index) {
    closeSpecSuggest();
    return;
  }
  openSpecSuggest(index);
}

function closeSpecSuggest() {
  document.querySelectorAll('.spec-suggest').forEach(function (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
  });
  specSuggest = { index: null, items: [], active: -1, name: '', loading: false };
}

function chooseSpec(index, specText) {
  const row = sellRows[index];
  if (!row) return;
  closeSpecSuggest();
  const item = (row.specOptions || []).find(function (s) {
    return String(s.spec || '') === String(specText || '');
  });
  if (!item) return;
  applySpecToRow(index, item);
}

function applySpecToRow(index, item) {
  if (isOrderLocked()) return;
  const row = sellRows[index];
  if (!row) return;
  row.goods_id = Number(item.goods_id);
  row.pid = item.code || '';
  row.spec = item.spec || '';
  row.allowUnitEdit = !String(item.spec || '').trim();
  row.units = item.units || [];
  row.baseUnit = item.base_unit || item.unit || '';
  row.unit = item.default_sale_unit || row.baseUnit;
  row.defaultPrice = item.default_price;
  row.shelfLifeDays = Number(item.shelf_life_days || 0);
  row.expireManual = false;
  row.stock_id = null;
  row.makeDate = '';
  row.expDate = '';
  const hasCustomerPrice = item.price !== null && item.price !== undefined;
  if (currentCustomer && row.goods_id) {
    const existing = priceMap[row.goods_id] || {};
    priceMap[row.goods_id] = Object.assign({}, existing, {
      goods_id: row.goods_id,
      price: hasCustomerPrice ? item.price : (existing.price !== undefined ? existing.price : null),
      history: item.history || existing.history || [],
      order_count: item.order_count || existing.order_count || 0
    });
  }
  row.history = historyForUnit(row, row.unit);
  const nextPrice = saleUnitPrice(row, row.unit);
  row.price = nextPrice === null || nextPrice === undefined ? '' : nextPrice;
  row.priceAuto = row.price !== '';
  row.unitChanged = false;
  renderSellTable();
  calcRowAmount(index);
  auditOrder('spec_selected', {
    row_index: index,
    goods_id: row.goods_id || null,
    goods_code: row.pid || '',
    goods_name: row.pname || '',
    spec: row.spec || '',
    unit: row.unit || '',
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
    detail: { row: auditRowSnapshot(row, index), rows: auditRowsSnapshot() }
  });
  if (stockConfig.mode === 'batch') {
    openBatchPicker(index, { id: row.goods_id, code: row.pid, name: row.pname });
  } else {
    loadDateMemo(index, { id: row.goods_id });
    const priceInput = cellInput(index, 6);
    if (priceInput) { priceInput.focus(); priceInput.select(); }
  }
}

/* 规格输入框失焦/回车：已有规格直接套用，新规格自动建档并生成编码 */
function commitSpecText(index) {
  const row = sellRows[index];
  if (!row || isOrderLocked() || row.specBusy) return;
  const name = String(row.pname || '').trim();
  const spec = String(row.spec || '').trim();
  if (spec && !name) {
    toast('请先输入并选择品名', 'err');
    return;
  }
  if (!name || !spec) return;
  if (row.goods_id && String(row.spec).trim() === spec) return;
  const matched = (row.specOptions || []).find(function (item) {
    return String(item.spec || '').trim().toLowerCase() === spec.toLowerCase();
  });
  if (matched) {
    applySpecToRow(index, matched);
    return;
  }
  createSpec(index, spec);
}

async function createSpec(index, specText) {
  const row = sellRows[index];
  if (!row || row.specBusy) return;
  const name = String(row.pname || '').trim();
  const spec = String(specText || '').trim();
  if (!name || !spec) return;
  row.specBusy = true;
  try {
    const data = await api('/goods/spec', {
      method: 'POST',
      body: {
        name: name,
        spec: spec,
        unit: row.unit || '',
        price: row.price === '' || row.price === null || row.price === undefined ? null : Number(row.price),
        customer_id: currentCustomer ? currentCustomer.id : null
      }
    });
    clearSpecCache(name);
    const goods = data.goods || {};
    const priceInfo = data.price || null;
    toast(data.created
      ? ('新规格“' + goods.name + ' / ' + goods.spec + '”已建档，自动编码 ' + goods.code)
      : ('使用已有规格，编码 ' + goods.code), 'ok');
    if (sellRows[index] !== row) return;
    applySpecToRow(index, {
      goods_id: goods.id,
      code: goods.code,
      name: goods.name,
      spec: goods.spec,
      unit: data.unit || goods.unit,
      base_unit: goods.base_unit,
      units: goods.units || [],
      default_sale_unit: goods.default_sale_unit,
      default_purchase_unit: goods.default_purchase_unit,
      shelf_life_days: goods.shelf_life_days,
      default_price: goods.default_price,
      price: priceInfo ? priceInfo.price : null,
      history: priceInfo ? priceInfo.history : []
    });
  } catch (err) {
    toast('新规格建档失败：' + err.message, 'err');
  } finally {
    row.specBusy = false;
  }
}

/* 单价输入完成：选了客户写入客户价记忆；未选客户写入商品参考价 */
async function saveReferencePrice(row, price) {
  const unit = (row.units || []).find(function (u) { return u.unit === row.unit; });
  const factor = Number((unit && unit.factor) || 1);
  const normalized = factor > 1 ? Math.round(Number(price) / factor * 10000) / 10000 : price;
  if (row.defaultPrice !== null && row.defaultPrice !== undefined &&
      Math.abs(Number(row.defaultPrice) - normalized) < 0.005) return;
  const saved = await api('/goods/' + row.goods_id + '/default-price', {
    method: 'PUT',
    body: { default_price: normalized }
  });
  row.defaultPrice = saved.default_price;
  const goods = findGoodsById(row.goods_id);
  if (goods) goods.default_price = saved.default_price;
  updateSpecCacheGoods(row.pname, row.goods_id, { default_price: saved.default_price });
}

async function onPriceCommit(index) {
  const row = sellRows[index];
  if (!row || !row.goods_id) return;
  if (row.price === '' || row.price === null || row.price === undefined) return;
  const price = Number(row.price);
  if (!isFinite(price) || price < 0) return;
  auditOrder('price_committed', {
    row_index: index,
    field: 'price',
    value: row.price,
    goods_id: row.goods_id,
    goods_code: row.pid || '',
    goods_name: row.pname || '',
    spec: row.spec || '',
    unit: row.unit || '',
    qty: Number(row.qty) || 0,
    price: price,
    detail: { row: auditRowSnapshot(row, index) }
  });

  if (!currentCustomer) {
    try {
      await saveReferencePrice(row, price);
    } catch (err) {
      toast('参考价保存失败：' + err.message, 'err');
    }
    return;
  }
  try {
    const unitData = customerUnitPriceData(row, row.unit);
    const remembered = unitData && unitData.price !== null && unitData.price !== undefined
      ? Math.abs(Number(unitData.price) - price) < 0.005
      : (row.unit === row.baseUnit && priceMap[row.goods_id] && priceMap[row.goods_id].price !== null &&
         priceMap[row.goods_id].price !== undefined && Math.abs(Number(priceMap[row.goods_id].price) - price) < 0.005);
    if (!remembered) {
      const saved = await api('/prices', {
        method: 'PUT',
        body: { user_id: currentCustomer.id, goods_id: row.goods_id, price: price, unit: row.unit }
      });
      const entry = priceMap[row.goods_id] || { goods_id: row.goods_id, price: null, history: [] };
      entry.unit_prices = entry.unit_prices || {};
      entry.unit_prices[row.unit] = {
        price: Number(saved.price !== null && saved.price !== undefined ? saved.price : price),
        history: saved.history || [],
        order_count: saved.order_count || 0,
        last_used_at: saved.last_used_at || null
      };
      if (row.unit === row.baseUnit || !row.baseUnit) {
        entry.price = Number(saved.price !== null && saved.price !== undefined ? saved.price : price);
        entry.history = saved.history || [];
        updateSpecCachePrice(row.pname, row.goods_id, entry.price, entry.history);
      }
      priceMap[row.goods_id] = entry;
      row.history = saved.history || [];
      updatePriceCell(index);
      toast('已记住 ' + currentCustomer.name + ' 的客户价 ￥' + money(price), 'ok');
    }
    // 新商品还没有参考价时，把第一次录入的单价补进商品档案，商品资料里可直接看到
    if (row.defaultPrice === null || row.defaultPrice === undefined) {
      await saveReferencePrice(row, price);
    }
  } catch (err) {
    toast('客户价记忆失败：' + err.message, 'err');
  }
}

document.addEventListener('mousedown', function (event) {
  if (!event.target.closest('.name-suggest') && !event.target.closest('.name-cell')) closeNameSuggest();
  if (!event.target.closest('.spec-suggest') && !event.target.closest('.spec-cell')) closeSpecSuggest();
  if (!event.target.closest('.purchase-name-suggest') && !event.target.closest('.purchase-name-cell')) closePurchaseNameSuggest();
  if (!event.target.closest('.purchase-spec-suggest') && !event.target.closest('.purchase-spec-cell')) closePurchaseSpecSuggest();
});

function modalVisible(id) {
  const el = $(id);
  return !!el && !el.classList.contains('hidden');
}

/* Esc 关闭当前弹窗；Enter 在表格内按从左到右、从上到下跳到下一格，末格自动新建行 */
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    closeNameSuggest();
    closeSpecSuggest();
    closePurchaseNameSuggest();
    closePurchaseSpecSuggest();
    if (modalVisible('printPreviewModal')) { closePrintPreview(); event.preventDefault(); return; }
    if (modalVisible('priceModal')) { closePriceModal(); event.preventDefault(); return; }
    if (modalVisible('goodsModal')) { closeGoodsModal(); event.preventDefault(); return; }
    if (modalVisible('customerModal')) { closeCustomerModal(); event.preventDefault(); return; }
    if (modalVisible('batchModal')) { closeBatchModal(); event.preventDefault(); return; }
    if (modalVisible('productModal')) { closeProductModal(); event.preventDefault(); return; }
    return;
  }
  if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return;
  const target = event.target;
  if (!target || !target.matches || !target.matches('input, select')) return;
  if (target.type === 'checkbox' || target.type === 'radio' || target.readOnly || target.disabled) return;
  const tr = target.closest('tr');
  if (!tr) return;
  const fields = Array.prototype.slice.call(tr.querySelectorAll('input, select, textarea')).filter(function (el) {
    return !el.disabled && !el.readOnly && el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio';
  });
  const index = fields.indexOf(target);
  if (index < 0) return;
  event.preventDefault();
  const tbody = tr.parentElement;
  const rowIndex = Array.prototype.indexOf.call(tbody.rows, tr);
  if (index < fields.length - 1) {
    setTimeout(function () {
      const field = fieldByIndex(tbody.id, rowIndex, index + 1);
      if (field) { field.focus(); if (field.select) field.select(); }
    }, 0);
    return;
  }
  if (tbody && tbody.id === 'sellTableBody') {
    if (isOrderLocked()) { target.blur(); return; }
    addRow();
    setTimeout(function () { focusFirstField('sellTableBody'); }, 0);
  } else if (tbody && tbody.id === 'purchaseTableBody') {
    addPurchaseRow();
    setTimeout(function () { focusFirstField('purchaseTableBody'); }, 0);
  } else {
    target.blur();
  }
});

function fieldByIndex(tbodyId, rowIndex, fieldIndex) {
  const tbody = $(tbodyId);
  if (!tbody || !tbody.rows[rowIndex]) return null;
  const fields = Array.prototype.slice.call(tbody.rows[rowIndex].querySelectorAll('input, select, textarea')).filter(function (el) {
    return !el.disabled && !el.readOnly && el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio';
  });
  return fields[fieldIndex] || null;
}

function focusFirstField(tbodyId) {
  const tbody = $(tbodyId);
  if (!tbody || !tbody.rows.length) return;
  const tr = tbody.rows[tbody.rows.length - 1];
  const field = Array.prototype.slice.call(tr.querySelectorAll('input, select')).filter(function (el) {
    return !el.disabled && !el.readOnly && el.type !== 'hidden';
  })[0];
  if (field) field.focus();
}

document.addEventListener('scroll', function (event) {
  const target = event.target;
  if (target && target.classList) {
    if (target.classList.contains('name-suggest')) return;
    if (target.classList.contains('spec-suggest')) return;
    if (target.classList.contains('purchase-name-suggest')) return;
    if (target.classList.contains('purchase-spec-suggest')) return;
  }
  closeNameSuggest();
  closeSpecSuggest();
  closePurchaseNameSuggest();
  closePurchaseSpecSuggest();
}, true);

window.addEventListener('resize', function () {
  closeNameSuggest();
  closeSpecSuggest();
  closePurchaseNameSuggest();
  closePurchaseSpecSuggest();
  if (statBarChart) statBarChart.resize();
  if (statTrendChart) statTrendChart.resize();
  if (statPieChart) statPieChart.resize();
});

function applyGoodsToRow(index, goods, opts) {
  if (isOrderLocked()) return;
  const row = sellRows[index];
  if (!row) return;
  opts = opts || {};
  row.pid = goods.code;
  row.goods_id = goods.id;
  row.pname = goods.name;
  row.spec = goods.spec || '';
  row.allowUnitEdit = !String(goods.spec || '').trim();
  row.units = goods.units || [];
  row.baseUnit = goods.base_unit || goods.unit || '';
  row.unit = goods.default_sale_unit || row.baseUnit;
  row.defaultPrice = goods.default_price;
  row.shelfLifeDays = Number(goods.shelf_life_days || 0);
  row.expireManual = false;
  row.stock_id = null;
  row.specFor = '';
  row.specOptions = [];
  if (!opts.keepDates) {
    row.makeDate = '';
    row.expDate = '';
  }
  row.price = '';
  row.priceAuto = false;
  row.history = [];
  applyCustomerPrice(index, true);
  renderSellTable();
  calcRowAmount(index);
  auditOrder('goods_selected', {
    row_index: index,
    goods_id: row.goods_id || null,
    goods_code: row.pid || '',
    goods_name: row.pname || '',
    spec: row.spec || '',
    unit: row.unit || '',
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
    detail: { row: auditRowSnapshot(row, index), rows: auditRowsSnapshot() }
  });
  if (stockConfig.mode === 'batch') {
    openBatchPicker(index, goods);
  } else {
    loadDateMemo(index, goods);
  }
}

async function loadDateMemo(index, goods) {
  try {
    const memo = await api('/goods/' + goods.id + '/date-memo');
    if (!memo) return;
    const row = sellRows[index];
    if (!row || Number(row.goods_id) !== Number(goods.id)) return;
    // 用户在等待请求期间已经手输了日期，以手输为准
    if (row.makeDate || row.expDate) return;
    row.makeDate = memo.produce_date || '';
    row.expDate = memo.expire_date || '';
    // 效期记忆只有生产日期时，按商品保质期自动补“保质期至”
    if (row.makeDate && !row.expDate && Number(row.shelfLifeDays) > 0) {
      row.expDate = addDays(row.makeDate, Number(row.shelfLifeDays));
    }
    renderSellTable();
  } catch (err) {
    // 联想/记忆失败不阻塞录入
  }
}

function addDays(dateText, days) {
  if (!dateText) return '';
  const d = new Date(dateText + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return localDate(d);
}

function updateMakeDate(index, value) {
  const row = sellRows[index];
  if (!row) return;
  row.makeDate = value;
  if (row.shelfLifeDays > 0 && value && !row.expireManual) {
    row.expDate = addDays(value, row.shelfLifeDays);
    row.expireAuto = true;
    const tr = $('sellTableBody').rows[index];
    if (tr && tr.cells[9]) {
      const input = tr.cells[9].querySelector('input');
      if (input) input.value = row.expDate;
    }
  }
}

function updateExpireDate(index, value) {
  const row = sellRows[index];
  if (!row) return;
  row.expDate = value;
  row.expireManual = true;
  row.expireAuto = false;
}

function openBatchPicker(index, goods) {
  batchTargetRow = { index: index, goods: goods };
  $('batchGoodsName').textContent = goods.code + ' ' + goods.name;
  const tbody = $('batchModalBody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-6">加载批次…</td></tr>';
  const modal = $('batchModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  api('/goods/' + goods.id + '/batches?' + buildQuery({ bill_date: $('sellDate').value })).then(function (data) {
    if (!batchTargetRow || Number(batchTargetRow.goods.id) !== Number(goods.id)) return;
    const rows = data.items || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-6">暂无可用批次，将按先进先出自动出库</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (b) {
      return '<tr class="batch-row hover:bg-blue-50 cursor-pointer" data-stock="' + b.stock_id + '" data-produce="' + esc(b.produce_date || '') + '" data-expire="' + esc(b.expire_date || '') + '">' +
        '<td class="border px-2 py-1 font-mono">' + esc(b.batch_no) + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(b.stock_qty) + '</td>' +
        '<td class="border px-2 py-1 text-right">￥' + money(b.purchase_price) + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(b.produce_date || '-') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(b.expire_date || '-') + '</td></tr>';
    }).join('');
    tbody.querySelectorAll('.batch-row').forEach(function (el) {
      el.addEventListener('click', function () {
        chooseBatch(el.dataset.stock, el.dataset.produce, el.dataset.expire);
      });
    });
  }).catch(function (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-red-500 py-6">' + esc(err.message) + '</td></tr>';
  });
}

function chooseBatch(stockId, produceDate, expireDate) {
  if (!batchTargetRow) return;
  const row = sellRows[batchTargetRow.index];
  if (row) {
    row.stock_id = Number(stockId);
    row.makeDate = produceDate || '';
    row.expDate = expireDate || '';
    renderSellTable();
  }
  closeBatchModal();
}

function closeBatchModal() {
  const modal = $('batchModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  batchTargetRow = null;
}

function updateQty(index, value) {
  const row = sellRows[index];
  if (!row) return;
  row.qty = value;
  calcRowAmount(index);
  scheduleAudit('qty_typing', { row_index: index, field: 'qty', value: String(value) });
}

function updatePrice(index, value) {
  const row = sellRows[index];
  if (!row) return;
  row.price = value;
  row.priceUnit = row.unit;
  row.priceAuto = false;
  calcRowAmount(index);
  scheduleAudit('price_typing', { row_index: index, field: 'price', value: String(value) });
}

function calcRowAmount(index) {
  const row = sellRows[index];
  if (!row) return;
  row.amount = Math.round((Number(row.qty || 0) * Number(row.price || 0) + Number.EPSILON) * 100) / 100;
  const tr = $('sellTableBody').rows[index];
  if (tr && tr.cells[7]) {
    const input = tr.cells[7].querySelector('input');
    if (input) input.value = money(row.amount);
  }
  calcTotal();
}

function calcTotal() {
  const total = sellRows.reduce(function (sum, row) { return sum + (Number(row.amount) || 0); }, 0);
  $('totalAmount').textContent = money(total);
}

function onPidChange(index) {
  if (isOrderLocked()) return;
  const row = sellRows[index];
  if (!row) return;
  row.pid = String(row.pid || '').trim();
  const tr = $('sellTableBody').rows[index];
  if (tr) {
    const codeInput = tr.cells[1].querySelector('input');
    if (codeInput) codeInput.value = row.pid;
  }
  const goods = findGoodsByCode(row.pid);
  if (goods) {
    applyGoodsToRow(index, goods);
    return;
  }
  row.goods_id = null;
  row.history = [];
  row.defaultPrice = null;
  if (row.priceAuto) {
    row.price = '';
    row.priceAuto = false;
  }
  applyCustomerPrice(index, false);
  updatePriceCell(index);
  calcRowAmount(index);
}

function priceBySaleUnit(price, row) {
  return price;
}

function applyCustomerPrice(index, overwrite) {
  const row = sellRows[index];
  if (!row) return;
  const goods = row.goods_id ? findGoodsById(row.goods_id) : findGoodsByCode(row.pid);
  if (goods) row.goods_id = goods.id;

  row.history = historyForUnit(row, row.unit);
  const price = saleUnitPrice(row, row.unit);
  if (price !== '' && price !== null && price !== undefined &&
      (overwrite || row.priceAuto || row.price === '' || row.price === null || row.price === undefined)) {
    row.price = Math.round(Number(price) * 10000) / 10000;
    row.priceAuto = true;
  }
}

function updatePriceCell(index) {
  const row = sellRows[index];
  const tr = $('sellTableBody').rows[index];
  if (!row || !tr || !tr.cells[6]) return;
  const input = tr.cells[6].querySelector('input[type="number"]');
  if (input) input.value = row.price === '' || row.price === null || row.price === undefined ? '' : row.price;
  const datalist = $('priceList_' + index);
  if (datalist) datalist.innerHTML = historyOptions(row);
  const hint = $('priceHint_' + index);
  if (hint) {
    hint.textContent = historyText(row);
    hint.title = historyTitle(row);
  }
}

function applyPricesToEmptyRows() {
  sellRows.forEach(function (row, index) {
    applyCustomerPrice(index, false);
    updatePriceCell(index);
    calcRowAmount(index);
  });
}

/**
 * 切换客户时按新客户价格表刷新：
 * - 原先为空 / 原先是上一个客户自动带出的价格 => 用新客户价格覆盖
 * - 手工改过的价格保留
 * - 新客户没有该商品价格时，清掉上一个客户自动带出的价格
 */
function applyPricesForCustomer() {
  sellRows.forEach(function (row, index) {
    if (!row.goods_id) return;
    const goods = findGoodsById(row.goods_id);
    const wasAuto = row.priceAuto || row.price === '' || row.price === null || row.price === undefined;
    row.specFor = '';
    row.specOptions = [];

    row.history = historyForUnit(row, row.unit);
    row.defaultPrice = goods ? goods.default_price : null;
    if (wasAuto) {
      const nextPrice = saleUnitPrice(row, row.unit);
      row.price = nextPrice === null || nextPrice === undefined ? '' : nextPrice;
      row.priceAuto = row.price !== '';
      row.history = historyForUnit(row, row.unit);
    }
    updatePriceCell(index);
    calcRowAmount(index);
  });
}

/* ==================== 商品选择弹窗 ==================== */
function openProductModal(rowIndex) {
  currentEditRowIndex = rowIndex;
  const modal = $('productModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  $('productSearch').value = '';
  filterProductList();
}

function closeProductModal() {
  const modal = $('productModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  currentEditRowIndex = null;
}

function filterProductList() {
  const keyword = $('productSearch').value.trim().toLowerCase();
  const tbody = $('productModalBody');
  const list = goodsList.filter(function (g) {
    return String(g.code).toLowerCase().indexOf(keyword) >= 0 || String(g.name).toLowerCase().indexOf(keyword) >= 0;
  }).slice(0, 300);
  tbody.innerHTML = list.length ? list.map(function (g) {
    const entry = priceMap[g.id];
    const priceText = entry && entry.price !== null && entry.price !== undefined
      ? '￥' + money(entry.price)
      : (g.default_price !== null && g.default_price !== undefined ? '参考 ￥' + money(g.default_price) : '-');
    return '<tr class="hover:bg-blue-100 cursor-pointer product-row" data-code="' + esc(g.code) + '">' +
      '<td class="border px-2 py-1">' + esc(g.code) + '</td>' +
      '<td class="border px-2 py-1">' + esc(g.name) + '</td>' +
      '<td class="border px-2 py-1">' + esc(g.spec) + '</td>' +
      '<td class="border px-2 py-1">' + esc(g.unit) + '</td>' +
      '<td class="border px-2 py-1 text-right text-primaryBlue">' + priceText + '</td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="5" class="text-center text-gray-400 py-6">没有匹配的商品，可在下方新增</td></tr>';

  tbody.querySelectorAll('.product-row').forEach(function (row) {
    row.addEventListener('click', function () { selectProduct(this.dataset.code); });
  });
}

function selectProduct(code) {
  if (currentEditRowIndex === null) return;
  const goods = findGoodsByCode(code);
  if (!goods) return;
  const index = currentEditRowIndex;
  closeProductModal();
  applyGoodsToRow(index, goods);
}

async function addProduct() {
  const code = $('addProdCode').value.trim();
  const name = $('addProdName').value.trim();
  if (!code || !name) return toast('编码和品名必填', 'err');
  try {
    await api('/goods', {
      method: 'POST',
      body: { code: code, name: name, spec: $('addProdSpec').value.trim(), unit: $('addProdUnit').value.trim() }
    });
    $('addProdCode').value = '';
    $('addProdName').value = '';
    $('addProdSpec').value = '';
    $('addProdUnit').value = '';
    await refreshGoods();
    filterProductList();
    toast('商品已新增', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

/* ==================== 商品资料 ==================== */
async function refreshGoods() {
  goodsList = await fetchAll('/goods');
  loaded.goods = true;
  specCache = {};
  purchaseSpecCache = {};
  if (currentCustomer) {
    loadCustomerPrices(currentCustomer.id).catch(function () {});
  } else {
    priceMap = {};
  }
  renderGoodsManage();
  syncSellRowsWithGoods();
}

/* 商品资料修改后，同步已在销售页里的同一商品行，不用重启软件 */
function syncSellRowsWithGoods() {
  let changed = false;
  sellRows.forEach(function (row) {
    if (!row.goods_id) return;
    const goods = findGoodsById(row.goods_id);
    if (!goods) return;
    const units = goods.units || [];
    row.pname = goods.name || row.pname;
    row.spec = goods.spec || row.spec;
    row.units = units;
    row.baseUnit = goods.base_unit || goods.unit || row.baseUnit;
    row.defaultPrice = goods.default_price;
    if (!units.some(function (u) { return u.unit === row.unit; })) {
      row.unit = row.baseUnit;
    }
    row.specFor = '';
    row.specOptions = [];
    changed = true;
  });
  if (changed && $('sellTableBody') && !isOrderLocked()) renderSellTable();
}

function unitsText(goods) {
  const units = goods.units || [];
  if (!units.length) return goods.unit || '-';
  return units.map(function (u) {
    return u.unit + (u.is_base ? '' : '×' + Number(u.factor));
  }).join(' / ');
}

function unitsFormText(goods) {
  const units = (goods.units || []).filter(function (u) { return !u.is_base && Number(u.factor) > 1; });
  return units.map(function (u) { return u.unit + '=' + Number(u.factor); }).join('\n');
}

function parseUnitsForm(text) {
  return String(text || '').split(/\n|；|;/).map(function (line) {
    const match = line.trim().match(/^([^=＝\s]+)\s*[=＝]\s*(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    return { unit: match[1], factor: Number(match[2]) };
  }).filter(function (u) { return u && u.factor > 1; });
}

function editGoodsCaseUnit(units) {
  const base = ($('editGoodsUnit') ? $('editGoodsUnit').value : '').trim();
  let best = null;
  (units || parseUnitsForm($('editGoodsUnits') ? $('editGoodsUnits').value : '')).forEach(function (u) {
    if (u.unit === base) return;
    if (!best || Number(u.factor) > Number(best.factor)) best = u;
  });
  return best;
}

function editGoodsCaseFactor(units) {
  const unit = editGoodsCaseUnit(units);
  return unit ? Number(unit.factor) : 1;
}

function syncEditGoodsPrice() {
  const caseInput = $('editGoodsCasePrice');
  const minInput = $('editGoodsPrice');
  const hint = $('editGoodsCaseHint');
  if (!caseInput || !minInput || !hint) return;
  const units = parseUnitsForm($('editGoodsUnits') ? $('editGoodsUnits').value : '');
  const base = ($('editGoodsUnit') ? $('editGoodsUnit').value : '').trim();
  const factor = editGoodsCaseFactor(units);
  const caseText = String(caseInput.value || '').trim();
  if (caseText === '') {
    minInput.value = '';
  } else {
    const value = Number(caseText);
    minInput.value = Number.isFinite(value)
      ? String(Math.round(value / factor * 10000) / 10000)
      : '';
  }
  const baseLine = units.filter(function (u) { return u.unit === base; })[0];
  hint.className = 'text-xs mt-1 ' + (baseLine ? 'text-red-500' : 'text-gray-400');
  hint.textContent = baseLine
    ? '“' + base + '”已经是最小单位，不能再用“' + base + '=' + Number(baseLine.factor) + '”当整件；请把最小单位改成袋/包/kg 等更小单位。'
    : '1 整件 = ' + factor + ' 个「' + (base || '最小单位') + '」，最小单位单价 = 整件价 ÷ ' + factor;
}

function renderGoodsManage() {
  const tbody = $('goodsTableBody');
  if (!tbody) return;
  const keyword = ($('goodsSearch') ? $('goodsSearch').value : '').trim().toLowerCase();
  const list = keyword ? goodsList.filter(function (g) {
    return String(g.code).toLowerCase().indexOf(keyword) >= 0 ||
      String(g.name).toLowerCase().indexOf(keyword) >= 0 ||
      String(g.spec || '').toLowerCase().indexOf(keyword) >= 0;
  }) : goodsList;

  tbody.innerHTML = list.length ? list.map(function (g) {
    return '<tr class="border-b hover:bg-blue-50">' +
      '<td class="border px-2 py-1 text-center"><input type="checkbox" class="goods-row-check" value="' + g.id + '" onchange="updateGoodsSelection()"></td>' +
      '<td class="border px-2 py-1">' + esc(g.code) + '</td>' +
      '<td class="border px-2 py-1 font-medium">' + esc(g.name) + '</td>' +
      '<td class="border px-2 py-1">' + esc(g.spec || '-') + '</td>' +
      '<td class="border px-2 py-1 text-center">' + esc(unitsText(g)) + '</td>' +
      '<td class="border px-2 py-1 text-center">' + esc(shelfLifeText(g.shelf_life_days)) + '</td>' +
      '<td class="border px-2 py-1 text-center">' + (g.default_price !== null && g.default_price !== undefined ? '￥' + money(g.default_price) : '-') + '</td>' +
      '<td class="border px-2 py-1 text-center whitespace-nowrap">' +
      '<button onclick="openGoodsEdit(' + g.id + ')" class="text-gray-600 mr-2">编辑</button>' +
      '<button onclick="deleteGoods(' + g.id + ')" class="text-red-500">删除</button>' +
      '</td></tr>';
  }).join('') : '<tr><td colspan="8" class="text-center text-gray-400 py-6">暂无商品，请新增或到“数据导入”导入商品</td></tr>';
  if ($('goodsCheckAll')) $('goodsCheckAll').checked = false;
  updateGoodsSelection();
}

function toggleGoodsSelection(checked) {
  document.querySelectorAll('.goods-row-check').forEach(function (box) { box.checked = !!checked; });
  updateGoodsSelection();
}

function updateGoodsSelection() {
  const boxes = Array.from(document.querySelectorAll('.goods-row-check'));
  const selected = boxes.filter(function (box) { return box.checked; }).length;
  const button = $('batchDeleteGoodsBtn');
  const count = $('goodsSelectedCount');
  if (button) {
    button.disabled = selected === 0;
    button.textContent = selected ? '批量删除 (' + selected + ')' : '批量删除';
  }
  if (count) count.textContent = selected ? '已选 ' + selected + ' 个商品' : '';
  const all = $('goodsCheckAll');
  if (all) {
    all.checked = boxes.length > 0 && selected === boxes.length;
    all.indeterminate = selected > 0 && selected < boxes.length;
  }
}

async function batchDeleteGoods() {
  const ids = Array.from(document.querySelectorAll('.goods-row-check:checked')).map(function (box) { return Number(box.value); });
  if (!ids.length) return toast('请先勾选要删除的商品', 'err');
  const names = ids.map(function (id) {
    const g = findGoodsById(id);
    return g ? g.code + ' ' + g.name : String(id);
  });
  const preview = names.slice(0, 6).join('、') + (names.length > 6 ? ' 等 ' + names.length + ' 个' : '');
  if (!confirm('确定删除以下商品？\n' + preview +
    '\n\n没有历史单据的商品会彻底删除并释放编码；有历史单据的商品只停用，编码和单据保留。')) return;
  const button = $('batchDeleteGoodsBtn');
  if (button) { button.disabled = true; button.textContent = '删除中…'; }
  try {
    const result = await api('/goods/batch-delete', { method: 'POST', body: { ids } });
    await refreshGoods();
    const parts = [];
    if (result.deleted) parts.push('彻底删除 ' + result.deleted + ' 个');
    if (result.disabled) parts.push('停用 ' + result.disabled + ' 个');
    if (result.errors && result.errors.length) parts.push('失败 ' + result.errors.length + ' 个');
    toast(parts.join('，') || '没有商品被处理', result.errors && result.errors.length ? 'err' : 'ok');
    if (result.errors && result.errors.length) {
      alert('以下商品删除失败：\n' + result.errors.slice(0, 10).map(function (item) {
        return 'ID ' + item.id + '：' + item.error;
      }).join('\n'));
    }
  } catch (err) {
    toast(err.message, 'err');
    updateGoodsSelection();
  }
}

/* 保质期：界面按天/月/年录入，数据库统一存天数（1 月=30 天，1 年=365 天） */
function shelfDaysFromInput(value, unit) {
  const num = Number(value || 0);
  if (!num || num <= 0) return 0;
  if (unit === 'year') return Math.round(num * 365);
  if (unit === 'month') return Math.round(num * 30);
  return Math.round(num);
}

function shelfPartsFromDays(days) {
  const value = Number(days || 0);
  if (!value || value <= 0) return { value: '', unit: 'day' };
  if (value % 365 === 0) return { value: value / 365, unit: 'year' };
  if (value % 30 === 0) return { value: value / 30, unit: 'month' };
  return { value: value, unit: 'day' };
}

function shelfLifeText(days) {
  const parts = shelfPartsFromDays(days);
  if (!parts.value) return '-';
  const suffix = parts.unit === 'year' ? ' 年' : (parts.unit === 'month' ? ' 个月' : ' 天');
  return parts.value + suffix;
}

async function addGoods() {
  const name = $('newGoodsName').value.trim();
  if (!name) return toast('品名必填', 'err');
  const priceText = $('newGoodsPrice').value;
  try {
    const created = await api('/goods', {
      method: 'POST',
      body: {
        code: '',
        name: name,
        spec: $('newGoodsSpec').value.trim(),
        unit: $('newGoodsUnit').value.trim(),
        shelf_life_days: shelfDaysFromInput($('newGoodsShelfLife').value, $('newGoodsShelfUnit').value),
        default_price: priceText === '' ? null : Number(priceText)
      }
    });
    ['newGoodsCode', 'newGoodsName', 'newGoodsSpec', 'newGoodsUnit', 'newGoodsShelfLife', 'newGoodsPrice'].forEach(function (id) { $(id).value = ''; });
    $('newGoodsShelfUnit').value = 'day';
    await refreshGoods();
    toast('商品已新增，系统分配编码 ' + created.code, 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

let goodsModalReturnFocus = null;
let goodsEditDefaults = { sale: '', purchase: '' };

function openGoodsEdit(id) {
  const goods = findGoodsById(id);
  if (!goods) return;
  goodsModalReturnFocus = document.activeElement;
  goodsEditDefaults = {
    sale: goods.default_sale_unit || goods.base_unit || goods.unit || '',
    purchase: goods.default_purchase_unit || goods.base_unit || goods.unit || ''
  };
  $('editGoodsId').value = goods.id;
  $('editGoodsCode').value = goods.code || '';
  $('editGoodsName').value = goods.name || '';
  $('editGoodsSpec').value = goods.spec || '';
  $('editGoodsUnit').value = goods.base_unit || goods.unit || '';
  $('editGoodsUnits').value = unitsFormText(goods);
  const shelf = shelfPartsFromDays(goods.shelf_life_days);
  $('editGoodsShelfLife').value = shelf.value;
  $('editGoodsShelfUnit').value = shelf.unit;
  const basePrice = goods.default_price === null || goods.default_price === undefined ? '' : Number(goods.default_price);
  const factor = editGoodsCaseFactor(goods.units);
  const caseUnit = editGoodsCaseUnit(goods.units);
  const existingCasePrice = caseUnit && caseUnit.price !== null && caseUnit.price !== undefined ? Number(caseUnit.price) : null;
  $('editGoodsCasePrice').value = existingCasePrice !== null
    ? existingCasePrice
    : (basePrice === '' ? '' : Math.round(basePrice * factor * 100) / 100);
  $('editGoodsPrice').value = basePrice;
  syncEditGoodsPrice();
  const modal = $('goodsModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeGoodsModal() {
  const modal = $('goodsModal');
  const active = document.activeElement;
  if (active && active.closest && active.closest('#goodsModal')) {
    try { active.blur(); } catch (e) {}
  }
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  try { window.focus(); } catch (e) {}
  const returnTo = goodsModalReturnFocus;
  goodsModalReturnFocus = null;
  if (returnTo && returnTo.focus && !returnTo.closest('.hidden')) {
    setTimeout(function () { try { returnTo.focus(); } catch (e) {} }, 0);
  }
}

async function saveGoodsEdit() {
  const id = Number($('editGoodsId').value);
  const caseText = String($('editGoodsCasePrice').value || '').trim();
  const units = parseUnitsForm($('editGoodsUnits').value);
  const baseUnit = $('editGoodsUnit').value.trim();
  if (units.some(function (u) { return u.unit === baseUnit; })) {
    return toast('“' + baseUnit + '”已是最小单位，不能再用它当整件；请把最小单位改成袋、包、kg 等更小单位', 'err');
  }
  const factor = editGoodsCaseFactor(units);
  const casePrice = caseText === '' ? null : Number(caseText);
  const minPrice = casePrice === null ? null : Math.round(casePrice / factor * 10000) / 10000;
  units.forEach(function (u) {
    u.price = minPrice === null ? null : Math.round(minPrice * Number(u.factor) * 10000) / 10000;
  });
  try {
    await api('/goods/' + id, {
      method: 'PUT',
      body: {
        code: $('editGoodsCode').value.trim(),
        name: $('editGoodsName').value.trim(),
        spec: $('editGoodsSpec').value.trim(),
        unit: $('editGoodsUnit').value.trim(),
        base_unit: $('editGoodsUnit').value.trim(),
        default_sale_unit: goodsEditDefaults.sale,
        default_purchase_unit: goodsEditDefaults.purchase,
        units: units,
        shelf_life_days: shelfDaysFromInput($('editGoodsShelfLife').value, $('editGoodsShelfUnit').value),
        default_price: minPrice
      }
    });
    closeGoodsModal();
    await refreshGoods();
    toast('商品建议价已保存；客户价格记忆未改动', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

async function deleteGoods(id) {
  const goods = findGoodsById(id);
  if (!goods) return;
  if (!confirm('确定删除商品“' + goods.name + '”？\n没有历史单据的会彻底删除并释放编码；有历史单据的只停用、编码保留。')) return;
  try {
    const result = await api('/goods/' + id, { method: 'DELETE' });
    await refreshGoods();
    toast(result.message || '商品已处理', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

/* ==================== 客户价格表 ==================== */
async function openPriceModalById(customerId) {
  const customer = findCustomer(customerId) || (currentCustomer && String(currentCustomer.id) === String(customerId) ? currentCustomer : null);
  if (!customer) return toast('客户不存在，请刷新后重试', 'err');
  priceModalCustomer = customer;
  $('priceCustomerName').textContent = (customer.customer_no ? '#' + customer.customer_no + '  ' : '') + customer.name;
  $('priceSearch').value = '';
  const tbody = $('priceTableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-400 py-6">加载中…</td></tr>';
  const modal = $('priceModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  try {
    priceModalRows = await api('/customers/' + encodeURIComponent(customerId) + '/prices');
    renderPriceRows();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-red-500 py-6">' + esc(err.message) + '</td></tr>';
  }
}

function closePriceModal() {
  const modal = $('priceModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  priceModalCustomer = null;
  priceModalRows = [];
}

function renderPriceRows() {
  const tbody = $('priceTableBody');
  if (!tbody) return;
  const keyword = ($('priceSearch').value || '').trim().toLowerCase();
  const list = keyword ? priceModalRows.filter(function (p) {
    return String(p.goods_code).toLowerCase().indexOf(keyword) >= 0 ||
      String(p.goods_name).toLowerCase().indexOf(keyword) >= 0;
  }) : priceModalRows;

  tbody.innerHTML = list.length ? list.map(function (p) {
    const history = (p.history || []).map(function (h) {
      return '<span class="whitespace-nowrap mr-2">' + money(h.price) +
        '<span class="text-gray-400 text-xs">(' + esc((h.date || '').slice(5)) + ')</span></span>';
    }).join('');
    const current = p.price !== null && p.price !== undefined
      ? '<span class="text-red-500 font-medium">￥' + money(p.price) + '</span>'
      : '<span class="text-gray-400">未定价</span>';
    return '<tr class="border-b hover:bg-blue-50">' +
      '<td class="border px-2 py-1">' + esc(p.goods_code) + '</td>' +
      '<td class="border px-2 py-1">' + esc(p.goods_name) + '</td>' +
      '<td class="border px-2 py-1 text-center">' + esc(p.spec || '-') + '</td>' +
      '<td class="border px-2 py-1 text-center">' + esc(p.unit || '-') + '</td>' +
      '<td class="border px-2 py-1 text-center">' + current + '</td>' +
      '<td class="border px-2 py-1 text-xs">' + (history || '<span class="text-gray-400">无</span>') + '</td>' +
      '<td class="border px-2 py-1 text-center"><input id="priceInput_' + p.goods_id + '" type="number" step="0.01" min="0" class="border w-24 px-1 py-0.5 text-right" value="' + (p.price !== null && p.price !== undefined ? money(p.price) : '') + '"></td>' +
      '<td class="border px-2 py-1 text-center"><button onclick="savePrice(' + p.goods_id + ')" class="bg-primaryBlue text-white px-2 py-0.5 rounded text-xs">保存</button></td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="8" class="text-center text-gray-400 py-6">没有匹配的商品</td></tr>';
}

async function savePrice(goodsId) {
  if (!priceModalCustomer) return;
  const input = $('priceInput_' + goodsId);
  const value = input ? input.value : '';
  if (value === '') return toast('请输入价格', 'err');
  const price = Number(value);
  if (!isFinite(price) || price < 0) return toast('价格格式不正确', 'err');
  const drafts = {};
  priceModalRows.forEach(function (row) {
    const el = $('priceInput_' + row.goods_id);
    if (el) drafts[row.goods_id] = el.value;
  });
  try {
    const updated = await api('/prices', {
      method: 'PUT',
      body: { user_id: priceModalCustomer.id, goods_id: goodsId, price: price }
    });
    const index = priceModalRows.findIndex(function (p) { return Number(p.goods_id) === Number(goodsId); });
    if (index >= 0) priceModalRows[index] = updated;
    if (currentCustomer && String(currentCustomer.id) === String(priceModalCustomer.id)) {
      priceMap[goodsId] = updated;
      applyPricesToEmptyRows();
    }
    drafts[goodsId] = money(price);
    renderPriceRows();
    Object.keys(drafts).forEach(function (id) {
      const el = $('priceInput_' + id);
      if (el) el.value = drafts[id];
    });
    toast('价格已保存：￥' + money(price), 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

/* ==================== 订单保存 ==================== */
async function refreshOrderNo() {
  try {
    const data = await api('/orders/next-no');
    $('sellOrderNo').value = data.order_no;
  } catch (err) {
    $('sellOrderNo').value = localOrderNo();
  }
}

function localOrderNo() {
  const d = new Date();
  const date = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return date + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

function isOrderLocked() {
  return !!(editingOrder && Number(editingOrder.is_void) === 1);
}

function setSaleModeUI() {
  const isEdit = !!editingOrderId;
  if (!isEdit) editingOrder = null;
  const locked = isOrderLocked();
  $('salePageTitle').textContent = isEdit ? '销售订单详情' : '新增销售';
  $('salePageHint').textContent = isEdit
    ? '客户信息已锁定；可修改日期、退货、备注和商品明细'
    : '输入品名即联想；选中后带出编码、规格、客户价与效期';
  $('editOrderNotice').classList.toggle('hidden', !isEdit);
  $('btnBackArrow').classList.toggle('hidden', !isEdit);
  $('btnBackOrder').classList.toggle('hidden', !isEdit);
  $('btnVoidOrder').classList.toggle('hidden', !isEdit || locked);
  $('btnSaveOrder').textContent = isEdit ? '保存修改' : '保存单据';
  $('btnSaveOrder').disabled = isEdit && locked;
  $('btnClearOrder').disabled = isEdit && locked;
  $('sellCustomerInput').disabled = isEdit;
  $('custAddr').readOnly = isEdit;
  $('custTel').readOnly = isEdit;
  ['sellCustomerInput', 'custAddr', 'custTel'].forEach(function (id) {
    $(id).classList.toggle('bg-gray-100', isEdit);
  });
  $('sellDate').disabled = isEdit && locked;
  $('sellReturn').disabled = isEdit && locked;
  $('billRemark').disabled = isEdit && locked;
  $('addRowBtn').disabled = isEdit && locked;
  if (isEdit) {
    $('editOrderNo').textContent = editingOrder.order_no || '';
    const status = $('editOrderStatus');
    status.textContent = locked ? '已作废' : '正常';
    status.className = 'px-2 py-0.5 rounded ' + (locked ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700');
  }
  if (locked) {
    renderSellTable();
  } else {
    const tbody = $('sellTableBody');
    if (tbody) {
      tbody.querySelectorAll('input, select, button').forEach(function (el) {
        if (el.type !== 'checkbox') el.disabled = false;
      });
    }
  }
}

async function startEditOrder(orderId) {
  try {
    const order = await api('/orders/' + orderId);
    editingOrder = order;
    editingOrderId = order.id;
    switchPage('sale', true);
    setMenuActive('orderList');
    $('sellOrderNo').value = order.order_no || '';
    $('sellCustomerInput').value = order.customer_name || '';
    $('custNo').value = order.customer_no || '';
    $('custAddr').value = order.customer_addr || '';
    $('custTel').value = order.customer_tel || '';
    $('sellDate').value = order.bill_date || todayStr();
    $('sellReturn').checked = !!order.is_return;
    $('billRemark').value = order.remark || '';
    currentCustomer = {
      id: order.user_id,
      customer_no: order.customer_no,
      name: order.customer_name,
      addr: order.customer_addr,
      tel: order.customer_tel
    };
    priceMap = {};
    printPrefMap = {};
    try { if (order.user_id) await loadCustomerPrices(order.user_id); } catch (err) { /* 价格加载失败不阻塞改单 */ }
    try { if (order.user_id) await loadCustomerPrintPrefs(order.user_id); } catch (err) { /* 打印记忆加载失败不阻塞改单 */ }
    sellRows = (order.items || []).map(function (item) {
      const goods = findGoodsById(item.goods_id);
      return {
        goods_id: item.goods_id,
        pid: item.goods_code || '',
        pname: item.goods_name || '',
        spec: item.spec || '',
        unit: item.unit || '',
        units: goods ? (goods.units || []) : [],
        baseUnit: goods ? (goods.base_unit || goods.unit || '') : '',
        qty: item.qty,
        price: item.price,
        priceAuto: false,
        amount: item.amount,
        stock_id: item.stock_id || null,
        shelfLifeDays: goods ? Number(goods.shelf_life_days || 0) : 0,
        makeDate: item.make_date || '',
        expDate: item.exp_date || '',
        remark: item.remark || '',
        hideSpec: !!item.hide_spec,
        hideSpecTouched: true,
        hideSpecGoodsId: item.goods_id,
        history: [],
        defaultPrice: goods ? goods.default_price : null
      };
    });
    sellRows.forEach(function (row) {
      if (row.goods_id) row.history = historyForUnit(row, row.unit);
    });
    if (!sellRows.length) sellRows = [newRow()];
    renderSellTable();
    auditOrder('edit_loaded', {
      detail: {
        order_id: editingOrderId,
        order_no: order.order_no,
        items: order.items || [],
        rows: auditRowsSnapshot()
      }
    });
    setSaleModeUI();
  } catch (err) {
    toast('加载订单失败：' + err.message, 'err');
  }
}

function exitOrderEdit() {
  editingOrder = null;
  editingOrderId = null;
  $('sellCustomerInput').disabled = false;
  $('custAddr').readOnly = false;
  $('custTel').readOnly = false;
  $('sellDate').disabled = false;
  $('sellReturn').disabled = false;
  $('billRemark').disabled = false;
  clearSellForm();
  setSaleModeUI();
}

function backToOrderList() {
  exitOrderEdit();
  switchPage('orderList');
}

async function voidCurrentOrder() {
  if (!editingOrderId || isOrderLocked()) return;
  if (!confirm('确定作废订单“' + editingOrder.order_no + '”？作废后保留单据但不可再编辑。')) return;
  try {
    await api('/orders/' + editingOrderId + '/void', { method: 'POST' });
    toast('订单已作废', 'ok');
    await startEditOrder(editingOrderId);
  } catch (err) {
    toast(err.message, 'err');
  }
}


async function saveSellOrder(opts) {
  opts = opts || {};
  const keepPage = !!opts.keepPage;
  const silent = !!opts.silent;
  const silentUI = !!opts.silentUI;
  const wasEditing = !!editingOrderId;
  if (editingOrderId && isOrderLocked()) return null;
  const customerName = $('sellCustomerInput').value.trim() || (opts.allowWalkIn ? '散客' : '');
  if (!customerName) return toast('请填写客户名称', 'err');
  const matchedCustomer = currentCustomer || customers.find(function (c) {
    return String(c.customer_no) === customerName || c.name === customerName;
  }) || null;
  const validRows = sellRows.filter(function (row) {
    return row.pid && Number(row.qty) > 0 && Number(row.price) > 0;
  });
  if (!validRows.length) {
    auditOrder('save_blocked', { detail: { reason: 'no_valid_rows', rows: auditRowsSnapshot() } });
    await flushOrderAudit();
    return toast('至少需要一行有效商品（编码、数量、单价）', 'err');
  }

  const items = validRows.map(function (row) {
    return {
      goods_id: row.goods_id || null,
      goods_code: row.pid,
      goods_name: row.pname,
      spec: row.spec,
      unit: row.unit,
      qty: Number(row.qty),
      price: Number(row.price),
      stock_id: row.stock_id || null,
      make_date: row.makeDate || null,
      exp_date: row.expDate || null,
      remark: row.remark,
      hide_spec: !!row.hideSpec
    };
  });
  auditOrder('save_attempt', {
    detail: {
      mode: editingOrderId ? 'edit' : 'create',
      customer_name: customerName,
      customer_id: matchedCustomer ? matchedCustomer.id : null,
      all_rows: auditRowsSnapshot(),
      valid_item_count: items.length,
      items: items
    }
  });
  await flushOrderAudit();

  const button = $('btnSaveOrder');
  if (button && !silentUI) { button.disabled = true; button.textContent = '保存中…'; }
  try {
    if (editingOrderId) {
      const updated = await api('/orders/' + editingOrderId, {
        method: 'PUT',
        body: {
          bill_date: $('sellDate').value,
          is_return: $('sellReturn').checked,
          remark: $('billRemark').value.trim(),
          items: items
        }
      });
      editingOrder = updated || editingOrder;
      auditOrder('save_result', { detail: { ok: true, mode: 'edit', remote: updated } });
      await flushOrderAudit();
      if (!silent) toast('订单修改已保存，金额 ￥' + money(updated.total_amount), 'ok');
      if (!keepPage) await startEditOrder(editingOrderId);
      return updated;
    }

    const typedNo = $('custNo').value.trim();
    const payload = {
      order_no: $('sellOrderNo').value.trim(),
      customer_id: matchedCustomer ? matchedCustomer.id : null,
      customer_no: matchedCustomer
        ? (matchedCustomer.customer_no || null)
        : (typedNo ? Number(typedNo) : null),
      customer_name: matchedCustomer ? matchedCustomer.name : customerName,
      customer_addr: $('custAddr').value.trim(),
      customer_tel: $('custTel').value.trim(),
      bill_date: $('sellDate').value,
      is_return: $('sellReturn').checked,
      remark: $('billRemark').value.trim(),
      items: items
    };
    const order = await api('/orders', { method: 'POST', body: payload });
    auditOrder('save_result', { detail: { ok: true, mode: 'create', remote: order } });
    await flushOrderAudit();
    await refreshCustomers();
    if (keepPage) {
      // 打印前自动保存：保留当前单据页面，转为已保存订单，避免重复保存
      editingOrderId = order.id;
      editingOrder = order;
      $('sellOrderNo').value = order.order_no || $('sellOrderNo').value;
      if (!silent) toast('单据已保存，金额 ￥' + money(order.total_amount), 'ok');
      if (!silentUI) setSaleModeUI();
      return order;
    }
    toast('单据保存成功，金额 ￥' + money(order.total_amount), 'ok');
    const savedCustomerId = order.user_id;
    clearSellForm();
    if (savedCustomerId) {
      const customer = findCustomer(savedCustomerId);
      if (customer) await selectCustomer(customer);
    }
    return order;
  } catch (err) {
    auditOrder('save_failed', { detail: { error: err.message, rows: auditRowsSnapshot() } });
    await flushOrderAudit();
    toast(err.message, 'err');
    if (String(err.message).indexOf('订单号') >= 0) refreshOrderNo();
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = wasEditing ? '保存修改' : '保存单据';
    }
    if (!silentUI) setSaleModeUI();
  }
}

function clearSellForm() {
  closeNameSuggest();
  closeSpecSuggest();
  sellRows = [newRow()];
  $('billRemark').value = '';
  $('sellReturn').checked = false;
  $('customerPriceTip').classList.add('hidden');
  $('sellDate').value = todayStr();
  if (editingOrderId) {
    renderSellTable();
    setSaleModeUI();
    return;
  }
  currentCustomer = null;
  priceMap = {};
  printPrefMap = {};
  $('sellCustomerInput').value = '';
  $('custNo').value = '';
  $('custAddr').value = '';
  $('custTel').value = '';
  renderSellTable();
  refreshOrderNo();
}

/* 打印完成后自动开新单：清空客户、明细、备注，并退出上一单编辑态 */
function resetSaleAfterPrint() {
  closePrintPreview();
  if (editingOrderId || editingOrder) {
    exitOrderEdit();
  } else {
    clearSellForm();
  }
  setSaleModeUI();
}

/* ==================== 订单列表 / 明细 ==================== */
async function loadOrders() {
  const tbody = $('orderListBody');
  tbody.innerHTML = '<tr><td colspan="10" class="text-center text-gray-400 py-6">加载中…</td></tr>';
  try {
    const query = buildQuery({
      kw: $('orderKw').value.trim(),
      date_from: $('orderFrom').value,
      date_to: $('orderTo').value,
      page: 1,
      page_size: 500
    });
    const data = await api('/orders?' + query);
    $('orderCountHint').textContent = '共 ' + data.total + ' 单';
    tbody.innerHTML = (data.items || []).length ? data.items.map(function (order) {
      const voided = Number(order.is_void) === 1;
      return '<tr class="border-b ' + (voided ? 'bg-gray-100 text-gray-400' : 'hover:bg-blue-50') + '">' +
        '<td class="border px-2 py-1 text-center"><input type="checkbox" class="order-check" value="' + order.id + '"' + (voided ? ' disabled' : '') + ' onclick="updateBatchOrderHint()"></td>' +
        '<td class="border px-2 py-1 font-mono">' + esc(order.order_no) + '</td>' +
        '<td class="border px-2 py-1">' + esc(order.bill_date) + '</td>' +
        '<td class="border px-2 py-1 text-gray-500">' + esc(order.created_at) + '</td>' +
        '<td class="border px-2 py-1">' + (order.customer_no ? '<span class="text-xs text-primaryBlue font-mono">' + esc(order.customer_no) + '</span><br>' : '') + esc(order.customer_name) + '</td>' +
        '<td class="border px-2 py-1 text-center">' + (order.is_return ? '<span class="text-red-500">是</span>' : '否') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + (voided ? '<span class="text-red-500">已作废</span>' : '<span class="text-green-600">正常</span>') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + order.total_qty + '</td>' +
        '<td class="border px-2 py-1 text-right">￥' + money(order.total_amount) + '</td>' +
        '<td class="border px-2 py-1 text-center"><button onclick="startEditOrder(' + order.id + ')" class="text-primaryBlue">查看/编辑</button></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="10" class="text-center text-gray-400 py-6">暂无订单</td></tr>';
    $('orderCheckAll').checked = false;
    updateBatchOrderHint();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-red-500 py-6">' + esc(err.message) + '</td></tr>';
    updateBatchOrderHint();
  }
}

function selectedOrderIds() {
  return Array.from(document.querySelectorAll('.order-check:checked')).map(function (el) {
    return Number(el.value);
  }).filter(function (id) { return id > 0; });
}

function updateBatchOrderHint() {
  const count = selectedOrderIds().length;
  const hint = $('batchOrderHint');
  if (hint) hint.textContent = count ? '已选 ' + count + ' 单' : '未选择';
}

function toggleAllOrderChecks(source) {
  document.querySelectorAll('.order-check:not(:disabled)').forEach(function (el) {
    el.checked = !!source.checked;
  });
  updateBatchOrderHint();
}

async function runBatchOrderAction(action) {
  const ids = selectedOrderIds();
  if (!ids.length) return toast('请先勾选要处理的订单', 'err');
  const isVoid = action === 'void';
  const label = isVoid ? '作废' : '退货';
  if (!confirm('确定批量' + label + '选中的 ' + ids.length + ' 张订单？' +
      (isVoid ? '作废后库存和统计会回滚，单据保留但不可再编辑。' : '原单保留，系统会生成退货单并冲减营业额与利润。'))) return;
  try {
    const data = await api('/orders/batch', { method: 'POST', body: { ids: ids, action: action } });
    let message = '批量' + label + '完成：成功 ' + data.processed + ' 单';
    if (data.skipped) message += '，跳过 ' + data.skipped + ' 单';
    if (data.errors && data.errors.length) message += '，失败 ' + data.errors.length + ' 单';
    toast(message, data.errors && data.errors.length && !data.processed ? 'err' : 'ok');
    if (data.errors && data.errors.length) {
      console.warn('批量操作失败明细', data.errors);
    }
    await loadOrders();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function batchVoidOrders() {
  return runBatchOrderAction('void');
}

function batchReturnOrders() {
  return runBatchOrderAction('return');
}

function resetOrderFilters() {
  $('orderKw').value = '';
  $('orderFrom').value = '';
  $('orderTo').value = '';
  loadOrders();
}

function viewOrder(orderNo) {
  switchPage('detail');
  $('detailKw').value = orderNo;
  loadDetailList();
}

async function loadDetailList() {
  const tbody = $('detailBody');
  tbody.innerHTML = '<tr><td colspan="13" class="text-center text-gray-400 py-6">加载中…</td></tr>';
  try {
    const query = buildQuery({
      kw: $('detailKw').value.trim(),
      date_from: $('detailFrom').value,
      date_to: $('detailTo').value,
      page: 1,
      page_size: 500
    });
    const data = await api('/order-items?' + query);
    $('detailCountHint').textContent = '共 ' + data.total + ' 行';
    tbody.innerHTML = (data.items || []).length ? data.items.map(function (item) {
      return '<tr class="border-b">' +
        '<td class="border px-2 py-1 font-mono">' + esc(item.order_no) + '</td>' +
        '<td class="border px-2 py-1">' + esc(item.bill_date) + '</td>' +
        '<td class="border px-2 py-1">' + (item.customer_no ? '<span class="text-xs text-primaryBlue font-mono">' + esc(item.customer_no) + '</span><br>' : '') + esc(item.customer_name) + '</td>' +
        '<td class="border px-2 py-1">' + esc(item.goods_code) + '</td>' +
        '<td class="border px-2 py-1">' + esc(item.goods_name) + '</td>' +
        '<td class="border px-2 py-1">' + esc(item.spec) + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(item.unit) + '</td>' +
        '<td class="border px-2 py-1 text-center">' + item.qty + '</td>' +
        '<td class="border px-2 py-1 text-right">' + money(item.price) + '</td>' +
        '<td class="border px-2 py-1 text-right">' + money(item.amount) + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(item.make_date || '') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(item.exp_date || '') + '</td>' +
        '<td class="border px-2 py-1">' + esc(item.remark || '') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="13" class="text-center text-gray-400 py-6">暂无明细</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="13" class="text-center text-red-500 py-6">' + esc(err.message) + '</td></tr>';
  }
}

function resetDetailFilters() {
  $('detailKw').value = '';
  $('detailFrom').value = '';
  $('detailTo').value = '';
  loadDetailList();
}

/* ==================== 统计 ==================== */
async function loadCustomerStat() {
  const wrap = $('customerStatList');
  wrap.innerHTML = '<div class="text-gray-400 text-sm">加载中…</div>';
  try {
    const dim = $('statCustomerType').value;
    const rows = await api('/stats/customers?dim=' + encodeURIComponent(dim));
    wrap.innerHTML = rows.length ? rows.map(function (row) {
      return '<div class="stat-row"><span>' + esc(row.period_label) + ' · ' + esc(row.customer_name) +
        '<span class="text-gray-400 text-xs">（' + row.order_count + ' 单）</span></span>' +
        '<span class="text-primaryBlue font-medium">￥' + money(row.total_amount) + '</span></div>';
    }).join('') : '<div class="text-gray-400 text-sm">暂无数据</div>';
  } catch (err) {
    wrap.innerHTML = '<div class="text-red-500 text-sm">' + esc(err.message) + '</div>';
  }
}

async function loadProductStat() {
  const wrap = $('productStatList');
  wrap.innerHTML = '<div class="text-gray-400 text-sm">加载中…</div>';
  try {
    const rows = await api('/stats/goods');
    wrap.innerHTML = rows.length ? rows.map(function (row) {
      const top = row.top_customer && row.top_customer.name
        ? '<span class="text-orange-500">采购最多：' + esc(row.top_customer.name) + '（' + row.top_customer.qty + '）</span>'
        : '<span class="text-gray-400">暂无客户</span>';
      return '<div class="border-b py-2">' +
        '<div class="font-medium">' + esc(row.goods_name) + ' <span class="text-xs text-gray-400">' + esc(row.goods_code) + '</span></div>' +
        '<div class="text-sm text-gray-600">总销量：' + row.total_qty + '｜总金额：￥' + money(row.total_amount) + '</div>' +
        '<div class="text-xs mt-0.5">' + top + '</div>' +
        '</div>';
    }).join('') : '<div class="text-gray-400 text-sm">暂无数据</div>';
  } catch (err) {
    wrap.innerHTML = '<div class="text-red-500 text-sm">' + esc(err.message) + '</div>';
  }
}

/* ==================== 数据导入 ==================== */
function parseDelimited(text) {
  text = String(text || '').replace(/^\ufeff/, '');
  const lines = text.split(/\r?\n/).filter(function (line) { return line.trim() !== ''; });
  if (!lines.length) return [];
  let delimiter = ',';
  const tabCount = (lines[0].match(/\t/g) || []).length;
  const commaCount = (lines[0].match(/,/g) || []).length;
  const semiCount = (lines[0].match(/;/g) || []).length;
  if (tabCount >= commaCount && tabCount >= semiCount && tabCount > 0) delimiter = '\t';
  else if (semiCount > commaCount) delimiter = ';';

  return lines.map(function (line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { current += '"'; i += 1; }
          else quoted = false;
        } else current += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

function isHeaderRow(cells) {
  return cells.some(function (cell) {
    return /^(编码|商品编码|品名|商品名称|客户名称|名称|code|name)$/i.test(cell.trim());
  });
}

function parseGoodsImport() {
  const rows = parseDelimited($('importGoodsText').value);
  const items = [];
  const errors = [];
  let start = 0;
  // 支持“品名, 规格, 单位, 参考价, 保质期”新格式，也兼容“编码, 品名, …”老格式
  let map = { code: 0, name: 1, spec: 2, unit: 3, price: 4, shelf: 5 };
  if (rows.length && isHeaderRow(rows[0])) {
    start = 1;
    const header = rows[0].map(function (cell) { return String(cell || '').trim().toLowerCase(); });
    function findIndex(names) {
      return header.findIndex(function (h) { return names.indexOf(h) >= 0; });
    }
    map = {
      code: findIndex(['编码', '商品编码', 'code']),
      name: findIndex(['品名', '商品名称', '名称', 'name']),
      spec: findIndex(['规格', 'spec']),
      unit: findIndex(['单位', 'unit']),
      price: findIndex(['参考价', '单价', '价格', 'price']),
      shelf: findIndex(['保质期天数', '保质期', 'shelf_life_days', 'shelf'])
    };
  } else if (rows.length && rows[0].length === 1) {
    map = { code: -1, name: 0, spec: -1, unit: -1, price: -1, shelf: -1 };
  } else if (rows.length && /[\u4e00-\u9fa5]/.test(String(rows[0][0] || ''))) {
    // 无表头时，首列是中文品名而不是数字编码，按“品名, 规格, 单位, 参考价, 保质期”解析
    map = { code: -1, name: 0, spec: 1, unit: 2, price: 3, shelf: 4 };
  }
  function cell(cells, index) {
    return index >= 0 ? String(cells[index] || '').trim() : '';
  }
  rows.slice(start).forEach(function (cells, offset) {
    const lineNo = start + offset + 1;
    const code = cell(cells, map.code);
    const name = cell(cells, map.name);
    if (!code && !name) return;
    if (!name) { errors.push('第 ' + lineNo + ' 行：品名必填（编码可留空，系统自动分配）'); return; }
    const priceText = cell(cells, map.price);
    let defaultPrice = null;
    if (priceText) {
      const n = Number(priceText);
      if (!isFinite(n) || n < 0) { errors.push('第 ' + lineNo + ' 行：参考价格式不正确'); return; }
      defaultPrice = n;
    }
    const shelfText = cell(cells, map.shelf);
    let shelfDays = 0;
    if (shelfText) {
      const n = Number(shelfText);
      if (!isFinite(n) || n < 0 || Math.floor(n) !== n) {
        errors.push('第 ' + lineNo + ' 行：保质期天数格式不正确'); return;
      }
      shelfDays = n;
    }
    items.push({
      code: code,
      name: name,
      spec: cell(cells, map.spec),
      unit: cell(cells, map.unit),
      category: '',
      shelf_life_days: shelfDays,
      default_price: defaultPrice
    });
  });
  return { items: items, errors: errors };
}

function parseCustomerNoText(text) {
  const value = String(text || '').trim();
  if (!value) return { value: null, error: '' };
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return { value: null, error: '客户编号必须是正整数（留空自动生成）' };
  }
  return { value: number, error: '' };
}

function parseCustomerImport() {
  const rows = parseDelimited($('importCustomerText').value);
  const start = rows.length && isHeaderRow(rows[0]) ? 1 : 0;
  const items = [];
  const errors = [];
  rows.slice(start).forEach(function (cells, offset) {
    const lineNo = start + offset + 1;
    const cleaned = cells.map(function (cell) { return String(cell || '').trim(); });
    if (!cleaned.join('')) return;
    const first = cleaned[0] || '';
    const numericFirst = /^\d+$/.test(first);
    // 兼容三种写法：五列标准格式 / 编号+名称 / 只有客户名称
    const isNewFormat = cleaned.length >= 5 ||
      ((numericFirst || first === '') && cleaned.length >= 2) ||
      (cleaned.length === 1 && numericFirst);
    const noText = isNewFormat ? first : '';
    const name = (isNewFormat ? (cleaned[1] || '') : first).trim();
    if (!name) { errors.push('第 ' + lineNo + ' 行：客户名称必填'); return; }
    const parsedNo = parseCustomerNoText(noText);
    if (parsedNo.error) { errors.push('第 ' + lineNo + ' 行：' + parsedNo.error); return; }
    const offsetIndex = isNewFormat ? 2 : 1;
    items.push({
      customer_no: parsedNo.value,
      name: name,
      addr: (cleaned[offsetIndex] || '').trim(),
      tel: (cleaned[offsetIndex + 1] || '').trim(),
      remark: (cleaned[offsetIndex + 2] || '').trim()
    });
  });
  return { items: items, errors: errors };
}

function parsePriceImport() {
  const rows = parseDelimited($('importPriceText').value);
  const hasNoHeader = rows.length && rows[0].some(function (cell) { return /客户编号/.test(cell); });
  const start = rows.length && isHeaderRow(rows[0]) ? 1 : 0;
  const items = [];
  const errors = [];
  rows.slice(start).forEach(function (cells, offset) {
    const lineNo = start + offset + 1;
    const isNewFormat = hasNoHeader || cells.length >= 4;
    const noText = isNewFormat ? (cells[0] || '').trim() : '';
    const customerName = (isNewFormat ? (cells[1] || '') : (cells[0] || '')).trim();
    const goodsCode = (isNewFormat ? (cells[2] || '') : (cells[1] || '')).trim();
    const priceText = (isNewFormat ? (cells[3] || '') : (cells[2] || '')).trim();
    if (!customerName && !noText && !goodsCode && !priceText) return;
    if ((!customerName && !noText) || !goodsCode || !priceText) {
      errors.push('第 ' + lineNo + ' 行：客户编号/名称、商品编码、价格都要填');
      return;
    }
    const parsedNo = parseCustomerNoText(noText);
    if (parsedNo.error) { errors.push('第 ' + lineNo + ' 行：' + parsedNo.error); return; }
    const price = Number(priceText);
    if (!isFinite(price) || price < 0) { errors.push('第 ' + lineNo + ' 行：价格格式不正确'); return; }
    items.push({
      customer_no: parsedNo.value,
      customer_name: customerName,
      goods_code: goodsCode,
      price: price
    });
  });
  return { items: items, errors: errors };
}

async function doImport(kind, button) {
  const isGoods = kind === 'goods';
  const isPrices = kind === 'prices';
  const parsed = isPrices ? parsePriceImport() : (isGoods ? parseGoodsImport() : parseCustomerImport());
  const hint = $(isPrices ? 'priceImportHint' : (isGoods ? 'goodsImportHint' : 'customerImportHint'));
  const resultBox = $(isPrices ? 'priceImportResult' : (isGoods ? 'goodsImportResult' : 'customerImportResult'));

  hint.textContent = '解析到 ' + parsed.items.length + ' 条' + (parsed.errors.length ? '，' + parsed.errors.length + ' 条有问题' : '');
  if (!parsed.items.length) {
    resultBox.innerHTML = '<div class="text-red-500">没有可导入的数据。' + esc(parsed.errors.slice(0, 5).join('；')) + '</div>';
    return;
  }

  if (button) { button.disabled = true; button.textContent = '导入中…'; }
  try {
    const path = '/' + (isGoods ? 'goods' : (isPrices ? 'prices' : 'customers')) + '/import';
    const data = await api(path, { method: 'POST', body: { items: parsed.items } });
    let summary;
    if (isPrices) {
      summary = '成功写入 <b>' + data.imported + '</b> 条价格';
      if (data.errors && data.errors.length) summary += '，失败 ' + data.errors.length + ' 条';
    } else {
      summary = '新增 <b>' + data.inserted + '</b> 条，更新 <b>' + data.updated + '</b> 条';
      if (data.errors && data.errors.length) summary += '，失败 ' + data.errors.length + ' 条';
    }
    resultBox.innerHTML = '<div class="text-green-600">' + summary + '</div>' +
      (parsed.errors.length ? '<div class="text-orange-500 mt-1">' + esc(parsed.errors.slice(0, 8).join('；')) + '</div>' : '') +
      (data.errors && data.errors.length ? '<div class="text-red-500 mt-1">' + esc(data.errors.slice(0, 8).map(function (e) { return '第 ' + e.row + ' 行：' + e.error; }).join('；')) + '</div>' : '');
    await Promise.all([refreshCustomers(), refreshGoods()]);
    if (isPrices && currentCustomer) {
      await loadCustomerPrices(currentCustomer.id);
      applyPricesToEmptyRows();
    }
    toast('导入完成', 'ok');
  } catch (err) {
    resultBox.innerHTML = '<div class="text-red-500">' + esc(err.message) + '</div>';
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = isGoods ? '开始导入商品' : (isPrices ? '开始导入价格' : '开始导入客户');
    }
  }
}

async function readImportFile(input, targetId) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buffer);
    if (text.indexOf('\ufffd') >= 0) {
      try { text = new TextDecoder('gbk').decode(buffer); } catch (err) { /* 浏览器不支持 gbk 时保持 utf-8 */ }
    }
    $(targetId).value = text;
    toast('文件已读取，请确认内容后点击导入', 'info');
  } catch (err) {
    toast('读取文件失败：' + err.message, 'err');
  }
}

function downloadTemplate(kind) {
  let content;
  let filename;
  if (kind === 'goods') {
    content = '品名,规格,单位,参考价,保质期天数\n海天生抽,500ml,瓶,8.50,365\n镇江香醋,500ml,瓶,6.00,540\n';
    filename = '商品导入模板.csv';
  } else if (kind === 'prices') {
    content = '客户编号,客户名称,商品编码,价格\n1001,中卫市XX商行,1001,8.50\n1001,中卫市XX商行,1002,5.80\n';
    filename = '客户价格导入模板.csv';
  } else {
    content = '客户编号,客户名称,地址,电话,备注\n1001,中卫市XX商行,中卫市沙坡头区XX路1号,"13800000000",老客户\n1002,兴庆区XX超市,银川市XX街,"13900000000",\n';
    filename = '客户导入模板.csv';
  }
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ==================== 进货管理 ==================== */
let purchaseEditingId = null;
let purchaseNameTimer = null;
let purchaseNameState = { index: null, items: [], active: -1, kw: '', loading: false };
let purchaseSpecState = { index: null, items: [], active: -1, name: '' };
let purchaseSpecCache = {};

function newPurchaseRow() {
  return {
    goods_id: null, pid: '', pname: '', spec: '', unit: '', units: [], baseUnit: '',
    qty: 1, price: '', amount: 0, makeDate: '', expDate: '', remark: '',
    shelfLifeDays: 0
  };
}

function addPurchaseRow() {
  purchaseRows.push(newPurchaseRow());
  renderPurchaseRows();
}

function delPurchaseRow(index) {
  purchaseRows.splice(index, 1);
  if (!purchaseRows.length) purchaseRows.push(newPurchaseRow());
  renderPurchaseRows();
}

function setPurchaseCell(index, cellIndex, value) {
  const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
  if (!tr || !tr.cells[cellIndex]) return;
  const input = tr.cells[cellIndex].querySelector('input');
  if (input) input.value = value;
}

function purchaseRow(index) {
  return purchaseRows[index];
}

function renderPurchaseRows() {
  const tbody = $('purchaseTableBody');
  if (!tbody) return;
  const batchMode = stockConfig.mode === 'batch';
  if (!batchMode) purchaseRows.forEach(function (row) { row.qty = 1; });
  tbody.innerHTML = purchaseRows.map(function (row, index) {
    const qtyCell = batchMode
      ? '<td><input type="number" step="0.001" min="0" class="w-full border px-1 py-1" value="' + esc(row.qty) + '" oninput="purchaseRows[' + index + '].qty=this.value;calcPurchaseRow(' + index + ')"></td>'
      : '<td><input type="number" class="w-full border px-1 py-1 bg-gray-100 text-gray-500" value="1" disabled title="加权模式不记进货数量，利润按销量核算"></td>';
    return '<tr class="border-b">' +
      '<td class="text-center"><button onclick="delPurchaseRow(' + index + ')" class="text-red-500 text-lg leading-none">－</button></td>' +
      '<td><input class="w-full border px-1 py-1" value="' + esc(row.pid) + '" placeholder="编码" oninput="purchaseRows[' + index + '].pid=this.value" onchange="onPurchasePidChange(' + index + ')" onkeydown="if(event.key===\'Enter\'){this.blur();}"></td>' +
      '<td class="relative purchase-name-cell"><input class="w-full border px-1 py-1" value="' + esc(row.pname) + '" placeholder="品名（可模糊检索）" oninput="onPurchaseNameInput(' + index + ', this.value)" onfocus="onPurchaseNameFocus(' + index + ')" onkeydown="onPurchaseNameKeydown(event,' + index + ')"><div class="purchase-name-suggest hidden fixed z-50 bg-white border shadow max-h-64 overflow-auto text-sm"></div></td>' +
      '<td class="relative purchase-spec-cell"><div class="flex gap-1"><input class="w-full border px-1 py-1" value="' + esc(displaySpec(row)) + '" placeholder="规格（选或输）" oninput="onPurchaseSpecInput(' + index + ', this.value)" onfocus="openPurchaseSpecSuggest(' + index + ')" onkeydown="onPurchaseSpecKeydown(event,' + index + ')" onblur="onPurchaseSpecBlur(' + index + ', event)"><button type="button" class="border px-1 text-gray-600" onclick="togglePurchaseSpecSuggest(' + index + ')">选</button></div><div class="purchase-spec-suggest hidden fixed z-50 bg-white border shadow max-h-64 overflow-auto text-sm"></div></td>' +
      '<td>' + purchaseUnitSelectHtml(row, index) + '</td>' +
      qtyCell +
      '<td><input type="number" step="0.01" min="0" class="w-full border px-1 py-1" value="' + esc(row.price) + '" oninput="purchaseRows[' + index + '].price=this.value;calcPurchaseRow(' + index + ')"></td>' +
      '<td><input class="w-full min-w-[80px] border px-1 py-1 bg-gray-50" readonly value="' + money(row.amount) + '"></td>' +
      '<td><input type="date" class="w-full border px-1 py-1" value="' + esc(row.makeDate) + '" onchange="onPurchaseMakeDateChange(' + index + ', this.value)"></td>' +
      '<td><input type="date" class="w-full border px-1 py-1" value="' + esc(row.expDate) + '" onchange="purchaseRows[' + index + '].expDate=this.value"></td>' +
      '<td><input class="w-full border px-1 py-1" value="' + esc(row.remark) + '" placeholder="备注" oninput="purchaseRows[' + index + '].remark=this.value"></td>' +
      '<td></td></tr>';
  }).join('');
  paintPurchaseHints();
  calcPurchaseTotal();
}

function paintPurchaseHints() {
  purchaseRows.forEach(function (row, index) {
    const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
    const hint = tr && tr.cells[4] ? tr.cells[4].querySelector('.purchase-base-hint') : null;
    if (!hint) return;
    const text = purchaseBaseHint(row);
    hint.textContent = text;
    hint.className = 'purchase-base-hint text-[10px] leading-tight mt-0.5 ' +
      (text.indexOf('不能开单') >= 0 ? 'text-red-500' : 'text-gray-500');
  });
}

/* ---------- 进货品名模糊检索 ---------- */
function onPurchaseNameInput(index, value) {
  const row = purchaseRow(index);
  if (!row) return;
  row.pname = String(value || '');
  row.specOptions = [];
  if (row.goods_id || row.pid || row.spec) {
    row.goods_id = null;
    row.pid = '';
    row.spec = '';
    row.unit = '';
    row.price = '';
    row.specOptions = [];
    setPurchaseCell(index, 1, '');
    setPurchaseCell(index, 3, '');
    setPurchaseCell(index, 4, '');
    setPurchaseCell(index, 6, '');
    calcPurchaseRow(index);
  }
  clearTimeout(purchaseNameTimer);
  if (!row.pname.trim()) { closePurchaseNameSuggest(); return; }
  purchaseNameTimer = setTimeout(function () {
    searchPurchaseNames(index, row.pname);
  }, 300);
}

function onPurchaseNameFocus(index) {
  const row = purchaseRow(index);
  if (!row || !row.pname.trim()) return;
  if (!row.goods_id) searchPurchaseNames(index, row.pname);
}

async function searchPurchaseNames(index, kw) {
  kw = String(kw || '').trim();
  if (!kw) return;
  purchaseNameState = { index: index, items: [], active: -1, kw: kw, loading: true };
  try {
    const data = await api('/goods/names?' + buildQuery({ kw: kw, limit: 20 }));
    if (purchaseNameState.index !== index || purchaseNameState.kw !== kw) return;
    purchaseNameState.items = data.items || [];
    purchaseNameState.loading = false;
    renderPurchaseNameSuggest(index);
  } catch (err) {
    if (purchaseNameState.index === index) {
      purchaseNameState.loading = false;
      purchaseNameState.items = [];
      renderPurchaseNameSuggest(index, err.message);
    }
  }
}

function renderPurchaseNameSuggest(index, errorText) {
  const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
  if (!tr || !tr.cells[2]) return;
  const box = tr.cells[2].querySelector('.purchase-name-suggest');
  const input = tr.cells[2].querySelector('input');
  if (!box || !input) return;
  positionSuggestBox(box, input, 340);
  if (purchaseNameState.index !== index || !purchaseNameState.kw) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  if (errorText) {
    box.innerHTML = '<div class="px-2 py-3 text-gray-400">联想暂不可用，可继续手工录入</div>';
    box.classList.remove('hidden');
    return;
  }
  if (!purchaseNameState.items.length) {
    box.innerHTML = '<div class="px-2 py-3 text-gray-400">未查询到匹配商品，可直接输入新品名</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = purchaseNameState.items.map(function (g, i) {
    return '<div class="purchase-name-suggest-item px-2 py-1.5 border-b cursor-pointer hover:bg-blue-50 ' +
      (i === purchaseNameState.active ? 'bg-blue-100' : '') + '" data-name="' + esc(g.name) + '">' +
      '<span class="font-medium">' + highlightMatch(g.name, purchaseNameState.kw) + '</span>' +
      '<span class="text-gray-400 ml-2">' + esc(g.spec_count) + ' 个规格</span>' +
      '<span class="text-gray-300 ml-2 font-mono">' + esc(g.sample_code || '') + '</span></div>';
  }).join('');
  box.querySelectorAll('.purchase-name-suggest-item').forEach(function (el) {
    el.addEventListener('mousedown', function (event) { event.preventDefault(); });
    el.addEventListener('click', function () { selectPurchaseName(index, el.dataset.name); });
  });
  box.classList.remove('hidden');
}

function paintPurchaseNameActive(index) {
  const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
  if (!tr || !tr.cells[2]) return;
  const box = tr.cells[2].querySelector('.purchase-name-suggest');
  if (!box) return;
  box.querySelectorAll('.purchase-name-suggest-item').forEach(function (el, i) {
    el.classList.toggle('bg-blue-100', i === purchaseNameState.active);
  });
}

function onPurchaseNameKeydown(event, index) {
  const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
  const box = tr && tr.cells[2] ? tr.cells[2].querySelector('.purchase-name-suggest') : null;
  if (event.key === 'Escape') { closePurchaseNameSuggest(); return; }
  const visible = box && !box.classList.contains('hidden')
    ? Array.prototype.slice.call(box.querySelectorAll('.purchase-name-suggest-item'))
    : [];
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!visible.length) return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    purchaseNameState.active = (purchaseNameState.active + delta + visible.length) % visible.length;
    paintPurchaseNameActive(index);
    if (visible[purchaseNameState.active]) visible[purchaseNameState.active].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const activeEl = visible[purchaseNameState.active >= 0 ? purchaseNameState.active : 0];
    if (activeEl) {
      selectPurchaseName(index, activeEl.dataset.name);
    } else {
      closePurchaseNameSuggest();
      openPurchaseSpecSuggest(index);
      const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
      const specInput = tr && tr.cells[3] ? tr.cells[3].querySelector('input') : null;
      if (specInput) specInput.focus();
    }
  }
}

function closePurchaseNameSuggest() {
  document.querySelectorAll('.purchase-name-suggest').forEach(function (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
  });
  purchaseNameState = { index: null, items: [], active: -1, kw: '', loading: false };
}

async function selectPurchaseName(index, name) {
  const row = purchaseRow(index);
  if (!row) return;
  name = String(name || '').trim();
  if (!name) return;
  row.pname = name;
  row.goods_id = null;
  row.pid = '';
  row.spec = '';
  row.unit = '';
  row.price = '';
  row.specOptions = [];
  setPurchaseCell(index, 2, name);
  setPurchaseCell(index, 1, '');
  setPurchaseCell(index, 3, '');
  setPurchaseCell(index, 4, '');
  setPurchaseCell(index, 6, '');
  calcPurchaseRow(index);
  closePurchaseNameSuggest();
  await openPurchaseSpecSuggest(index, true);
  const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
  const specInput = tr && tr.cells[3] ? tr.cells[3].querySelector('input') : null;
  if (specInput) specInput.focus();
}

/* ---------- 进货规格选择/新品建档 ---------- */
function purchaseSpecKey(name) {
  return String(name || '').trim().toLowerCase();
}

function loadPurchaseSpecs(name) {
  const key = purchaseSpecKey(name);
  if (purchaseSpecCache[key]) return Promise.resolve(purchaseSpecCache[key]);
  return api('/goods/specs?' + buildQuery({ name: name })).then(function (data) {
    purchaseSpecCache[key] = data.items || [];
    return purchaseSpecCache[key];
  }).catch(function (err) {
    toast('加载规格失败：' + err.message, 'err');
    return [];
  });
}

async function openPurchaseSpecSuggest(index, force) {
  const row = purchaseRow(index);
  if (!row || !row.pname.trim()) return;
  if (!force && purchaseSpecState.index === index && purchaseSpecState.name === row.pname) {
    const tr = $('purchaseTableBody').rows[index];
    const box = tr && tr.cells[3] ? tr.cells[3].querySelector('.purchase-spec-suggest') : null;
    if (box && !box.classList.contains('hidden')) return;
  }
  purchaseSpecState = { index: index, items: row.specOptions || [], active: -1, name: row.pname };
  const items = await loadPurchaseSpecs(row.pname);
  if (purchaseSpecState.index !== index || purchaseSpecState.name !== row.pname) return;
  row.specOptions = items;
  purchaseSpecState.items = items;
  renderPurchaseSpecSuggest(index);
}

function renderPurchaseSpecSuggest(index) {
  const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
  if (!tr || !tr.cells[3]) return;
  const box = tr.cells[3].querySelector('.purchase-spec-suggest');
  const input = tr.cells[3].querySelector('input');
  if (!box || !input) return;
  positionSuggestBox(box, input, 240);
  const items = purchaseSpecState.items || [];
  if (!items.length) {
    box.innerHTML = '<div class="px-2 py-3 text-gray-400">该品名暂无规格，键入新规格后回车自动建档</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = items.map(function (s, i) {
    return '<div class="purchase-spec-suggest-item px-2 py-1.5 border-b cursor-pointer hover:bg-blue-50 ' +
      (i === purchaseSpecState.active ? 'bg-blue-100' : '') + '" data-spec="' + esc(s.spec) + '">' +
      '<span class="font-medium">' + esc(s.spec || '（无规格）') + '</span>' +
      '<span class="text-gray-400 ml-2">' + esc(s.unit || '') + '</span>' +
      '<span class="text-gray-300 ml-2 font-mono">' + esc(s.code || '') + '</span></div>';
  }).join('') + '<div class="px-2 py-1 text-gray-400 border-t">没有合适规格？直接输入新规格，回车自动生成编码</div>';
  box.querySelectorAll('.purchase-spec-suggest-item').forEach(function (el) {
    el.addEventListener('mousedown', function (event) { event.preventDefault(); });
    el.addEventListener('click', function () { choosePurchaseSpec(index, el.dataset.spec); });
  });
  box.classList.remove('hidden');
}

function onPurchaseSpecInput(index, value) {
  const row = purchaseRow(index);
  if (!row) return;
  const previous = row.spec;
  row.spec = String(value || '');
  if (row.goods_id && row.spec !== previous) {
    row.goods_id = null;
    row.pid = '';
    row.unit = '';
    setPurchaseCell(index, 1, '');
    setPurchaseCell(index, 4, '');
  }
  if (purchaseSpecState.index === index) renderPurchaseSpecSuggest(index);
}

function onPurchaseSpecKeydown(event, index) {
  const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
  const box = tr && tr.cells[3] ? tr.cells[3].querySelector('.purchase-spec-suggest') : null;
  const visible = box && !box.classList.contains('hidden')
    ? Array.prototype.slice.call(box.querySelectorAll('.purchase-spec-suggest-item'))
    : [];
  if (event.key === 'Escape') { closePurchaseSpecSuggest(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!visible.length) return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    purchaseSpecState.active = (purchaseSpecState.active + delta + visible.length) % visible.length;
    visible.forEach(function (el, i) { el.classList.toggle('bg-blue-100', i === purchaseSpecState.active); });
    if (visible[purchaseSpecState.active]) visible[purchaseSpecState.active].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const activeEl = visible[purchaseSpecState.active >= 0 ? purchaseSpecState.active : 0];
    if (activeEl) choosePurchaseSpec(index, activeEl.dataset.spec);
    else commitPurchaseSpec(index);
    setTimeout(function () {
      const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
      const unitInput = tr && tr.cells[4] ? tr.cells[4].querySelector('input') : null;
      if (unitInput) unitInput.focus();
    }, 0);
  }
}

function onPurchaseSpecBlur(index, event) {
  const next = event && event.relatedTarget;
  if (next && next.closest && next.closest('.purchase-spec-cell')) return;
  setTimeout(function () { commitPurchaseSpec(index); }, 150);
}

function togglePurchaseSpecSuggest(index) {
  const tr = $('purchaseTableBody') && $('purchaseTableBody').rows[index];
  const box = tr && tr.cells[3] ? tr.cells[3].querySelector('.purchase-spec-suggest') : null;
  if (box && !box.classList.contains('hidden') && purchaseSpecState.index === index) {
    closePurchaseSpecSuggest();
    return;
  }
  openPurchaseSpecSuggest(index, true);
}

function closePurchaseSpecSuggest() {
  document.querySelectorAll('.purchase-spec-suggest').forEach(function (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
  });
  purchaseSpecState = { index: null, items: [], active: -1, name: '' };
}

function choosePurchaseSpec(index, specText) {
  const row = purchaseRow(index);
  if (!row) return;
  closePurchaseSpecSuggest();
  const item = (row.specOptions || []).find(function (s) {
    return String(s.spec || '') === String(specText || '');
  });
  if (item) applyPurchaseGoods(index, item);
}

function applyPurchaseGoods(index, item) {
  const row = purchaseRow(index);
  if (!row) return;
  row.goods_id = Number(item.goods_id || item.id);
  row.pid = item.code || '';
  row.pname = item.name || row.pname;
  row.spec = item.spec || '';
  row.units = item.units || [];
  row.baseUnit = item.base_unit || item.unit || '';
  row.unit = item.default_purchase_unit || row.baseUnit;
  row.shelfLifeDays = Number(item.shelf_life_days || 0);
  setPurchaseCell(index, 1, row.pid);
  setPurchaseCell(index, 2, row.pname);
  setPurchaseCell(index, 3, row.spec);
  renderPurchaseRows();
  calcPurchaseRow(index);
  fillPurchaseExpDate(index);
  if (row.price === '' || row.price === null || row.price === undefined) {
    fetchLastPurchasePrice(index, row.goods_id);
  }
}

/* 生产日期 + 商品保质期 → 自动填“保质期至” */
function fillPurchaseExpDate(index) {
  const row = purchaseRow(index);
  if (!row) return;
  if (!row.makeDate || !(Number(row.shelfLifeDays) > 0)) return;
  row.expDate = addDays(row.makeDate, Number(row.shelfLifeDays));
  setPurchaseCell(index, 9, row.expDate);
}

function onPurchaseMakeDateChange(index, value) {
  const row = purchaseRow(index);
  if (!row) return;
  row.makeDate = String(value || '');
  if (!row.makeDate) {
    row.expDate = '';
    setPurchaseCell(index, 9, '');
    return;
  }
  fillPurchaseExpDate(index);
}

function fetchLastPurchasePrice(index, goodsId) {
  api('/purchases/last-price?goods_id=' + goodsId).then(function (data) {
    const row = purchaseRow(index);
    if (!row || Number(row.goods_id) !== Number(goodsId)) return;
    if (data.price && (row.price === '' || row.price === null || row.price === undefined)) {
      const unit = (row.units || []).find(function (u) { return u.unit === row.unit; });
      const factor = Number((unit && unit.factor) || 1);
      row.price = Math.round(Number(data.price) * factor * 100) / 100;
      setPurchaseCell(index, 6, row.price);
      calcPurchaseRow(index);
    }
  }).catch(function () { /* 无上次价格不阻塞 */ });
}

function commitPurchaseSpec(index) {
  const row = purchaseRow(index);
  if (!row) return Promise.resolve();
  if (row.specBusy) return row.specPromise || Promise.resolve();
  const name = String(row.pname || '').trim();
  const spec = String(row.spec || '').trim();
  if (!name || !spec) return Promise.resolve();
  if (row.goods_id && String(row.spec).trim() === spec) return Promise.resolve();
  const matched = (row.specOptions || []).find(function (item) {
    return String(item.spec || '').trim().toLowerCase() === spec.toLowerCase();
  });
  if (matched) {
    applyPurchaseGoods(index, matched);
    return Promise.resolve();
  }
  const promise = createPurchaseSpec(index, spec);
  row.specPromise = promise;
  return promise;
}

/* 保存前先等所有“新品/新规格”建档完成，避免编码还没生成就提交 */
async function flushPurchaseSpecs() {
  const tasks = purchaseRows.map(function (row, index) {
    if (!row.pname || !String(row.pname).trim()) return null;
    if (!row.spec || !String(row.spec).trim()) return null;
    if (row.goods_id) return null;
    return commitPurchaseSpec(index);
  }).filter(Boolean);
  await Promise.all(tasks);
}

async function createPurchaseSpec(index, specText) {
  const row = purchaseRow(index);
  if (!row || row.specBusy) return;
  const name = String(row.pname || '').trim();
  const spec = String(specText || '').trim();
  if (!name || !spec) return;
  row.specBusy = true;
  try {
    const data = await api('/goods/spec', {
      method: 'POST',
      body: { name: name, spec: spec, unit: row.unit || '', price: null }
    });
    delete purchaseSpecCache[purchaseSpecKey(name)];
    clearSpecCache(name);
    const goods = data.goods || {};
    toast(data.created
      ? ('新规格“' + goods.name + ' / ' + goods.spec + '”已建档，自动编码 ' + goods.code)
      : ('使用已有规格，编码 ' + goods.code), 'ok');
    if (purchaseRows[index] !== row) return;
    applyPurchaseGoods(index, {
      goods_id: goods.id,
      code: goods.code,
      name: goods.name,
      spec: goods.spec,
      unit: data.unit || goods.unit,
      base_unit: goods.base_unit,
      units: goods.units || [],
      default_purchase_unit: goods.default_purchase_unit,
      shelf_life_days: goods.shelf_life_days
    });
  } catch (err) {
    toast('新规格建档失败：' + err.message, 'err');
  } finally {
    row.specBusy = false;
  }
}

async function onPurchaseUnitCommit(index, value) {
  const row = purchaseRow(index);
  if (!row) return;
  row.unit = String(value || '').trim();
  row.price = unitPrice(row, row.unit);
  calcPurchaseRow(index);
  renderPurchaseRows();
}

function onPurchasePidChange(index) {
  const row = purchaseRows[index];
  if (!row) return;
  row.pid = String(row.pid || '').trim();
  const goods = findGoodsByCode(row.pid);
  if (!goods) return;
  applyPurchaseGoods(index, {
    goods_id: goods.id,
    code: goods.code,
    name: goods.name,
    spec: goods.spec,
    unit: goods.unit,
    shelf_life_days: goods.shelf_life_days
  });
}

function calcPurchaseRow(index) {
  const row = purchaseRows[index];
  if (!row) return;
  row.amount = Math.round((Number(row.qty || 0) * Number(row.price || 0) + Number.EPSILON) * 100) / 100;
  const tr = $('purchaseTableBody').rows[index];
  if (tr && tr.cells[7]) tr.cells[7].querySelector('input').value = money(row.amount);
  paintPurchaseHints();
  calcPurchaseTotal();
}

function calcPurchaseTotal() {
  const total = purchaseRows.reduce(function (sum, row) { return sum + (Number(row.amount) || 0); }, 0);
  $('purchaseTotal').textContent = money(total);
}

function refreshPurchaseNo() {
  return api('/purchases/next-no').then(function (data) {
    purchaseNo = data.purchase_no;
    $('purchaseNo').value = purchaseNo;
  }).catch(function () {
    purchaseNo = 'JH' + Date.now();
    $('purchaseNo').value = purchaseNo;
  });
}

async function loadPurchasePage() {
  if (!purchaseRows.length) purchaseRows = [newPurchaseRow()];
  if (!$('purchaseDate').value) $('purchaseDate').value = todayStr();
  await loadStockConfig();
  renderPurchaseRows();
  if (!purchaseEditingId) await refreshPurchaseNo();
  await loadPurchases();
}

async function savePurchase() {
  await flushPurchaseSpecs();
  const validRows = purchaseRows.filter(function (row) { return row.pid && Number(row.qty) > 0 && Number(row.price) >= 0; });
  if (!validRows.length) return toast('至少需要一行有效进货商品', 'err');
  for (let i = 0; i < validRows.length; i += 1) {
    const row = validRows[i];
    const rowNo = purchaseRows.indexOf(row) + 1;
    if (!String(displaySpec(row) || '').trim()) {
      return toast('第 ' + rowNo + ' 行必须填写规格', 'err');
    }
    if (!String(row.unit || '').trim()) {
      return toast('第 ' + rowNo + ' 行必须选择单位', 'err');
    }
  }
  const button = $('savePurchaseBtn');
  if (button) { button.disabled = true; button.textContent = '保存中…'; }
  const isEdit = !!purchaseEditingId;
  try {
    const result = await api(isEdit ? '/purchases/' + purchaseEditingId : '/purchases', {
      method: isEdit ? 'PUT' : 'POST',
      body: {
        purchase_no: $('purchaseNo').value.trim(),
        supplier: $('purchaseSupplier').value.trim(),
        bill_date: $('purchaseDate').value,
        remark: $('purchaseRemark').value.trim(),
        items: validRows.map(function (row) {
          return {
            goods_id: row.goods_id || null,
            goods_code: row.pid,
            goods_name: row.pname,
            spec: displaySpec(row),
            unit: row.unit,
            qty: Number(row.qty),
            price: Number(row.price),
            make_date: row.makeDate || null,
            exp_date: row.expDate || null,
            remark: row.remark
          };
        })
      }
    });
    toast((isEdit ? '进货单已更新' : '进货单保存成功') + '，金额 ￥' + money(result.total_amount), 'ok');
    clearPurchaseForm();
    await loadPurchases();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = purchaseEditingId ? '保存修改' : '保存进货单';
    }
  }
}

function clearPurchaseForm() {
  purchaseEditingId = null;
  purchaseNameState = { index: null, items: [], active: -1, kw: '', loading: false };
  purchaseSpecState = { index: null, items: [], active: -1, name: '' };
  purchaseRows = [newPurchaseRow()];
  $('purchaseSupplier').value = '';
  $('purchaseRemark').value = '';
  $('purchaseDate').value = todayStr();
  $('purchaseNo').disabled = false;
  if ($('cancelPurchaseEditBtn')) $('cancelPurchaseEditBtn').classList.add('hidden');
  const button = $('savePurchaseBtn');
  if (button) button.textContent = '保存进货单';
  renderPurchaseRows();
  refreshPurchaseNo();
}

/* 批次模式：载入历史进货单明细到上面表单，可改数量/价格后保存 */
async function editPurchase(id) {
  if (stockConfig.mode !== 'batch') {
    return toast('加权模式的进货单不可编辑，请作废后重新开单', 'err');
  }
  try {
    const p = await api('/purchases/' + id);
    if (Number(p.is_void) === 1) return toast('已作废的进货单不能编辑', 'err');
    purchaseEditingId = Number(p.id);
    purchaseRows = (p.items || []).map(function (item) {
      const goods = findGoodsById(item.goods_id);
      return {
        goods_id: item.goods_id,
        pid: item.goods_code || '',
        pname: item.goods_name || '',
        spec: item.spec || '',
        unit: item.unit || '',
        units: goods ? (goods.units || []) : [],
        baseUnit: goods ? (goods.base_unit || goods.unit || '') : '',
        qty: item.qty,
        price: item.price,
        amount: item.amount,
        makeDate: item.make_date || '',
        expDate: item.exp_date || '',
        remark: item.remark || '',
        shelfLifeDays: goods ? Number(goods.shelf_life_days || 0) : 0
      };
    });
    if (!purchaseRows.length) purchaseRows = [newPurchaseRow()];
    $('purchaseNo').value = p.purchase_no;
    $('purchaseNo').disabled = true;
    $('purchaseSupplier').value = p.supplier || '';
    $('purchaseDate').value = p.bill_date || todayStr();
    $('purchaseRemark').value = p.remark || '';
    const button = $('savePurchaseBtn');
    if (button) button.textContent = '保存修改';
    if ($('cancelPurchaseEditBtn')) $('cancelPurchaseEditBtn').classList.remove('hidden');
    renderPurchaseRows();
    toast('已载入进货单 ' + p.purchase_no + '，修改后点“保存修改”', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function exitPurchaseEdit() {
  clearPurchaseForm();
  toast('已退出编辑', 'ok');
}

async function loadPurchases() {
  const tbody = $('purchaseListBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-400 py-4">加载中…</td></tr>';
  try {
    const query = buildQuery({
      kw: $('purchaseKw').value.trim(),
      date_from: $('purchaseFrom').value,
      date_to: $('purchaseTo').value,
      page: 1,
      page_size: 200
    });
    const data = await api('/purchases?' + query);
    $('purchaseCountHint').textContent = '共 ' + data.total + ' 单';
    tbody.innerHTML = (data.items || []).length ? data.items.map(function (p) {
      const voided = Number(p.is_void) === 1;
      const canEdit = !voided && stockConfig.mode === 'batch';
      const ops = '<button onclick="event.stopPropagation();openPurchaseDetail(' + p.id + ')" class="text-primaryBlue mr-2">查看</button>' +
        (canEdit ? '<button onclick="event.stopPropagation();editPurchase(' + p.id + ')" class="text-primaryBlue mr-2">编辑</button>' : '') +
        (voided ? '' : '<button onclick="event.stopPropagation();voidPurchase(' + p.id + ')" class="text-red-500">作废</button>');
      return '<tr class="border-b cursor-pointer hover:bg-blue-50 ' + (voided ? 'bg-gray-100 text-gray-400' : '') + '" onclick="openPurchaseDetail(' + p.id + ')">' +
        '<td class="border px-2 py-1 font-mono">' + esc(p.purchase_no) + '</td>' +
        '<td class="border px-2 py-1">' + esc(p.bill_date) + '</td>' +
        '<td class="border px-2 py-1">' + esc(p.supplier || '-') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + p.total_qty + '</td>' +
        '<td class="border px-2 py-1 text-right">￥' + money(p.total_amount) + '</td>' +
        '<td class="border px-2 py-1 text-center">' + (voided ? '<span class="text-red-500">已作废</span>' : '<span class="text-green-600">正常</span>') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + (ops || '-') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="7" class="text-center text-gray-400 py-4">暂无进货单</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-red-500 py-4">' + esc(err.message) + '</td></tr>';
  }
}

async function voidPurchase(id) {
  if (!confirm('确定作废这笔进货单？批次模式会检查批次是否已出库，加权模式会回冲成本。')) return;
  try {
    await api('/purchases/' + id + '/void', { method: 'POST' });
    toast('进货单已作废', 'ok');
    await loadPurchases();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function openPurchaseDetail(id) {
  const modal = $('purchaseDetailModal');
  const body = $('purchaseDetailBody');
  if (!modal || !body) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  $('purchaseDetailNo').textContent = '加载中…';
  $('purchaseDetailMeta').innerHTML = '';
  $('purchaseDetailCount').textContent = '';
  $('purchaseDetailTotal').textContent = '';
  body.innerHTML = '<tr><td colspan="10" class="text-center text-gray-400 py-6">加载中…</td></tr>';
  try {
    const p = await api('/purchases/' + id);
    $('purchaseDetailNo').textContent = p.purchase_no || '';
    const voided = Number(p.is_void) === 1;
    $('purchaseDetailMeta').innerHTML =
      '<div><span class="text-gray-500">进货日期：</span>' + esc(p.bill_date || '-') + '</div>' +
      '<div><span class="text-gray-500">供应商：</span>' + esc(p.supplier || '-') + '</div>' +
      '<div><span class="text-gray-500">状态：</span>' + (voided ? '<span class="text-red-500">已作废</span>' : '<span class="text-green-600">正常</span>') + '</div>' +
      '<div><span class="text-gray-500">录入人：</span>' + esc(p.created_by || '-') + '</div>' +
      (p.remark ? '<div class="col-span-2"><span class="text-gray-500">备注：</span>' + esc(p.remark) + '</div>' : '');
    const items = p.items || [];
    body.innerHTML = items.length ? items.map(function (item) {
      const goods = findGoodsById(item.goods_id) || {};
      const baseUnit = goods.base_unit || goods.unit || '';
      const baseQty = Number(item.base_qty || 0);
      const costBase = Number(item.cost_base || 0);
      return '<tr class="border-b">' +
        '<td class="border px-2 py-1 font-mono">' + esc(item.goods_code || '') + '</td>' +
        '<td class="border px-2 py-1">' + esc(item.goods_name || '') + '</td>' +
        '<td class="border px-2 py-1">' + esc(item.spec || '') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(item.unit || '') + '</td>' +
        '<td class="border px-2 py-1 text-right">' + (Math.round(Number(item.qty || 0) * 1000) / 1000) + '</td>' +
        '<td class="border px-2 py-1 text-right">￥' + money(item.price) + '</td>' +
        '<td class="border px-2 py-1 text-right">￥' + money(item.amount) + '</td>' +
        '<td class="border px-2 py-1 text-right">' + (baseQty ? (Math.round(baseQty * 1000) / 1000) + esc(baseUnit) + ' / ￥' + money(costBase) + '/' + esc(baseUnit) : '-') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(item.make_date || '-') + '</td>' +
        '<td class="border px-2 py-1 text-center">' + esc(item.exp_date || '-') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="10" class="text-center text-gray-400 py-6">该进货单没有明细</td></tr>';
    $('purchaseDetailCount').textContent = '共 ' + items.length + ' 个商品';
    $('purchaseDetailTotal').textContent = '￥' + money(p.total_amount);
  } catch (err) {
    $('purchaseDetailNo').textContent = '加载失败';
    body.innerHTML = '<tr><td colspan="10" class="text-center text-red-500 py-6">' + esc(err.message) + '</td></tr>';
  }
}

function closePurchaseDetail() {
  const modal = $('purchaseDetailModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function resetPurchaseFilters() {
  $('purchaseKw').value = '';
  $('purchaseFrom').value = '';
  $('purchaseTo').value = '';
  loadPurchases();
}

/* ==================== 库存与成本配置 ==================== */
async function loadStockConfig() {
  try {
    stockConfig = await api('/config/stock');
    if ($('setStockMode')) $('setStockMode').value = stockConfig.mode;
    if ($('setStockStrategy')) $('setStockStrategy').value = stockConfig.strategy;
    if ($('setAllowNegative')) $('setAllowNegative').checked = !!stockConfig.allow_negative;
    if ($('setCloseMonth')) $('setCloseMonth').value = stockConfig.close_month || '';
    if ($('stockModeNow')) $('stockModeNow').textContent = stockConfig.mode === 'batch' ? '批次模式' : '加权模式';
    if ($('purchaseModeHint')) {
      $('purchaseModeHint').textContent = stockConfig.mode === 'batch'
        ? '当前批次模式：数量可填，保存后生成批次库存，历史进货单可编辑'
        : '当前加权模式：数量不记（固定 1），保存后更新加权成本，利润按销量核算';
    }
    return stockConfig;
  } catch (err) {
    return stockConfig;
  }
}

async function saveStockConfig() {
  try {
    stockConfig = await api('/config/stock', {
      method: 'PUT',
      body: {
        stock_cost_mode: $('setStockMode').value,
        stock_out_strategy: $('setStockStrategy').value,
        allow_negative_stock: $('setAllowNegative').checked,
        close_account_month: $('setCloseMonth').value.trim()
      }
    });
    $('stockModeNow').textContent = stockConfig.mode === 'batch' ? '批次模式' : '加权模式';
    toast('库存与成本模式已保存，只影响之后的新单据', 'ok');
    if ($('purchaseTableBody')) renderPurchaseRows();
    if ($('purchaseListBody')) loadPurchases();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function loadMemoGoodsSelect() {
  const select = $('clearMemoGoods');
  if (!select) return;
  const current = select.value;
  select.innerHTML = goodsList.map(function (g) {
    return '<option value="' + g.id + '">' + esc(g.code + ' ' + g.name) + '</option>';
  }).join('');
  if (current) select.value = current;
}

async function clearDateMemo(all) {
  if (all) {
    if (!confirm('确定清除全部商品的效期记忆？此操作不可恢复。')) return;
    try {
      const data = await api('/goods/date-memo', { method: 'DELETE' });
      toast('已清除 ' + data.deleted + ' 条效期记忆', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const goodsId = Number($('clearMemoGoods').value);
  if (!goodsId) return toast('请选择商品', 'err');
  try {
    const data = await api('/goods/' + goodsId + '/date-memo', { method: 'DELETE' });
    toast(data.deleted ? '该商品效期记忆已清除' : '该商品没有效期记忆', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ==================== 经营统计 ==================== */
function initStatPage() {
  renderStatGoodsChips();
  renderStatCustomerChips();
  bindStatPickers();
  if ($('statFrom') && !$('statFrom').value) {
    const now = new Date();
    $('statFrom').value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    $('statTo').value = todayStr();
  }
  if (!$('statType').dataset.bound) {
    ['statType', 'statTarget', 'statGran', 'statSnapshot'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (id === 'statGran') alignStatDates();
        if (id === 'statType' && $('statTrendMetric')) $('statTrendMetric').value = $('statType').value;
        loadStatSummary();
      });
    });
    $('statType').dataset.bound = '1';
  }
  if ($('statTrendMetric')) $('statTrendMetric').value = $('statType').value;
  loadStatSummary();
}

function statGoodsLabel(id) {
  const goods = goodsList.find(function (g) { return String(g.id) === String(id); });
  return goods ? (goods.code + ' ' + goods.name) : String(id);
}

function statCustomerLabel(no) {
  const customer = customers.find(function (c) { return String(c.customer_no) === String(no); });
  return customer ? (customer.customer_no + ' ' + customer.name) : String(no);
}

function renderStatGoodsChips() {
  const wrap = $('statGoodsChips');
  if (!wrap) return;
  wrap.innerHTML = statGoodsIds.map(function (id) {
    return '<span class="inline-flex items-center gap-1 bg-blue-50 text-primaryBlue border border-blue-200 rounded px-1.5 py-0.5 text-xs">' +
      esc(statGoodsLabel(id)) +
      '<button type="button" class="text-gray-500 hover:text-red-500" title="移除" onclick="removeStatGoods(\'' + esc(String(id)) + '\')">×</button></span>';
  }).join('');
}

function renderStatCustomerChips() {
  const wrap = $('statCustomerChips');
  if (!wrap) return;
  wrap.innerHTML = statCustomerNos.map(function (no) {
    return '<span class="inline-flex items-center gap-1 bg-blue-50 text-primaryBlue border border-blue-200 rounded px-1.5 py-0.5 text-xs">' +
      esc(statCustomerLabel(no)) +
      '<button type="button" class="text-gray-500 hover:text-red-500" title="移除" onclick="removeStatCustomer(\'' + esc(String(no)) + '\')">×</button></span>';
  }).join('');
}

function hideStatGoodsMenu() {
  const menu = $('statGoodsMenu');
  if (menu) menu.classList.add('hidden');
}

function hideStatCustomerMenu() {
  const menu = $('statCustomerMenu');
  if (menu) menu.classList.add('hidden');
}

function openStatGoodsMenu() {
  const menu = $('statGoodsMenu');
  const input = $('statGoodsSearch');
  if (!menu || !input) return;
  const query = input.value.trim().toLowerCase();
  const matches = goodsList.filter(function (g) {
    if (statGoodsIds.indexOf(String(g.id)) >= 0) return false;
    if (!query) return true;
    return [g.code, g.name, g.spec].join(' ').toLowerCase().indexOf(query) >= 0;
  }).slice(0, 30);
  menu.innerHTML = matches.length ? matches.map(function (g) {
    return '<button type="button" data-goods-id="' + g.id + '" onmousedown="event.preventDefault()" onclick="pickStatGoods(\'' + g.id + '\')" class="block w-full text-left px-2 py-1.5 hover:bg-blue-50 border-b border-gray-100 last:border-0">' +
      '<span class="font-mono text-primaryBlue text-xs mr-1">' + esc(g.code) + '</span>' + esc(g.name) +
      (g.spec ? '<span class="text-gray-400 text-xs ml-1">' + esc(g.spec) + '</span>' : '') +
      '</button>';
  }).join('') : '<div class="px-2 py-2 text-gray-400">没有匹配的商品</div>';
  menu.classList.remove('hidden');
}

function openStatCustomerMenu() {
  const menu = $('statCustomerMenu');
  const input = $('statCustomerSearch');
  if (!menu || !input) return;
  const query = input.value.trim().toLowerCase();
  const matches = customers.filter(function (c) {
    if (statCustomerNos.indexOf(String(c.customer_no)) >= 0) return false;
    if (!query) return true;
    return [c.customer_no, c.name, c.tel, c.addr].join(' ').toLowerCase().indexOf(query) >= 0;
  }).slice(0, 30);
  menu.innerHTML = matches.length ? matches.map(function (c) {
    return '<button type="button" data-customer-no="' + c.customer_no + '" onmousedown="event.preventDefault()" onclick="pickStatCustomer(\'' + c.customer_no + '\')" class="block w-full text-left px-2 py-1.5 hover:bg-blue-50 border-b border-gray-100 last:border-0">' +
      '<span class="font-mono text-primaryBlue text-xs mr-1">' + esc(c.customer_no) + '</span>' + esc(c.name) +
      '</button>';
  }).join('') : '<div class="px-2 py-2 text-gray-400">没有匹配的客户</div>';
  menu.classList.remove('hidden');
}

function pickStatGoods(id) {
  const value = String(id);
  if (statGoodsIds.indexOf(value) < 0) statGoodsIds.push(value);
  const input = $('statGoodsSearch');
  if (input) input.value = '';
  hideStatGoodsMenu();
  renderStatGoodsChips();
  loadStatSummary();
}

function removeStatGoods(id) {
  statGoodsIds = statGoodsIds.filter(function (value) { return value !== String(id); });
  renderStatGoodsChips();
  loadStatSummary();
}

function pickStatCustomer(no) {
  const value = String(no);
  if (statCustomerNos.indexOf(value) < 0) statCustomerNos.push(value);
  const input = $('statCustomerSearch');
  if (input) input.value = '';
  hideStatCustomerMenu();
  renderStatCustomerChips();
  loadStatSummary();
}

function removeStatCustomer(no) {
  statCustomerNos = statCustomerNos.filter(function (value) { return value !== String(no); });
  renderStatCustomerChips();
  loadStatSummary();
}

function bindStatPickers() {
  const goodsInput = $('statGoodsSearch');
  const customerInput = $('statCustomerSearch');
  if (goodsInput && !goodsInput.dataset.bound) {
    goodsInput.addEventListener('input', openStatGoodsMenu);
    goodsInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        const menu = $('statGoodsMenu');
        const first = menu && !menu.classList.contains('hidden') ? menu.querySelector('[data-goods-id]') : null;
        if (first) pickStatGoods(first.dataset.goodsId);
      } else if (event.key === 'Escape') {
        hideStatGoodsMenu();
      }
    });
    goodsInput.addEventListener('blur', function () { setTimeout(hideStatGoodsMenu, 150); });
    goodsInput.dataset.bound = '1';
  }
  if (customerInput && !customerInput.dataset.bound) {
    customerInput.addEventListener('input', openStatCustomerMenu);
    customerInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        const menu = $('statCustomerMenu');
        const first = menu && !menu.classList.contains('hidden') ? menu.querySelector('[data-customer-no]') : null;
        if (first) pickStatCustomer(first.dataset.customerNo);
      } else if (event.key === 'Escape') {
        hideStatCustomerMenu();
      }
    });
    customerInput.addEventListener('blur', function () { setTimeout(hideStatCustomerMenu, 150); });
    customerInput.dataset.bound = '1';
  }
}

function localDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function alignStatDates() {
  const gran = $('statGran').value;
  const start = $('statFrom').value ? new Date($('statFrom').value + 'T00:00:00') : new Date();
  if (gran === 'week') {
    const day = start.getDay() || 7;
    const monday = new Date(start);
    monday.setDate(start.getDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    $('statFrom').value = localDate(monday);
    $('statTo').value = localDate(sunday);
  } else if (gran === 'month') {
    $('statFrom').value = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-01';
    const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    $('statTo').value = localDate(last);
  }
}

function statSelectedValues(id) {
  if (id === 'statGoods') return statGoodsIds.join(',');
  if (id === 'statCustomers') return statCustomerNos.join(',');
  const el = $(id);
  return el ? Array.from(el.selectedOptions || []).map(function (o) { return o.value; }).join(',') : '';
}

function statQuery(targetId) {
  return buildQuery({
    stat_target: $('statTarget').value,
    stat_type: $('statType').value,
    time_gran: $('statGran').value,
    start_date: $('statFrom').value,
    end_date: $('statTo').value,
    goods_ids: statSelectedValues('statGoods'),
    customer_ids: statSelectedValues('statCustomers'),
    profit_type: $('statSnapshot').checked ? 'snapshot' : 'latest',
    top_n: 0,
    target_id: targetId || ''
  });
}

async function loadStatSummary() {
  statTablePage = 1;
  statTableSortKey = 'time_label';
  statTableSortDir = -1;
  $('statHint').textContent = '加载中…';
  try {
    const data = await api('/stat/summary?' + statQuery(''));
    statRows = data.list || [];
    const filterParts = [];
    if (statGoodsIds.length) filterParts.push('商品 ' + statGoodsIds.map(statGoodsLabel).join('、'));
    if (statCustomerNos.length) filterParts.push('客户 ' + statCustomerNos.map(statCustomerLabel).join('、'));
    $('statHint').textContent = '共 ' + statRows.length + ' 行 · 当前按' + ($('statSnapshot').checked ? '快照' : '最新核算') + '成本' +
      (filterParts.length ? ' · 已筛选：' + filterParts.join('；') : '');
    renderStatChart();
    renderStatTable();
    loadStatPie();
    if (statSelectedTarget && statRows.some(function (r) { return String(r.id) === String(statSelectedTarget); })) {
      await loadStatTrend(statSelectedTarget);
    } else {
      statSelectedTarget = '';
      statTrendRows = [];
      if (statTrendChart) statTrendChart.clear();
      renderStatTrendChart();
    }
  } catch (err) {
    $('statHint').textContent = err.message;
    toast(err.message, 'err');
  }
}

function statAggregated() {
  const metric = $('statType').value;
  const map = {};
  statRows.forEach(function (row) {
    const key = String(row.id);
    if (!map[key]) map[key] = { id: row.id, name: row.name, qty: 0, turnover: 0, profit: 0 };
    map[key].qty += Number(row.qty) || 0;
    map[key].turnover += Number(row.turnover) || 0;
    map[key].profit += Number(row.profit) || 0;
  });
  return Object.values(map).sort(function (a, b) { return b[metric] - a[metric]; });
}

function renderStatChart() {
  if (!window.echarts) return;
  if (!statBarChart) statBarChart = echarts.init($('statBarChart'));
  const metric = $('statType').value;
  let rows = statAggregated();
  const sort = $('statSort').value;
  if (sort === 'amount_asc') rows.sort(function (a, b) { return a[metric] - b[metric]; });
  else if (sort === 'name_asc') rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh-CN'); });
  else rows.sort(function (a, b) { return b[metric] - a[metric]; });
  rows = rows.slice(0, 20).reverse();
  statBarChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 10, right: 70, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: rows.map(function (r) { return r.name; }) },
    series: [{
      type: 'bar',
      data: rows.map(function (r) { return Math.round(Number(r[metric]) * 100) / 100; }),
      itemStyle: { color: metric === 'profit' ? '#16a34a' : '#2488c8' },
      label: { show: true, position: 'right', formatter: function (p) { return '￥' + money(p.value); } },
      barMaxWidth: 22
    }]
  }, true);
  statBarChart.off('click');
  statBarChart.on('click', function (params) {
    const row = rows[params.dataIndex];
    if (row) {
      statSelectedTarget = row.id;
      loadStatTrend(row.id);
    }
  });
}

async function loadStatTrend(targetId) {
  try {
    const data = await api('/stat/trend?' + statQuery(targetId));
    statTrendRows = data.list || [];
    renderStatTrendChart();
  } catch (err) {
    toast(err.message, 'err');
  }
}

const STAT_CHART_COLORS = ['#2488c8', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2',
  '#ea580c', '#4d7c0f', '#be185d', '#475569', '#a16207', '#0f766e'];

function statTrendMetric() {
  return $('statTrendMetric') && $('statTrendMetric').value === 'profit' ? 'profit' : 'turnover';
}

function statTrendExtra() {
  return $('statTrendExtra') ? $('statTrendExtra').value : 'none';
}

function statLabelsOn() {
  return !!($('statTrendLabels') && $('statTrendLabels').checked);
}

function renderStatCharts() {
  renderStatTrendChart();
  renderStatPieChart();
}

function statTrendGoods(rows, metric) {
  const map = {};
  rows.forEach(function (row) {
    (row.details || []).forEach(function (item) {
      const key = String(item.goods_id);
      if (!map[key]) map[key] = { goods_id: item.goods_id, goods_name: item.goods_name, total: 0, sortTurnover: 0 };
      map[key].total += Number(item[metric]) || 0;
      map[key].sortTurnover += Number(item.turnover) || 0;
    });
  });
  return Object.values(map).sort(function (a, b) {
    return b.sortTurnover - a.sortTurnover || String(a.goods_name).localeCompare(String(b.goods_name), 'zh-CN');
  });
}

function statChartValue(value, percent) {
  const number = Number(value) || 0;
  return percent ? number.toFixed(2) + '%' : '￥' + money(number);
}

function renderStatTrendChart() {
  if (!window.echarts) return;
  if (!statTrendChart) statTrendChart = echarts.init($('statTrendChart'));
  const summary = $('statTrendSummary');
  if (!statTrendRows.length) {
    statTrendChart.clear();
    if (summary) summary.textContent = statSelectedTarget ? '暂无趋势数据' : '请点击上方条形图选择商品或客户查看趋势分析';
    return;
  }
  const metric = statTrendMetric();
  const metricLabel = metric === 'profit' ? '利润' : '营业额';
  const extra = statTrendExtra();
  const labels = statLabelsOn();
  const periods = statTrendRows.map(function (row) { return row.time_label; });
  const goods = statTrendGoods(statTrendRows, metric);
  const series = [];

  goods.forEach(function (item, index) {
    const color = STAT_CHART_COLORS[index % STAT_CHART_COLORS.length];
    series.push({
      name: item.goods_name || ('商品' + item.goods_id),
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      connectNulls: false,
      lineStyle: { width: 2, color: color },
      itemStyle: { color: color },
      data: statTrendRows.map(function (row) {
        const detail = (row.details || []).find(function (d) { return String(d.goods_id) === String(item.goods_id); });
        return detail ? Number(detail[metric]) || 0 : 0;
      }),
      label: {
        show: labels,
        position: 'top',
        fontSize: 10,
        color: color,
        formatter: function (p) { return statChartValue(p.value, false); }
      }
    });
  });

  if (extra === 'cost') {
    goods.forEach(function (item, index) {
      const color = STAT_CHART_COLORS[index % STAT_CHART_COLORS.length];
      series.push({
        name: (item.goods_name || ('商品' + item.goods_id)) + '成本',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.2, type: 'dashed', color: color, opacity: 0.6 },
        itemStyle: { color: color },
        data: statTrendRows.map(function (row) {
          const detail = (row.details || []).find(function (d) { return String(d.goods_id) === String(item.goods_id); });
          return detail ? Number(detail.cost) || 0 : 0;
        }),
        label: {
          show: labels,
          position: 'bottom',
          fontSize: 10,
          color: color,
          formatter: function (p) { return statChartValue(p.value, false); }
        }
      });
    });
    series.push({
      name: '总成本',
      type: 'line',
      smooth: true,
      symbol: 'diamond',
      symbolSize: 8,
      z: 12,
      lineStyle: { width: 3.5, type: 'dashed', color: '#111827' },
      itemStyle: { color: '#111827' },
      data: statTrendRows.map(function (row) { return Number(row.cost) || 0; }),
      label: {
        show: labels,
        position: 'bottom',
        fontSize: 10,
        color: '#111827',
        formatter: function (p) { return statChartValue(p.value, false); }
      }
    });
  }

  if (extra === 'margin') {
    goods.forEach(function (item, index) {
      const color = STAT_CHART_COLORS[index % STAT_CHART_COLORS.length];
      series.push({
        name: (item.goods_name || ('商品' + item.goods_id)) + '毛利率',
        type: 'line',
        smooth: true,
        symbol: 'none',
        yAxisIndex: 1,
        lineStyle: { width: 1.2, type: 'dashed', color: color, opacity: 0.7 },
        itemStyle: { color: color },
        data: statTrendRows.map(function (row) {
          const detail = (row.details || []).find(function (d) { return String(d.goods_id) === String(item.goods_id); });
          return detail ? Number(detail.margin) || 0 : 0;
        }),
        label: {
          show: labels,
          position: 'bottom',
          fontSize: 10,
          color: color,
          formatter: function (p) { return statChartValue(p.value, true); }
        }
      });
    });
    series.push({
      name: '总毛利率',
      type: 'line',
      smooth: true,
      symbol: 'diamond',
      symbolSize: 8,
      yAxisIndex: 1,
      z: 13,
      lineStyle: { width: 3.5, type: 'dashed', color: '#dc2626' },
      itemStyle: { color: '#dc2626' },
      data: statTrendRows.map(function (row) { return Number(row.margin) || 0; }),
      label: {
        show: labels,
        position: 'top',
        fontSize: 10,
        color: '#dc2626',
        formatter: function (p) { return statChartValue(p.value, true); }
      }
    });
  }

  series.push({
    name: '总计' + metricLabel,
    type: 'line',
    smooth: true,
    symbol: 'diamond',
    symbolSize: 9,
    z: 20,
    lineStyle: { width: 4.5, color: '#111827' },
    itemStyle: { color: '#111827' },
    data: statTrendRows.map(function (row) { return Number(row[metric]) || 0; }),
    label: {
      show: labels,
      position: 'top',
      fontSize: 11,
      fontWeight: 'bold',
      color: '#111827',
      formatter: function (p) { return statChartValue(p.value, false); }
    }
  });

  const yAxis = [{ type: 'value', name: '金额（元）', axisLabel: { formatter: function (v) { return money(v); } } }];
  if (extra === 'margin') {
    yAxis.push({ type: 'value', name: '毛利率（%）', axisLabel: { formatter: function (v) { return v + '%'; } }, splitLine: { show: false } });
  }

  statTrendChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: function (params) {
        if (!params || !params.length) return '';
        const lines = ['<b>' + esc(params[0].axisValue) + '</b>'];
        params.slice().sort(function (a, b) {
          const at = a.seriesName.indexOf('总计') === 0 ? 0 : 1;
          const bt = b.seriesName.indexOf('总计') === 0 ? 0 : 1;
          return at - bt;
        }).forEach(function (p) {
          const percent = p.seriesName.indexOf('毛利率') >= 0;
          const value = percent ? statChartValue(p.value, true) : statChartValue(p.value, false);
          lines.push(p.marker + esc(p.seriesName) + ': ' + value);
        });
        return lines.join('<br/>');
      }
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 6,
      top: 42,
      bottom: 12,
      itemWidth: 14,
      itemGap: 8,
      textStyle: { fontSize: 10 },
      formatter: function (name) { return name.length > 10 ? name.slice(0, 10) + '…' : name; },
      data: series.map(function (s) { return s.name; })
    },
    grid: { left: 12, right: extra === 'margin' ? 190 : 170, top: 40, bottom: 16, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: periods },
    yAxis: yAxis,
    series: series
  }, true);

  const totalTurnover = statTrendRows.reduce(function (sum, row) { return sum + (Number(row.turnover) || 0); }, 0);
  const totalProfit = statTrendRows.reduce(function (sum, row) { return sum + (Number(row.profit) || 0); }, 0);
  const totalCost = statTrendRows.reduce(function (sum, row) { return sum + (Number(row.cost) || 0); }, 0);
  const totalMargin = totalTurnover ? totalProfit / totalTurnover * 100 : 0;
  if (summary) {
    summary.innerHTML =
      '<span class="mr-4">总计营业额 <b class="text-gray-800">￥' + money(totalTurnover) + '</b></span>' +
      '<span class="mr-4">总计利润 <b class="text-green-700">￥' + money(totalProfit) + '</b></span>' +
      '<span class="mr-4">总计毛利率 <b class="text-red-600">' + totalMargin.toFixed(2) + '%</b></span>' +
      '<span class="mr-4">总成本 <b class="text-gray-800">￥' + money(totalCost) + '</b></span>' +
      '<span>商品数 <b class="text-gray-800">' + goods.length + '</b>（单品毛利率可切换“附加曲线 → 毛利率”查看）</span>';
  }
}

async function loadStatPie() {
  if (!window.echarts) return;
  try {
    const params = {
      stat_target: 'customer',
      stat_type: 'turnover',
      time_gran: $('statGran').value,
      start_date: $('statFrom').value,
      end_date: $('statTo').value,
      goods_ids: statSelectedValues('statGoods'),
      customer_ids: '',
      profit_type: 'latest',
      top_n: 0
    };
    const data = await api('/stat/summary?' + buildQuery(params));
    const grouped = {};
    (data.list || []).forEach(function (row) {
      const key = String(row.id);
      if (!grouped[key]) grouped[key] = { name: row.name || ('客户' + key), turnover: 0 };
      grouped[key].turnover += Number(row.turnover) || 0;
    });
    let rows = Object.values(grouped).filter(function (row) { return row.turnover > 0; })
      .sort(function (a, b) { return b.turnover - a.turnover; });
    if (rows.length > 10) {
      const rest = rows.slice(10).reduce(function (sum, row) { return sum + row.turnover; }, 0);
      rows = rows.slice(0, 10);
      if (rest > 0) rows.push({ name: '其他客户', turnover: rest });
    }
    statPieData = rows;
    renderStatPieChart();
  } catch (err) {
    statPieData = [];
    renderStatPieChart();
  }
}

function renderStatPieChart() {
  if (!window.echarts || !$('statPieChart')) return;
  if (!statPieChart) statPieChart = echarts.init($('statPieChart'));
  const labels = statLabelsOn();
  if (!statPieData.length) {
    statPieChart.clear();
    statPieChart.setOption({
      title: { text: '暂无营业额数据', left: 'center', top: 'middle', textStyle: { color: '#9ca3af', fontSize: 13, fontWeight: 'normal' } }
    }, true);
    return;
  }
  statPieChart.setOption({
    color: STAT_CHART_COLORS,
    tooltip: {
      trigger: 'item',
      formatter: function (p) {
        const percent = p.percent === undefined ? 0 : p.percent;
        return esc(p.name) + '<br/>营业额：￥' + money(p.value) + '<br/>占比：' + Number(percent).toFixed(2) + '%';
      }
    },
    legend: { type: 'scroll', bottom: 0, left: 8, right: 8, textStyle: { fontSize: 10 } },
    series: [{
      name: '客户营业额',
      type: 'pie',
      radius: ['34%', '62%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 1 },
      label: {
        show: labels,
        fontSize: 10,
        formatter: function (p) { return p.name + '\n' + Number(p.percent).toFixed(2) + '%'; }
      },
      labelLine: { show: labels },
      data: statPieData.map(function (row) { return { name: row.name, value: row.turnover }; })
    }]
  }, true);
}

function statColumns() {
  const target = $('statTarget').value;
  if (target === 'customer') {
    return [
      { key: 'time_label', label: '统计周期' },
      { key: 'name', label: '客户名称' },
      { key: 'order_count', label: '订单数' },
      { key: 'turnover', label: '营业额' },
      { key: 'profit', label: '利润' }
    ];
  }
  if (target === 'customer_goods') {
    return [
      { key: 'time_label', label: '统计周期' },
      { key: 'customer_name', label: '客户名称' },
      { key: 'goods_name', label: '商品名称' },
      { key: 'qty', label: '数量' },
      { key: 'turnover', label: '营业额' },
      { key: 'profit', label: '利润' }
    ];
  }
  return [
    { key: 'time_label', label: '统计周期' },
    { key: 'code', label: '商品编码' },
    { key: 'name', label: '商品名称' },
    { key: 'qty', label: '数量' },
    { key: 'turnover', label: '营业额' },
    { key: 'profit', label: '利润' }
  ];
}

function sortStatTable(key) {
  if (statTableSortKey === key) statTableSortDir = -statTableSortDir;
  else { statTableSortKey = key; statTableSortDir = 1; }
  statTablePage = 1;
  renderStatTable();
}

function renderStatTable() {
  const cols = statColumns();
  const head = $('statTableHead');
  const body = $('statTableBody');
  head.innerHTML = '<tr>' + cols.map(function (col) {
    const arrow = statTableSortKey === col.key ? (statTableSortDir > 0 ? ' ▲' : ' ▼') : '';
    return '<th class="border px-2 py-2 cursor-pointer select-none" onclick="sortStatTable(\'' + col.key + '\')">' + col.label + arrow + '</th>';
  }).join('') + '</tr>';
  if (!statRows.length) {
    body.innerHTML = '<tr><td colspan="' + cols.length + '" class="text-center text-gray-400 py-6">暂无数据</td></tr>';
    $('statPager').innerHTML = '';
    return;
  }
  const sorted = statRows.slice().sort(function (a, b) {
    const av = a[statTableSortKey];
    const bv = b[statTableSortKey];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * statTableSortDir;
    return String(av === undefined ? '' : av).localeCompare(String(bv === undefined ? '' : bv), 'zh-CN') * statTableSortDir;
  });
  const pages = Math.max(1, Math.ceil(sorted.length / statPageSize));
  statTablePage = Math.min(Math.max(1, statTablePage), pages);
  const pageRows = sorted.slice((statTablePage - 1) * statPageSize, statTablePage * statPageSize);
  body.innerHTML = pageRows.map(function (row) {
    return '<tr class="border-b">' + cols.map(function (col) {
      let value = row[col.key];
      if (col.key === 'turnover' || col.key === 'profit') value = money(value);
      return '<td class="border px-2 py-1">' + esc(value) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  $('statPager').innerHTML =
    '<span>共 ' + sorted.length + ' 行，第 ' + statTablePage + '/' + pages + ' 页</span>' +
    '<button onclick="statTablePage=1;renderStatTable()" class="border rounded px-2 py-0.5" ' + (statTablePage <= 1 ? 'disabled' : '') + '>首页</button>' +
    '<button onclick="statTablePage=Math.max(1,statTablePage-1);renderStatTable()" class="border rounded px-2 py-0.5" ' + (statTablePage <= 1 ? 'disabled' : '') + '>上一页</button>' +
    '<button onclick="statTablePage=Math.min(' + pages + ',statTablePage+1);renderStatTable()" class="border rounded px-2 py-0.5" ' + (statTablePage >= pages ? 'disabled' : '') + '>下一页</button>' +
    '<button onclick="statTablePage=' + pages + ';renderStatTable()" class="border rounded px-2 py-0.5" ' + (statTablePage >= pages ? 'disabled' : '') + '>末页</button>';
}

function exportStatCsv() {
  if (!statRows.length) return toast('暂无数据可导出', 'err');
  const rows = [['统计周期', '维度', '名称', '数量', '营业额', '快照利润', '最新核算利润']];
  statRows.forEach(function (row) {
    rows.push([row.time_label, $('statTarget').value, row.name, row.qty, row.turnover, row.profit_snapshot, row.profit_latest]);
  });
  const content = rows.map(function (r) {
    return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '经营统计.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ==================== 打印 ==================== */
const PAPER_SPECS = {
  a4: { label: 'A4 210×297', w: 210, h: 297, cls: 'paper-a4' },
  f1: { label: '一等分 241×280', w: 241, h: 280, cls: 'paper-f1' },
  f2: { label: '二等分 241×140', w: 241, h: 140, cls: 'paper-f2' },
  f3: { label: '三等分 241×93', w: 241, h: 93, cls: 'paper-f3' }
};
let currentPaper = localStorage.getItem('printPaper') || 'a4';
if (!PAPER_SPECS[currentPaper]) currentPaper = 'a4';

function applyPaper(key, remember) {
  const spec = PAPER_SPECS[key] || PAPER_SPECS.a4;
  currentPaper = key in PAPER_SPECS ? key : 'a4';
  if (remember !== false) {
    try { localStorage.setItem('printPaper', currentPaper); } catch (err) { /* ignore */ }
  }
  $('pageRule').textContent = '@page { size:' + spec.w + 'mm ' + spec.h + 'mm; margin:0; }';

  document.querySelectorAll('.paper-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.paper === currentPaper);
  });
  const hint = $('paperHint');
  if (hint) hint.textContent = spec.label;

  const sheet = $('printDom');
  if (sheet) {
    const widthPx = spec.w * 3.7795275591;
    const zoom = Math.min(1, 740 / widthPx);
    sheet.className = 'bill-doc ' + spec.cls;
    sheet.style.width = spec.w + 'mm';
    sheet.style.zoom = zoom.toFixed(3);
  }
  const area = $('printArea');
  if (area) area.className = spec.cls;
}

function onPaperChange(key) { applyPaper(key, true); }

function rmbUpper(n) {
  const cn = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const iu = ['', '拾', '佰', '仟'];
  const gu = ['', '万', '亿', '万亿'];
  n = Math.round((Number(n) || 0) * 100) / 100;
  if (n === 0) return '零元整';
  const neg = n < 0;
  n = Math.abs(n);
  const integer = Math.floor(n);
  const jiao = Math.floor(n * 10) % 10;
  const fen = Math.round(n * 100) % 10;

  let out = '';
  if (integer > 0) {
    let s = '';
    const digits = String(integer);
    const len = digits.length;
    for (let k = 0; k < len; k += 1) {
      const d = Number(digits[k]);
      const pos = len - k - 1;
      const g = Math.floor(pos / 4);
      const p = pos % 4;
      s += (d === 0 ? '零' : cn[d] + iu[p]);
      if (p === 0 && g > 0) {
        s = s.replace(/零+$/g, '');
        s += gu[g];
      }
    }
    s = s.replace(/零{2,}/g, '零')
      .replace(/零(万|亿|万亿)/g, '$1')
      .replace(/^零+/, '')
      .replace(/零+$/, '');
    out = s + '元';
  }
  if (jiao === 0 && fen === 0) {
    out += '整';
  } else {
    if (jiao > 0) out += cn[jiao] + '角';
    else if (integer > 0) out += '零';
    if (fen > 0) out += cn[fen] + '分';
  }
  return (neg ? '负' : '') + out;
}

async function printSellBill() {
  if (printSaving) return;
  printSaving = true;
  try {
    // 打印前自动保存：新单未点“保存单据”也先入库，避免打印后清空导致单据丢失
    if (!(editingOrderId && isOrderLocked())) {
      const saved = await saveSellOrder({ keepPage: true, silent: true, silentUI: true, allowWalkIn: true });
      if (!saved || typeof saved !== 'object') return;
    }
  } finally {
    printSaving = false;
  }
  const validRows = sellRows.filter(function (row) {
    return row.pid && Number(row.qty) > 0 && Number(row.price) > 0;
  });
  if (!validRows.length) return toast('没有可打印的有效商品行', 'err');
  auditOrder('print_attempt', {
    detail: {
      order_no: $('sellOrderNo').value,
      customer_name: $('sellCustomerInput').value || '散客',
      paper: currentPaper,
      all_rows: auditRowsSnapshot(),
      print_rows: validRows.map(function (row) {
        return auditRowSnapshot(row, sellRows.indexOf(row));
      })
    }
  });
  await flushOrderAudit();

  const voidMark = $('printVoidMark');
  if (voidMark) voidMark.classList.toggle('hidden', !(editingOrder && Number(editingOrder.is_void) === 1));

  const printTbody = $('print_tbody');
  printTbody.innerHTML = validRows.map(function (row) {
    return '<tr>' +
      '<td>' + esc(row.pid) + '</td>' +
      '<td>' + esc(row.pname) + '</td>' +
      '<td>' + esc(row.hideSpec ? '' : displaySpec(row)) + '</td>' +
      '<td>' + esc(row.unit) + '</td>' +
      '<td>' + esc(row.qty) + '</td>' +
      '<td>' + money(row.price) + '</td>' +
      '<td>' + money(row.amount) + '</td>' +
      '<td>' + esc(row.makeDate) + '</td>' +
      '<td>' + esc(row.expDate) + '</td>' +
      '<td>' + esc(row.remark) + '</td>' +
      '</tr>';
  }).join('');

  const sumQty = validRows.reduce(function (sum, row) { return sum + Number(row.qty); }, 0);
  const sumAmt = validRows.reduce(function (sum, row) { return sum + Number(row.amount); }, 0);

  $('print_shopName').textContent = shopInfo.name || '中卫市源盛调味品店';
  $('print_shopAddr').textContent = shopInfo.addr || '中卫市沙坡头区文昌镇四季鲜批发市场19#S11';
  $('print_shopTel').textContent = shopInfo.tel || '13409552186';
  $('print_orderNo').textContent = $('sellOrderNo').value;
  $('print_customer').textContent = $('sellCustomerInput').value || '散客';
  $('print_custAddr').textContent = $('custAddr').value;
  $('print_custTel').textContent = $('custTel').value;
  $('print_billRemark').textContent = $('billRemark').value;
  $('print_total').textContent = money(sumAmt);
  $('print_totalUpper').textContent = rmbUpper(sumAmt);
  $('print_totalQty').textContent = Math.round(sumQty * 100) / 100;

  applyPaper(currentPaper, false);
  fillPrintArea();

  const modal = $('printPreviewModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closePrintPreview() {
  const modal = $('printPreviewModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function fillPrintArea() {
  let area = $('printArea');
  if (!area) {
    area = document.createElement('div');
    area.id = 'printArea';
    document.body.appendChild(area);
  }
  area.className = (PAPER_SPECS[currentPaper] || PAPER_SPECS.a4).cls;
  area.innerHTML = '<div class="bill-doc">' + $('printDom').innerHTML + '</div>';
  return area;
}

function desktopPaperMargins(spec) {
  if (spec.w === 241 && spec.h === 280) return { left_mm: 0, right_mm: 38, top_mm: 10, bottom_mm: 10 };
  if (spec.w === 241 && spec.h === 140) return { left_mm: 0, right_mm: 38, top_mm: 5, bottom_mm: 5 };
  if (spec.w === 241 && spec.h === 93) return { left_mm: 0, right_mm: 38, top_mm: 3, bottom_mm: 3 };
  return { left_mm: 10, right_mm: 10, top_mm: 12, bottom_mm: 12 };
}

function buildDesktopPrintJob(cfg) {
  const validRows = sellRows.filter(function (row) {
    return row.pid && Number(row.qty) > 0 && Number(row.price) > 0;
  });
  const cfgPaper = cfg && cfg.paper && Number(cfg.paper.width_mm) > 0 && Number(cfg.paper.height_mm) > 0
    ? { width_mm: Number(cfg.paper.width_mm), height_mm: Number(cfg.paper.height_mm) }
    : { width_mm: 241, height_mm: 93 };
  const paperSpec = { w: cfgPaper.width_mm, h: cfgPaper.height_mm };
  const sumQty = validRows.reduce(function (sum, row) { return sum + Number(row.qty); }, 0);
  const sumAmt = validRows.reduce(function (sum, row) { return sum + Number(row.amount); }, 0);
  const paper = { width_mm: paperSpec.w, height_mm: paperSpec.h };
  return {
    printer: (cfg && cfg.printer) || '',
    paper: paper,
    margins: (cfg && cfg.margins) || desktopPaperMargins(paperSpec),
    offset: (cfg && cfg.offset) || { x_mm: 0, y_mm: 0 },
    copies: (cfg && cfg.copies) || 1,
    font: (cfg && cfg.font) || { name: 'SimSun', size_pt: paperSpec.h < 180 ? 10.5 : 11 },
    header: {
      shop_name: shopInfo.name || '中卫市源盛调味品店',
      shop_info: (shopInfo.addr || '中卫市沙坡头区文昌镇四季鲜批发市场19#S11') +
        '  电话：' + (shopInfo.tel || '13409552186'),
      title: '销售单',
      order_no: $('sellOrderNo').value,
      date: $('sellDate').value,
      customer: $('sellCustomerInput').value || '散客',
      customer_addr: $('custAddr').value,
      customer_tel: $('custTel').value,
      customer_remark: $('billRemark').value
    },
    items: validRows.map(function (row) {
      return {
        code: row.pid,
        name: row.pname,
        spec: row.hideSpec ? '' : displaySpec(row),
        unit: row.unit,
        qty: row.qty,
        price: money(row.price),
        amount: money(row.amount),
        make_date: row.makeDate,
        exp_date: row.expDate,
        remark: row.remark
      };
    }),
    totals: {
      qty: Math.round(sumQty * 100) / 100,
      amount: money(sumAmt),
      amount_upper: rmbUpper(sumAmt)
    },
    labels: {
      code: '编码', name: '品名', spec: '规格', unit: '单位', qty: '数量',
      price: '单价', amount: '金额', make_date: '生产日期', exp_date: '保质期至', remark: '备注',
      order_no: '单号', date: '日期', customer: '客户', addr: '地址', tel: '电话',
      total_qty: '合计数量', total_amount: '合计金额', total_upper: '大写',
      sign_left: '送货单位及经手人（盖章）：', sign_right: '收货单位及经手人（盖章）：', page: '页', empty: '无商品明细'
    },
    footer: {
      sign_left: '送货单位及经手人（盖章）：',
      sign_right: '收货单位及经手人（盖章）：'
    }
  };
}

async function doPrint() {
  fillPrintArea();
  auditOrder('print_start', {
    detail: {
      order_no: $('sellOrderNo').value,
      desktop: !!(window.billingDesktop && window.billingDesktop.openPrintSettings),
      paper: currentPaper,
      all_rows: auditRowsSnapshot()
    }
  });
  await flushOrderAudit();

  if (window.billingDesktop && window.billingDesktop.openPrintSettings) {
    try {
      const result = await window.billingDesktop.getConfig();
      if (!result.ok) return toast(result.error || '读取打印设置失败', 'err');
      const job = buildDesktopPrintJob(result.config);
      const opened = await window.billingDesktop.openPrintSettings(job);
      if (!opened || opened.ok === false) return toast((opened && opened.error) || '打开打印设置失败', 'err');
      return toast('已打开打印设置，请在设置窗口点击“打印当前单据”', 'ok');
    } catch (err) {
      return toast('打印失败：' + (err.message || err), 'err');
    }
  }

  closePrintPreview();
  setTimeout(function () { window.print(); }, 60);
  setTimeout(resetSaleAfterPrint, 400);
}

/* ==================== 启动 ==================== */
function boot() {
  bindMenuClick();
  bindCustomerInput();
  if (window.billingDesktop && window.billingDesktop.onPrintCompleted) {
    window.billingDesktop.onPrintCompleted(function () {
      resetSaleAfterPrint();
    });
  }
  $('sellDate').value = todayStr();
  applyPaper(currentPaper, false);
  $('loginApiBase').value = getApiBase() || 'http://127.0.0.1:8000/api';
  if (token) {
    restoreSession();
  } else {
    const localPage = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (!localPage && /(127\.0\.0\.1|localhost)/.test($('loginApiBase').value)) {
      $('loginError').textContent = '当前页面不是本地环境，请把 API 地址改成你服务器的 HTTPS 地址';
    }
    showLogin($('loginError').textContent);
  }
}

boot();
