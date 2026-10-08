#!/usr/bin/env cjs
// Drives the asynchronous history read/write helpers of applet.js under
// Cinnamon's own JS engine (cjs), with the XDG dirs pointed at a scratch
// directory so the real history file is never touched.
//
//   cjs test/history-io-test.js

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const System = imports.system;

const UUID = 'deepseek-balance@njoro410';

// Point GLib's user dirs at a scratch location before anything asks for them.
const scratch = GLib.dir_make_tmp('dsb-history-XXXXXX');
GLib.setenv('XDG_STATE_HOME', GLib.build_filenamev([scratch, 'state']), true);
GLib.setenv('XDG_CONFIG_HOME', GLib.build_filenamev([scratch, 'config']), true);

const scriptDir = GLib.path_get_dirname(GLib.canonicalize_filename(
    System.programInvocationName, GLib.get_current_dir()));
const appletPath = GLib.build_filenamev([scriptDir, '..', UUID, 'applet.js']);

const [okRead, rawSource] = GLib.file_get_contents(appletPath);
if (!okRead) {
    print('could not read ' + appletPath);
    System.exit(1);
}
const source = new TextDecoder().decode(rawSource);

function slice(startMarker, endMarker) {
    const a = source.indexOf(startMarker);
    const b = source.indexOf(endMarker);
    if (a === -1 || b === -1) {
        print('marker not found: ' + startMarker);
        System.exit(1);
    }
    return source.slice(a + startMarker.length, b);
}

// The HISTORY_* constants, taken from applet.js verbatim so the test notices
// if they ever change.
function constantsBlock() {
    const lines = source.split('\n');
    const first = lines.findIndex(line => line.startsWith('const HISTORY_DIR'));
    if (first === -1) {
        print('HISTORY_DIR constant not found in applet.js');
        System.exit(1);
    }
    let last = first;
    while (last + 1 < lines.length && lines[last + 1].trim() !== '') last++;
    return lines.slice(first, last + 1).join('\n');
}

const shim = { log: print, logWarning: print };

const paths = new Function('GLib', 'UUID',
    constantsBlock() + '\nreturn { HISTORY_DIR, HISTORY_PATH, LEGACY_HISTORY_PATH };'
)(GLib, UUID);

if (paths.HISTORY_PATH.indexOf(scratch) !== 0) {
    print('scratch XDG dirs are not in effect: ' + paths.HISTORY_PATH);
    System.exit(1);
}

const io = new Function('GLib', 'Gio', 'UUID', 'global', 'TextDecoder',
    slice('// ===== history-io:start =====', '// ===== history-io:end =====') +
    '\nreturn { readJsonFile, writeJsonFile };'
)(GLib, Gio, UUID, shim, TextDecoder);

// _loadHistory repairs what it reads, so it needs the pure-logic helpers.
const pure = new Function(
    slice('// ===== pure-logic:start =====', '// ===== pure-logic:end =====') +
    '\nreturn { normalizeHistory };'
)();

const methods = new Function(
    'readJsonFile', 'writeJsonFile', 'normalizeHistory',
    'HISTORY_PATH', 'HISTORY_DIR', 'LEGACY_HISTORY_PATH',
    'return {' +
    slice('// ===== history-io-methods:start =====', '// ===== history-io-methods:end =====') +
    '};'
)(io.readJsonFile, io.writeJsonFile, pure.normalizeHistory,
  paths.HISTORY_PATH, paths.HISTORY_DIR, paths.LEGACY_HISTORY_PATH);

let checks = 0;
let failures = 0;

function check(cond, msg) {
    checks++;
    if (!cond) {
        failures++;
        print('FAIL ' + msg);
    }
}

function eq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    check(a === e, msg + ' — expected ' + e + ', got ' + a);
}

function makeApplet() {
    const applet = Object.create(methods);
    applet._history = { _peaks: {} };
    applet._saveState = { inFlight: false, pending: null, dirReady: false };
    return applet;
}

function readJson(filePath) {
    try {
        const [ok, contents] = GLib.file_get_contents(filePath);
        return ok ? JSON.parse(new TextDecoder().decode(contents)) : null;
    } catch (e) {
        return null;
    }
}

// Runs one async step; done() ends it, a 10 s deadline fails it.
function runAsync(work) {
    const loop = new GLib.MainLoop(null, false);
    let finished = false;
    const deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
        checks++;
        failures++;
        print('FAIL step timed out');
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    work(() => {
        if (finished) return;
        finished = true;
        GLib.source_remove(deadline);
        loop.quit();
    });
    if (!finished) loop.run();
}

