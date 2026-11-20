/** Tailwind 构建配置：修改页面后重新执行 tools/build_frontend.ps1 */
module.exports = {
  content: ['./index.html', './app.js'],
  theme: {
    extend: {
      colors: {
        sideBg: '#222d38',
        primaryBlue: '#2488c8',
        tableHeader: '#348eda'
      }
    }
  }
};
