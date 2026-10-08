#!/usr/bin/env node
// Extracts the pure-logic section of applet.js and exercises it under Node,
// so the spend/history math can be tested without running Cinnamon.
'use strict';

const fs = require('fs');
const path = require('path');

const appletPath = path.join(__dirname, '..', 'deepseek-balance@njoro410', 'applet.js');
const source = fs.readFileSync(appletPath, 'utf8');

const start = source.indexOf('// ===== pure-logic:start =====');
const end = source.indexOf('// ===== pure-logic:end =====');
if (start === -1 || end === -1) {
    console.error('pure-logic markers not found in applet.js');
    process.exit(1);
}
const section = source.slice(start, end);

const load = new Function(
    section +
    '\nreturn { formatAmount, parseBalanceResponse, appendSample, pruneSamples,' +
    ' spentSince, startOfToday, clampPercent, parseHexColor, peakIconFile, PEAK_ICON_COLORS,' +
    ' isPeakTime, nextPricingChange, formatClock, formatDuration,' +
    ' updatePeak, normalizeHistory, effectiveReference };'
);
const lib = load();

let checks = 0;
let failures = 0;

function eq(actual, expected, msg) {
    checks++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        failures++;
        console.error(`FAIL ${msg}\n  expected ${e}\n  actual   ${a}`);
    }
}

const DAY = 86400;

// --- spentSince ---------------------------------------------------------
eq(lib.spentSince([{ t: 0, b: 100 }, { t: 10, b: 99 }, { t: 20, b: 98.5 }], 0), 1.5,
    'sums balance decreases');
eq(lib.spentSince([{ t: 0, b: 10 }, { t: 10, b: 15 }], 0), 0,
    'top-ups are not negative spend');
eq(lib.spentSince([{ t: 0, b: 100 }, { t: 100, b: 90 }, { t: 200, b: 85 }], 150), 5,
    'only counts changes ending inside the window');
eq(lib.spentSince([{ t: 0, b: 100 }, { t: 100, b: 90 }], 0), 10,
    'a single decrease is counted');
eq(lib.spentSince([{ t: 0, b: 100 }], 0), 0,
    'one sample means no spend yet');

// --- appendSample -------------------------------------------------------
{
    const s = [{ t: 1000, b: 50 }];
    eq(lib.appendSample(s, 1001, 50), false, 'unchanged balance within heartbeat is not appended');
    eq(s.length, 1, 'unchanged sample leaves series untouched');
    eq(lib.appendSample(s, 1001, 49.5), true, 'changed balance is appended');
    eq(s.length, 2, 'changed balance grows series');
    eq(lib.appendSample(s, 1001 + 13 * 3600, 49.5), true, 'stale series gets a heartbeat sample');
    eq(lib.appendSample([], 5, 1), true, 'first sample always appended');
}

// --- pruneSamples -------------------------------------------------------
{
    const samples = [];
    for (let d = 0; d <= 100; d++) samples.push({ t: d * DAY, b: 100 - d });
    const now = 100 * DAY;
    lib.pruneSamples(samples, now);
    const cutoff = now - 60 * DAY;
    eq(samples[0].t <= cutoff, true, 'keeps one baseline sample before the cutoff');
    eq(samples[1].t >= cutoff, true, 'drops samples older than the cutoff');
    eq(samples[samples.length - 1].t, now, 'keeps the newest sample');
}

// --- updatePeak ---------------------------------------------------------
{
    const peaks = {};
    eq(lib.updatePeak(peaks, 'USD', 10), true, 'a first balance becomes the peak');
    eq(peaks.USD, 10, 'the peak is stored per currency');
    eq(lib.updatePeak(peaks, 'USD', 9.5), false, 'a smaller balance leaves the peak alone');
    eq(peaks.USD, 10, 'spending never lowers the peak');
    eq(lib.updatePeak(peaks, 'USD', 17.75), true, 'a top-up raises the peak');
    eq(peaks.USD, 17.75, 'the peak takes the topped-up balance');
    eq(lib.updatePeak(peaks, 'USD', 17.75), false, 'an unchanged balance does not dirty the file');
    eq(lib.updatePeak(peaks, 'CNY', 3), true, 'currencies keep separate peaks');
    eq(lib.updatePeak(peaks, 'USD', 0), false, 'a zero balance does not become a peak');
}

