import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.WINDSURFAPI_SKIP_DOTENV = '1';

const keepDataDir = process.env.WINDSURFAPI_TEST_KEEP_DATA_DIR === '1';
const requestedDataDir = process.env.WINDSURFAPI_TEST_DATA_DIR;
const dataDir = requestedDataDir || mkdtempSync(join(tmpdir(), 'windsurfapi-test-'));

process.env.DATA_DIR = dataDir;

if (!requestedDataDir && !keepDataDir) {
  process.once('exit', () => {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  });
}
