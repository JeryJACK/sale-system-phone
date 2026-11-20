/**
 * 前端运行配置。
 *
 * 本地联调：保持默认 http://127.0.0.1:8000/api
 * 线上部署：当前已改为 https://118.178.95.24/api（GitHub Pages 是 https，
 * 不能调用 http 或 127.0.0.1 接口）
 *
 * 也可以不修改本文件，直接在登录页“服务器 API 地址”里填写，
 * 地址会保存在浏览器 localStorage 中。
 */
window.APP_CONFIG = {
  API_BASE: 'https://118.178.95.24/api'
};