function waitUntil(cond, done) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
        if (!cond()) return GLib.SOURCE_CONTINUE;
        done();
        return GLib.SOURCE_REMOVE;
    });
}

const steps = [];

// --- a missing file loads as an empty history ---------------------------
steps.push(done => {
    const applet = makeApplet();
    applet._loadHistory(() => {
        eq(applet._history, { _peaks: {} }, 'missing history file yields an empty history');
        done();
    });
});

// --- a pre-release history in the config dir is migrated ----------------
const legacyData = { CNY: [{ t: 1000, b: 42.5 }, { t: 2000, b: 41 }] };
const legacyExpected = { CNY: legacyData.CNY, _peaks: { CNY: 42.5 } };
steps.push(done => {
    GLib.mkdir_with_parents(GLib.path_get_dirname(paths.LEGACY_HISTORY_PATH), 0o700);
    GLib.file_set_contents(paths.LEGACY_HISTORY_PATH, JSON.stringify(legacyData));
    const applet = makeApplet();
    applet._loadHistory(() => {
        eq(applet._history, legacyExpected, 'legacy history is loaded with its peak derived from the samples');
        waitUntil(() => readJson(paths.HISTORY_PATH) !== null, () => {
            eq(readJson(paths.HISTORY_PATH), legacyExpected, 'legacy history is copied to the state dir');
            check(GLib.file_test(paths.LEGACY_HISTORY_PATH, GLib.FileTest.EXISTS),
                'the legacy file is left in place');
            done();
        });
    });
});

// --- saving writes the history JSON -------------------------------------
const savedData = { USD: [{ t: 10, b: 7.25 }], CNY: [{ t: 20, b: 3 }], _peaks: { USD: 12, CNY: 3 } };
steps.push(done => {
    const applet = makeApplet();
    applet._history = savedData;
    applet._saveHistory();
    waitUntil(() => JSON.stringify(readJson(paths.HISTORY_PATH)) === JSON.stringify(savedData), () => {
        eq(readJson(paths.HISTORY_PATH), savedData, 'save writes the history JSON');
        done();
    });
});

// --- overlapping saves coalesce to the latest data ----------------------
steps.push(done => {
    const applet = makeApplet();
    applet._history = { CNY: [{ t: 1, b: 1 }] };
    applet._saveHistory();
    applet._history = { CNY: [{ t: 2, b: 2 }] };
    applet._saveHistory();
    waitUntil(() => {
        const data = readJson(paths.HISTORY_PATH);
        return data && data.CNY && data.CNY[0].b === 2;
    }, () => {
        eq(applet._saveState.inFlight, false, 'write chain has finished');
        eq(applet._saveState.pending, null, 'nothing is left queued');
        done();
    });
});

// --- an unparseable file is treated as empty ----------------------------
steps.push(done => {
    Gio.File.new_for_path(paths.LEGACY_HISTORY_PATH).delete(null);
    GLib.file_set_contents(paths.HISTORY_PATH, '{not json');
    const applet = makeApplet();
    applet._loadHistory(() => {
        eq(applet._history, { _peaks: {} }, 'corrupt history yields an empty history');
        done();
    });
});

// --- a file written before _peaks existed gains one on load -------------
steps.push(done => {
    GLib.file_set_contents(paths.HISTORY_PATH,
        JSON.stringify({ USD: [{ t: 1, b: 5 }, { t: 2, b: 17.75 }, { t: 3, b: 17.5 }] }));
    const applet = makeApplet();
    applet._loadHistory(() => {
        eq(applet._history._peaks, { USD: 17.75 },
            'the peak is derived from the samples of a file without _peaks');
        done();
    });
});

// --- a stored peak is not lowered by the samples ------------------------
// (the top-up sample that raised it may already have been pruned)
steps.push(done => {
    GLib.file_set_contents(paths.HISTORY_PATH,
        JSON.stringify({ USD: [{ t: 1, b: 5 }], _peaks: { USD: 99 } }));
    const applet = makeApplet();
    applet._loadHistory(() => {
        eq(applet._history._peaks, { USD: 99 }, 'a stored peak is kept even when no sample reaches it');
        done();
    });
});

for (const step of steps) {
    runAsync(step);
}

function removeRecursively(file) {
    let children = [];
    try {
        const iter = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = iter.next_file(null)) !== null) {
            children.push(file.get_child(info.get_name()));
        }
        iter.close(null);
    } catch (e) { /* not a directory */ }
    for (const child of children) removeRecursively(child);
    try {
        file.delete(null);
    } catch (e) { /* already gone */ }
}

removeRecursively(Gio.File.new_for_path(scratch));

print((checks - failures) + '/' + checks + ' checks passed');
System.exit(failures > 0 ? 1 : 0);
