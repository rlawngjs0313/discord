require('dotenv/config');
const { makeWorkerUtils } = require('graphile-worker');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

async function deploy() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required.');
    const worker = await makeWorkerUtils({ connectionString });
    try { await worker.migrate(); }
    finally { await worker.release(); }
    execFileSync(process.execPath, [
        path.join(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy',
    ], { stdio: 'inherit' });
}

deploy().catch(() => {
    console.error('Database migration failed.');
    process.exitCode = 1;
});
