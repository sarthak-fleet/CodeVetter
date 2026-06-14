import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { trackAppLaunch, trackCoreAction } from "./analytics";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

interface CapturedEvent {
  event: string;
  properties: Record<string, unknown>;
}

let events: CapturedEvent[];

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  events = [];
  globalThis.fetch = ((_url: string, init?: { body?: string }) => {
    if (init?.body) {
      const parsed = JSON.parse(init.body) as CapturedEvent;
      events.push({ event: parsed.event, properties: parsed.properties });
    }
    return Promise.resolve(undefined);
  }) as unknown as typeof fetch;
});

const names = () => events.map((e) => e.event);

describe("trackAppLaunch", () => {
  it("emits signup only on the very first launch", () => {
    trackAppLaunch();
    assert.deepEqual(names(), ["signup"]);

    events = [];
    trackAppLaunch();
    // Second launch with no prior activity stays silent.
    assert.deepEqual(names(), []);
  });

  it("emits returned on later launches once the install has activated", () => {
    trackAppLaunch(); // signup
    trackCoreAction("review_run"); // activated + core_action
    events = [];

    trackAppLaunch();
    assert.deepEqual(names(), ["returned"]);
  });
});

describe("trackCoreAction", () => {
  it("emits activated once, then core_action on every call", () => {
    trackCoreAction("review_run");
    assert.deepEqual(names(), ["activated", "core_action"]);

    events = [];
    trackCoreAction("repo_unpack");
    // Already activated — no second activated event.
    assert.deepEqual(names(), ["core_action"]);
    assert.equal(events[0].properties.action, "repo_unpack");
  });

  it("tags every event with the CodeVetter project id", () => {
    trackCoreAction("review_run");
    assert.ok(events.length > 0);
    for (const event of events) {
      assert.equal(event.properties.project_id, "CodeVetter");
    }
  });
});
