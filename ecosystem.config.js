// PM2 生产环境配置（高可用版）
module.exports = {
  apps: [{
    name: 'tank-battle',
    script: 'server.js',
    cwd: __dirname,

    // 进程
    instances: 1,
    exec_mode: 'fork',
    watch: false,

    // 崩溃自动重启
    max_restarts: 20,          // 20次/窗口内
    restart_delay: 1000,       // 1秒后重启
    min_uptime: '10s',         // 运行10秒以上才算正常启动
    max_memory_restart: '300M',// 内存超300M自动重启

    // 环境
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },

    // 日志（自动轮转）
    log_date_format: 'MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    max_size: '10M',           // 单文件10MB轮转

    // 退出
    kill_timeout: 5000,        // 5秒优雅退出
    listen_timeout: 3000,
  }]
};
