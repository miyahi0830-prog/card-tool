module.exports = {
  apps: [
    {
      name: 'card-tool',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: './',
      instances: 'max',        // 根据 CPU 核心数启动多个实例
      exec_mode: 'cluster',    // 集群模式
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // 日志配置
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // 自动重启配置
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      // 内存限制
      max_memory_restart: '1G',
      // 健康检查
      kill_timeout: 5000,
      listen_timeout: 10000,
    }
  ]
};
