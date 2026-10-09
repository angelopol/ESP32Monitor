import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "esp32-calendar-test-"));
for (const name of ["stats", "outageCalendar"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(dir, `${name}.mjs`), js.replace('"./stats"', '"./stats.mjs"'));
}
after(() => rmSync(dir, { recursive: true, force: true }));
const { calendarDay, nextDate } = await import(pathToFileURL(join(dir, "outageCalendar.mjs")));
const { computeDeviceStats } = await import(pathToFileURL(join(dir, "stats.mjs")));
const tz = "America/Caracas";
const at = s => Date.parse(s);
const hour = 3_600_000;
const now = at("2026-10-09T16:00:00Z");
const device = (outages = [], observedFrom = at("2026-10-01T04:00:00Z")) => ({ id: "home", name: "Casa", outages, observedFrom });

test("a midnight-spanning outage retains exact timestamps and splits duration", () => {
  const iv = { start: at("2026-10-08T03:00:00Z"), end: at("2026-10-08T06:00:00Z"), ongoing: false };
  const previous = calendarDay([device([iv])], "2026-10-07", tz, now);
  const next = calendarDay([device([iv])], "2026-10-08", tz, now);
  assert.equal(previous.outageMs, hour);
  assert.equal(next.outageMs, 2 * hour);
  assert.equal(next.starts, 0);
  assert.equal(next.events[0].start, iv.start);
  assert.equal(next.events[0].end, iv.end);
});

test("ongoing outages end at the snapshot and future days have no observation", () => {
  const ongoing = { start: now - 2 * hour, end: now, ongoing: true };
  const today = calendarDay([device([ongoing])], "2026-10-09", tz, now);
  assert.equal(today.outageMs, 2 * hour);
  assert.equal(today.events[0].ongoing, true);
  assert.equal(today.until, now);
  assert.equal(calendarDay([device([ongoing])], "2026-10-10", tz, now).events.length, 0);
  assert.equal(calendarDay([device([ongoing])], "2026-10-10", tz, now).observedCount, 0);
});

test("missing and partial history are distinct from a day with no recorded outages", () => {
  assert.equal(calendarDay([device([], null)], "2026-10-08", tz, now).observedCount, 0);
  const partial = calendarDay([device([], at("2026-10-08T12:00:00Z"))], "2026-10-08", tz, now);
  assert.equal(partial.partial, true);
  const complete = calendarDay([device()], "2026-10-08", tz, now);
  assert.equal(complete.partial, false);
  assert.equal(complete.outageMs, 0);
});

test("multiple locations sum device time and retain each location", () => {
  const iv = { start: now - hour, end: now, ongoing: true };
  const devices = [device([iv]), { ...device([iv]), id: "office", name: "Oficina" }];
  const result = calendarDay(devices, "2026-10-09", tz, now);
  assert.equal(result.outageMs, 2 * hour);
  assert.equal(new Set(result.events.map(e => e.deviceId)).size, 2);
  assert.equal(calendarDay(devices.filter(d => d.id === "office"), "2026-10-09", tz, now).outageMs, hour);
});

test("an outage ending exactly at midnight belongs only to the previous day", () => {
  const iv = { start: at("2026-10-08T02:00:00Z"), end: at("2026-10-08T04:00:00Z"), ongoing: false };
  assert.equal(calendarDay([device([iv])], "2026-10-08", tz, now).events.length, 0);
  assert.equal(nextDate("2026-12-31"), "2027-01-01");
});

test("calendar exposes retained history even outside the selected summary range", () => {
  const events = [{ state: "on", at: now - 10 * 24 * hour }, { state: "off", at: now - 5 * 24 * hour }, { state: "on", at: now - 5 * 24 * hour + hour }];
  const stats = computeDeviceStats(events, now, tz, "day");
  assert.equal(stats.current.outageMs, 0);
  assert.equal(stats.outages.length, 1);
  assert.equal(stats.observedFrom, events[0].at);
  assert.equal(computeDeviceStats([], now, tz, "day").observedFrom, null);
});
