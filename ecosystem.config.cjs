module.exports = {
  apps: [
    {
      name       : 'izigsm',
      script     : 'node',
      args       : 'server.mjs',
      cwd        : '/home/user/webapp',
      env        : { NODE_ENV: 'development' },
      watch      : false,
      instances  : 1,
      exec_mode  : 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000
    }
  ]
}
