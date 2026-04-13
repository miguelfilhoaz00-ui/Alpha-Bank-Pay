module.exports = {
  apps: [
    {
      name:             'copypix-bot',
      script:           'server.js',
      instances:        1,
      autorestart:      true,        // reinicia APENAS se crashar
      watch:            false,       // não reinicia ao detectar mudança de arquivo
      max_memory_restart: '400M',    // reinicia se ultrapassar 400MB de RAM
      restart_delay:    3000,        // aguarda 3s antes de reiniciar após crash
      max_restarts:     10,          // limite de tentativas de restart consecutivos
      min_uptime:       '10s',       // considera estável se ficar 10s no ar

      env: {
        NODE_ENV: 'production',
        PORT:     3000
      },

      // Logs
      out_file:    './logs/out.log',
      error_file:  './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:  true
    }
  ]
};
