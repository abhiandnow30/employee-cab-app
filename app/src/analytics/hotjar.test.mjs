// ---------------------------------------------------------------------------
// Tests for the Hotjar module.  Run with:  npm --prefix app run test:analytics
//
// WHY THIS ISN'T A JEST TEST. This repo has no test runner (see CLAUDE.md), and
// the obvious one does not currently install: jest-expo@57 requires
// @react-native/jest-preset ^0.86.2 while react-native@0.86.0 pins 0.86.0
// exactly, so adding it means overriding peer resolution — and `npm ci` is the
// fail-fast gate the production deploy depends on. Not worth risking that to
// test two files.
//
// So this runs on bare Node with no dependencies at all. It loads the REAL
// source of runtimeConfig.js and hotjar.js — no reimplementation, no second copy
// of the logic — by writing them to a temp directory as .mjs with the one
// extensionless relative import rewritten, which is the only thing stopping Node
// from importing them as they are (Metro resolves extensions; Node's ESM loader
// does not). Each case imports with a fresh ?case= query so the module-level
// HOTJAR_SITE_ID is re-evaluated against whatever window/env state that case has
// just set up.
//
// If a real runner is ever added, the assertions below port over unchanged.
// ---------------------------------------------------------------------------

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'hotjar-test-'));

const HOTJAR_SRC = readFileSync('src/analytics/hotjar.js', 'utf8');
writeFileSync(join(dir, 'runtimeConfig.mjs'), readFileSync('src/config/runtimeConfig.js', 'utf8'));

let caseId = 0;

// BOTH modules have to be re-evaluated per case, not just hotjar.mjs.
// HOTJAR_SITE_ID is resolved once at runtimeConfig's module scope, so a cached
// copy of it would freeze the first case's window/env state into every case that
// follows. Giving each case its own hotjarN.mjs, whose import of runtimeConfig
// carries the same ?case= query, makes Node treat them as distinct modules and
// evaluate the resolver again.
function loadModule() {
  const n = ++caseId;
  const file = join(dir, 'hotjar' + n + '.mjs');
  writeFileSync(
    file,
    HOTJAR_SRC.replace(
      "from '../config/runtimeConfig'",
      "from './runtimeConfig.mjs?case=" + n + "'"
    )
  );
  return import(pathToFileURL(file).href);
}

// --- The smallest DOM the module actually touches ---------------------------
function fakeDom() {
  const scripts = [];
  globalThis.document = {
    head: { appendChild: (el) => scripts.push(el) },
    getElementById: (id) => scripts.find((s) => s.id === id) || null,
    createElement: () => ({ id: '', async: false, src: '' }),
  };
  globalThis.window = {};
  return scripts;
}

// Native: React Native defines a global window but never a document.
function noDom() {
  delete globalThis.document;
  globalThis.window = {};
}

function reset() {
  delete globalThis.window;
  delete globalThis.document;
  delete process.env.EXPO_PUBLIC_HOTJAR_SITE_ID;
}

const warnings = [];
const realWarn = console.warn;

let passed = 0;
const failures = [];

async function test(name, fn) {
  reset();
  warnings.length = 0;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await fn();
    passed++;
    console.warn = realWarn;
    realWarn('  ok   ' + name);
  } catch (err) {
    failures.push(name);
    console.warn = realWarn;
    realWarn('  FAIL ' + name);
    realWarn('       ' + err.message);
  }
}

realWarn('');
realWarn('initHotjar');
realWarn('');

await test('no site ID anywhere: does nothing, requests no script', async () => {
  const scripts = fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '' };
  const { initHotjar, isHotjarEnabled } = await loadModule();
  assert.equal(isHotjarEnabled(), false);
  assert.equal(initHotjar(), false);
  assert.equal(scripts.length, 0);
  assert.equal(globalThis.window._hjSettings, undefined);
});

await test('missing __APP_CONFIG__ entirely is the same as blank', async () => {
  const scripts = fakeDom();
  const { initHotjar } = await loadModule();
  assert.equal(initHotjar(), false);
  assert.equal(scripts.length, 0);
});

await test('runtime site ID: injects once, numeric hjid, correct src', async () => {
  const scripts = fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar } = await loadModule();
  assert.equal(initHotjar(), true);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].id, 'hotjar-snippet');
  assert.equal(scripts[0].src, 'https://static.hotjar.com/c/hotjar-3847291.js?sv=6');
  // Number, not string — the remote script reads this value back.
  assert.equal(globalThis.window._hjSettings.hjid, 3847291);
  assert.equal(typeof globalThis.window._hjSettings.hjid, 'number');
  assert.equal(globalThis.window._hjSettings.hjsv, 6);
  // The call queue has to exist before the remote script loads.
  assert.equal(typeof globalThis.window.hj, 'function');
  // Idempotent: a second call must not add a second snippet.
  assert.equal(initHotjar(), false);
  assert.equal(scripts.length, 1);
});

await test('queued calls survive until the remote script loads', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar } = await loadModule();
  initHotjar();
  globalThis.window.hj('identify', 'u1', { role: 'admin' });
  assert.equal(globalThis.window.hj.q.length, 1);
  assert.equal(globalThis.window.hj.q[0][0], 'identify');
});

await test('non-numeric site ID: refused, warns, stays off', async () => {
  const scripts = fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: 'site-1234' };
  const { initHotjar } = await loadModule();
  assert.equal(initHotjar(), false);
  assert.equal(scripts.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /digits only/);
});

