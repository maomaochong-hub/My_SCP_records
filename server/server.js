import { config, assertConfig } from './config.js';
import { createStore } from './storage.js';
import { createServer } from './app.js';

assertConfig();

const store = await createStore();
const server = createServer(store);

server.listen(config.port, () => {
  const where = config.storageDriver === 'file' ? config.dataDir : config.storageDriver;
  console.log(`\n  S_C_P terminal  ·  http://localhost:${config.port}`);
  console.log(`  env=${config.isProd ? 'production' : 'development'}  storage=${where}  tz=${config.siteTz}\n`);
});

async function shutdown(signal) {
  console.log(`\n[${signal}] 正在保存数据…`);
  server.close();
  await store.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
