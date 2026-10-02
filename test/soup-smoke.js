// Smoke test for the networking path, run with Cinnamon's own JS engine:
//     cjs -I . test/soup-smoke.js
// It sends a real request to the balance endpoint with an invalid key and
// expects HTTP 401 — proving URL, headers, libsoup3 calls and status handling
// all work on this machine. Exit code 0 means the pipeline is sound.
'use strict';

imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;

let failed = false;

// Informational only: St is Cinnamon's private typelib and may not be on the
// default search path when cjs runs outside a Cinnamon session. Inside
// Cinnamon, imports.gi.St is always available to applets.
try {
    const St = imports.gi.St;
    print('St.DrawingArea available: ' + (typeof St.DrawingArea === 'function'));
} catch (e) {
    print('note: St not loadable from bare cjs (' + e.message + ')');
}

const session = new Soup.Session();
session.timeout = 30;
const message = Soup.Message.new('GET', 'https://api.deepseek.com/user/balance');
message.request_headers.append('Authorization', 'Bearer sk-invalid-smoke-test');
message.request_headers.append('Accept', 'application/json');

const loop = GLib.MainLoop.new(null, false);
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
    print('FAIL timed out waiting for a response');
    failed = true;
    loop.quit();
    return false;
});

session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
    let bytes = null;
    try {
        bytes = sess.send_and_read_finish(result);
    } catch (e) {
        print('FAIL network error: ' + e.message);
        failed = true;
        loop.quit();
        return;
    }
    const status = message.get_status();
    print('HTTP status from api.deepseek.com: ' + status);
    if (status !== 401) {
        print('FAIL expected 401 for an invalid key, got ' + status);
        failed = true;
    } else {
        print('OK: request/response pipeline works end to end');
    }
    loop.quit();
});

loop.run();
session.abort();
print(failed ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
imports.system.exit(failed ? 1 : 0);
