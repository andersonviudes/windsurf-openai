import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defaultLsBinaryPath } from '../../src/core/config.js';
import { defaultLsDataRoot } from '../../src/language-server/langserver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL_LS = readFileSync(join(__dirname, '..', '..', 'install-ls.sh'), 'utf8');

describe('platform-specific language server paths', () => {
  test('runtime defaults match install-ls.sh defaults', () => {
    assert.equal(
      defaultLsBinaryPath('darwin', 'arm64', '/Users/alice'),
      '/Users/alice/.windsurf/language_server_macos_arm'
    );
    assert.equal(
      defaultLsBinaryPath('darwin', 'x64', '/Users/alice'),
      '/Users/alice/.windsurf/language_server_macos_x64'
    );
    assert.equal(
      defaultLsBinaryPath('linux', 'x64', '/home/alice'),
      '/opt/windsurf/language_server_linux_x64'
    );
    assert.equal(
      defaultLsBinaryPath('linux', 'arm64', '/home/alice'),
      '/opt/windsurf/language_server_linux_arm'
    );

    assert.match(INSTALL_LS, /DEFAULT_PATH="\$HOME\/\.windsurf\/\$\{ASSET\}"/);
    assert.match(INSTALL_LS, /DEFAULT_PATH="\/opt\/windsurf\/\$\{ASSET\}"/);
  });

  test('macOS language server data defaults to a user-writable directory', () => {
    assert.equal(defaultLsDataRoot('darwin', '/Users/alice'), '/Users/alice/.windsurf/data');
    assert.equal(defaultLsDataRoot('linux', '/home/alice'), '/opt/windsurf/data');
  });

  test('install-ls.sh defaults to the maintained public Windsurf LS mirror', () => {
    assert.match(
      INSTALL_LS,
      /dwgx\/windsurf-ls-release/,
      'install-ls.sh should default to the maintained public Windsurf LS release mirror'
    );
    assert.doesNotMatch(
      INSTALL_LS,
      /CaiJingLong\/windsurf-linux-server-release/,
      'install-ls.sh must not default to the stale third-party mirror'
    );
    assert.match(
      INSTALL_LS,
      /WINDSURFAPI_LS_RELEASE/,
      'install-ls.sh should allow operators to override the LS release mirror/source'
    );
    assert.match(
      INSTALL_LS,
      /Trying maintained Windsurf LS mirror: \$ws_url/,
      'install-ls.sh should print the fallback URL so large macOS downloads do not look hung'
    );
    assert.match(
      INSTALL_LS,
      /verify_release_asset_checksum "\$WINDSURF_LS_RELEASE" "\$ASSET" "\$TMP_TARGET"/,
      'downloads from the maintained mirror should be checked against SHA256SUMS when available'
    );
    assert.match(
      INSTALL_LS,
      /SHA256SUMS not available; skipping mirror checksum verification/,
      'custom or older mirrors without SHA256SUMS should remain usable'
    );
  });
});