// --- normalizeHistory ---------------------------------------------------
{
    const legacy = { CNY: [{ t: 1000, b: 42.5 }, { t: 2000, b: 41 }] };
    eq(lib.normalizeHistory(legacy), { CNY: legacy.CNY, _peaks: { CNY: 42.5 } },
        'a file without _peaks gets the highest sample as its peak');
    eq(lib.normalizeHistory({ USD: [{ t: 1, b: 5 }], _peaks: { USD: 99 } })._peaks, { USD: 99 },
        'a stored peak survives even when no sample reaches it (pruned top-up)');
    eq(lib.normalizeHistory({ USD: [{ t: 1, b: 5 }], _peaks: { USD: 2 } })._peaks, { USD: 5 },
        'a stale stored peak is raised to the highest sample');
    eq(lib.normalizeHistory({ _peaks: null })._peaks, {}, 'a broken _peaks value is replaced by an empty map');
    eq(lib.normalizeHistory({ USD: 'junk', _peaks: { USD: 4 } })._peaks, { USD: 4 },
        'a non-array currency entry is ignored');
    eq(lib.normalizeHistory(null), { _peaks: {} }, 'null yields an empty history');
    eq(lib.normalizeHistory({ USD: [{ t: 1, b: 5 }], _peaks: {} }), { USD: [{ t: 1, b: 5 }], _peaks: { USD: 5 } },
        'an empty _peaks map is filled from the samples');
}

// --- effectiveReference -------------------------------------------------
eq(lib.effectiveReference(0, 17.75), 17.75, 'with no configured amount the peak is the reference');
eq(lib.effectiveReference(10, 17.75), 10, 'a configured amount wins over the peak');
eq(lib.effectiveReference('10', 17.75), 10, 'a string amount from the settings JSON is parsed');
eq(lib.effectiveReference(0, 0), 0, 'no amount and no peak leaves the reference unknown');
eq(lib.effectiveReference(-5, 4), 4, 'a negative amount falls back to the peak');
eq(lib.effectiveReference(NaN, 4), 4, 'a malformed amount falls back to the peak');

