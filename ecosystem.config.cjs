module.exports = {
  apps: [
    {
      name       : 'izigsm',
      script     : 'npx',
      args       : 'wrangler pages dev dist --d1=izigsm-production --local --ip 0.0.0.0 --port 3000',
      cwd        : '/home/user/webapp',
      env        : { NODE_ENV: 'development' },
      watch      : false,
      instances  : 1,
      exec_mode  : 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000
    }
  ]
}