await test('unsubstituted __PLACEHOLDER__ falls through to the build-time value', async () => {
  const scripts = fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '__HOTJAR_SITE_ID__' };
  process.env.EXPO_PUBLIC_HOTJAR_SITE_ID = '5550001';
  const { initHotjar } = await loadModule();
  assert.equal(initHotjar(), true);
  assert.equal(scripts[0].src, 'https://static.hotjar.com/c/hotjar-5550001.js?sv=6');
});

await test('runtime value wins over the build-time value', async () => {
  const scripts = fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '7770002' };
  process.env.EXPO_PUBLIC_HOTJAR_SITE_ID = '5550001';
  const { initHotjar } = await loadModule();
  assert.equal(initHotjar(), true);
  assert.equal(scripts[0].src, 'https://static.hotjar.com/c/hotjar-7770002.js?sv=6');
});

await test('blank runtime value does NOT switch off a baked-in ID', async () => {
  // The documented asymmetry — see src/config/runtimeConfig.js.
  const scripts = fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '' };
  process.env.EXPO_PUBLIC_HOTJAR_SITE_ID = '5550001';
  const { initHotjar } = await loadModule();
  assert.equal(initHotjar(), true);
  assert.equal(scripts[0].src, 'https://static.hotjar.com/c/hotjar-5550001.js?sv=6');
});

await test('whitespace-only value is treated as unset', async () => {
  const scripts = fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '   ' };
  const { initHotjar } = await loadModule();
  assert.equal(initHotjar(), false);
  assert.equal(scripts.length, 0);
});

await test('native (no document): no-op even with an ID configured', async () => {
  noDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar, isHotjarEnabled } = await loadModule();
  // The ID is readable, but there is nothing to instrument.
  assert.equal(isHotjarEnabled(), true);
  assert.equal(initHotjar(), false);
});

realWarn('');
realWarn('identifyHotjarUser');
realWarn('');

await test('identifies by uid, never by email', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar, identifyHotjarUser } = await loadModule();
  initHotjar();
  const calls = [];
  globalThis.window.hj = (...args) => calls.push(args);
  assert.equal(
    identifyHotjarUser({ uid: 'abc123', email: 'Jane.Doe@example.com', role: 'admin' }),
    true
  );
  assert.deepEqual(calls[0], [
    'identify',
    'abc123',
    { role: 'admin', email: 'jane.doe@example.com' },
  ]);
});

await test("drops a synthesized .invalid address (it is a driver's phone number)", async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar, identifyHotjarUser } = await loadModule();
  initHotjar();
  const calls = [];
  globalThis.window.hj = (...args) => calls.push(args);
  identifyHotjarUser({ uid: 'drv1', email: 'd9263565755@driver.cab.invalid', role: 'driver' });
  assert.deepEqual(calls[0], ['identify', 'drv1', { role: 'driver' }]);
  assert.equal('email' in calls[0][2], false);
});

await test('drops a coordinator .invalid address too', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar, identifyHotjarUser } = await loadModule();
  initHotjar();
  const calls = [];
  globalThis.window.hj = (...args) => calls.push(args);
  identifyHotjarUser({ uid: 'co1', email: 'c9848094029@coordinator.cab.invalid', role: 'coordinator' });
  assert.equal('email' in calls[0][2], false);
});

await test('falls back to id when uid is absent', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar, identifyHotjarUser } = await loadModule();
  initHotjar();
  const calls = [];
  globalThis.window.hj = (...args) => calls.push(args);
  identifyHotjarUser({ id: 'legacy1', role: 'employee', email: 'a@corp.com' });
  assert.equal(calls[0][1], 'legacy1');
});

await test('missing role becomes UNKNOWN rather than absent', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar, identifyHotjarUser } = await loadModule();
  initHotjar();
  const calls = [];
  globalThis.window.hj = (...args) => calls.push(args);
  identifyHotjarUser({ uid: 'u1' });
  assert.equal(calls[0][2].role, 'UNKNOWN');
});

await test('flags a self-provisioned rider', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar, identifyHotjarUser } = await loadModule();
  initHotjar();
  const calls = [];
  globalThis.window.hj = (...args) => calls.push(args);
  identifyHotjarUser({ uid: 'u9', email: 'new@corp.com', role: 'employee', selfProvisioned: true });
  assert.equal(calls[0][2].selfProvisioned, true);
});

await test('no uid: nothing sent', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { initHotjar, identifyHotjarUser } = await loadModule();
  initHotjar();
  globalThis.window.hj = () => assert.fail('must not be called');
  assert.equal(identifyHotjarUser({ email: 'a@b.com' }), false);
  assert.equal(identifyHotjarUser(null), false);
  assert.equal(identifyHotjarUser(undefined), false);
});

await test('disabled: identify is a no-op', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '' };
  const { identifyHotjarUser } = await loadModule();
  globalThis.window.hj = () => assert.fail('must not be called');
  assert.equal(identifyHotjarUser({ uid: 'x', role: 'admin' }), false);
});

await test('enabled but snippet not yet injected: no throw, no send', async () => {
  fakeDom();
  globalThis.window.__APP_CONFIG__ = { hotjarSiteId: '3847291' };
  const { identifyHotjarUser } = await loadModule();
  // initHotjar deliberately not called, so window.hj does not exist.
  assert.equal(identifyHotjarUser({ uid: 'x', role: 'admin' }), false);
});

realWarn('');
realWarn('HJ_SUPPRESS');
realWarn('');

await test('is the react-native-web dataSet shape', async () => {
  fakeDom();
  const { HJ_SUPPRESS } = await loadModule();
  assert.deepEqual(HJ_SUPPRESS, { dataSet: { hjSuppress: 'true' } });
});

console.warn = realWarn;
realWarn('');
realWarn(passed + ' passed, ' + failures.length + ' failed');
realWarn('');
if (failures.length) process.exit(1);