// --- parseBalanceResponse ----------------------------------------------
const apiResponse = {
    is_available: true,
    balance_infos: [
        { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
        { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
    ],
};
eq(lib.parseBalanceResponse(apiResponse, 'USD').currency, 'USD', 'honours the preferred currency');
eq(lib.parseBalanceResponse(apiResponse, 'USD').total, 0, 'preferred currency keeps its zero balance');
eq(lib.parseBalanceResponse(apiResponse, 'auto').currency, 'CNY', 'auto prefers a non-zero balance');
eq(lib.parseBalanceResponse(apiResponse, 'auto').toppedUp, 100, 'parses topped-up balance');
eq(lib.parseBalanceResponse(apiResponse, 'EUR').currency, 'CNY', 'falls back when preferred currency is absent');
eq(lib.parseBalanceResponse({ is_available: false, balance_infos: [
    { currency: 'CNY', total_balance: '0.00' },
] }, 'auto').available, false, 'is_available false is preserved');
eq(lib.parseBalanceResponse({ balance_infos: [
    { currency: 'CNY', total_balance: '5' },
] }, 'auto').granted, 0, 'missing granted balance becomes 0');
eq(lib.parseBalanceResponse(null, 'auto'), null, 'null payload rejected');
eq(lib.parseBalanceResponse({}, 'auto'), null, 'payload without balance_infos rejected');
eq(lib.parseBalanceResponse({ balance_infos: [] }, 'auto'), null, 'empty balance_infos rejected');

// --- startOfToday -------------------------------------------------------
{
    const ts = new Date(2026, 5, 15, 13, 45, 30).getTime() / 1000;
    const expected = Math.floor(new Date(2026, 5, 15).getTime() / 1000);
    eq(lib.startOfToday(ts), expected, 'startOfToday returns local midnight');
}

// --- formatting / clamping ---------------------------------------------
eq(lib.formatAmount(72.4, 'CNY'), '¥72.40', 'CNY formats with symbol and 2 decimals');
eq(lib.formatAmount(5, 'USD'), '$5.00', 'USD formats with symbol');
eq(lib.formatAmount(5, 'EUR'), 'EUR 5.00', 'unknown currency falls back to the code');
eq(lib.clampPercent(-5), 0, 'clamps below 0');
eq(lib.clampPercent(150), 100, 'clamps above 100');
eq(lib.clampPercent(NaN), 0, 'NaN clamps to 0');

// --- parseHexColor ------------------------------------------------------
{
    const c = lib.parseHexColor('#4d6bfe');
    eq(c.r, 0x4d / 255, 'parses the red channel');
    eq(c.g, 0x6b / 255, 'parses the green channel');
    eq(c.b, 0xfe / 255, 'parses the blue channel');
}
eq(lib.parseHexColor('  #3584e4 '), { r: 0x35 / 255, g: 0x84 / 255, b: 0xe4 / 255 }, 'trims surrounding whitespace');
eq(lib.parseHexColor('#abc'), null, 'rejects shorthand hex');
eq(lib.parseHexColor('4d6bfe'), null, 'requires the leading #');
eq(lib.parseHexColor(null), null, 'rejects non-strings');

// --- peakIconFile -------------------------------------------------------
eq(lib.peakIconFile('#ff7800'), 'icon-peak-ff7800.svg', 'maps a palette color to its icon file');
eq(lib.peakIconFile('  #4D6BFE '), 'icon-peak-4d6bfe.svg', 'trims and lowercases before matching');
eq(lib.peakIconFile('#123456'), null, 'unknown color has no pre-rendered icon');
eq(lib.peakIconFile(null), null, 'non-strings have no icon');
{
    const appletDir = path.join(__dirname, '..', 'deepseek-balance@njoro410');
    for (const hex of lib.PEAK_ICON_COLORS) {
        const file = lib.peakIconFile(hex);
        eq(fs.existsSync(path.join(appletDir, file)), true, `shipped icon exists for ${hex}`);
    }
    eq(new Set(lib.PEAK_ICON_COLORS).size, lib.PEAK_ICON_COLORS.length, 'palette has no duplicates');
}

// --- isPeakTime ---------------------------------------------------------
// 2026-10-05 is a Monday; peak windows are 01:00–04:00 and 06:00–10:00 UTC.
const utc = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi) / 1000;
eq(lib.isPeakTime(new Date(utc(2026, 9, 5, 1, 0) * 1000)), true, 'peak starts at 01:00 UTC');
eq(lib.isPeakTime(new Date(utc(2026, 9, 5, 3, 59) * 1000)), true, 'still peak at 03:59 UTC');
eq(lib.isPeakTime(new Date(utc(2026, 9, 5, 4, 0) * 1000)), false, 'peak ends at 04:00 UTC');
eq(lib.isPeakTime(new Date(utc(2026, 9, 5, 5, 0) * 1000)), false, 'the gap between windows is off-peak');
eq(lib.isPeakTime(new Date(utc(2026, 9, 5, 6, 0) * 1000)), true, 'second window starts at 06:00 UTC');
eq(lib.isPeakTime(new Date(utc(2026, 9, 5, 10, 0) * 1000)), false, 'second window ends at 10:00 UTC');
eq(lib.isPeakTime(new Date(utc(2026, 9, 5, 12, 0) * 1000)), false, 'weekday midday UTC is off-peak');
eq(lib.isPeakTime(new Date(utc(2026, 9, 3, 2, 0) * 1000)), false, 'Saturday is always off-peak');
eq(lib.isPeakTime(new Date(utc(2026, 9, 4, 2, 0) * 1000)), false, 'Sunday is always off-peak');
eq(lib.isPeakTime(new Date(utc(2026, 9, 9, 2, 0) * 1000)), true, 'Friday is a peak day');

// --- nextPricingChange --------------------------------------------------
{
    const n = lib.nextPricingChange(new Date(utc(2026, 9, 5, 2, 0) * 1000));
    eq(n.t, utc(2026, 9, 5, 4, 0), 'mid-peak: next switch ends the window at 04:00 UTC');
    eq(n.peak, false, 'mid-peak: next switch leaves peak');
}
{
    const n = lib.nextPricingChange(new Date(utc(2026, 9, 5, 5, 0) * 1000));
    eq(n.t, utc(2026, 9, 5, 6, 0), 'between windows: next switch starts peak');
    eq(n.peak, true, 'between windows: next switch enters peak');
}
{
    const n = lib.nextPricingChange(new Date(utc(2026, 9, 5, 0, 30) * 1000));
    eq(n.t, utc(2026, 9, 5, 1, 0), 'before peak: next switch is the 01:00 UTC start');
}
{
    const n = lib.nextPricingChange(new Date(utc(2026, 9, 9, 11, 0) * 1000));
    eq(n.t, utc(2026, 9, 12, 1, 0), 'after Friday peak: resumes Monday 01:00 UTC');
    eq(n.peak, true, 'after Friday peak: next switch enters peak');
}
{
    const now = utc(2026, 9, 5, 3, 59);
    eq(lib.nextPricingChange(new Date(now * 1000)).t - now, 60, 'one minute before a window end');
}

// --- formatClock --------------------------------------------------------
{
    const d = new Date(utc(2026, 9, 5, 14, 30) * 1000);
    const same = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    eq(lib.formatClock(d.getTime() / 1000, new Date(d.getTime())), same, 'same local day: plain clock');
    const later = new Date(d.getTime() + 2 * 86400000);
    const prefix = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][later.getDay()] + ' ';
    eq(lib.formatClock(later.getTime() / 1000, d).startsWith(prefix), true, 'other local day: weekday prefix');
}

// --- formatDuration -----------------------------------------------------
eq(lib.formatDuration(45), '1m', 'under a minute shows 1m');
eq(lib.formatDuration(90), '2m', 'sub-hour rounds to minutes');
eq(lib.formatDuration(3600), '1h', 'whole hours');
eq(lib.formatDuration(3600 + 23 * 60), '1h 23m', 'hours and minutes');
eq(lib.formatDuration(2 * 86400 + 5 * 3600), '2d 5h', 'days and hours');
eq(lib.formatDuration(2 * 86400 + 86340), '3d', 'hours rounding to 24 rolls the day');

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures > 0 ? 1 : 0);
