module.exports = {
  apps: [{
    name: 'zenin-bot',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    
    // Auto-restart on failure
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 5000,
    
    // Don't crash on errors
    kill_timeout: 5000,
    listen_timeout: 10000,
    
    // Logs
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Environment
    env: {
      NODE_ENV: 'production',
      BOT_TOKEN: process.env.BOT_TOKEN
    },
    
    // Advanced: prevent PM2 from stopping on "clean" exit
    wait_ready: true,
    max_restarts: 10
  }]
};
