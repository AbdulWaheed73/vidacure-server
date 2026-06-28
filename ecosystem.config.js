export const apps = [
  {
    name: 'vidacure-server',
    script: 'dist/server.js',
    instances: "max",
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  },
  {
    // Dedicated cron process: drip emails + nightly Mongo→S3 backup.
    // fork + instances:1 ⇒ the cron fires exactly once (no duplicate sends).
    // Does NOT open a port; shares the same MongoDB + Resend as the API.
    name: 'vidacure-scheduler',
    script: 'dist/jobs/scheduler.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: './logs/scheduler-err.log',
    out_file: './logs/scheduler-out.log',
    time: true
  }
];
