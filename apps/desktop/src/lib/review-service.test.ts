import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  buildActiveStandardsContext,
  DEFAULT_STANDARDS_PACKS,
  getActiveStandardsPack,
  getStandardsPacks,
  loadReviewConfig,
  PROVIDER_PRESETS,
  type ReviewConfig,
  saveReviewConfig,
} from "./review-service";

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

const validConfig: ReviewConfig = {
  gatewayBaseUrl: "https://gateway.example/v1",
  gatewayApiKey: "sk-test",
  gatewayModel: "auto",
  reviewTone: "direct",
};

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

describe("loadReviewConfig", () => {
  it("returns null when nothing is stored", () => {
    assert.equal(loadReviewConfig(), null);
  });

  it("returns null when required credentials are missing", () => {
    saveReviewConfig({ ...validConfig, gatewayApiKey: "" });
    assert.equal(loadReviewConfig(), null);
  });

  it("returns null on malformed JSON", () => {
    localStorage.setItem("codevetter_review_config", "{not json");
    assert.equal(loadReviewConfig(), null);
  });

  it("round-trips a valid config", () => {
    saveReviewConfig(validConfig);
    assert.deepEqual(loadReviewConfig(), validConfig);
  });
});

describe("getStandardsPacks", () => {
  it("returns the defaults when config is null", () => {
    assert.deepEqual(getStandardsPacks(null), DEFAULT_STANDARDS_PACKS);
  });

  it("appends custom packs and dedupes ids colliding with defaults", () => {
    const packs = getStandardsPacks({
      ...validConfig,
      standardsPacks: [
        { id: "product-safety", name: "Shadow", focus: "x", checks: [] },
        { id: "team-pack", name: "Team", focus: "y", checks: ["z"] },
      ],
    });

    assert.equal(packs.length, DEFAULT_STANDARDS_PACKS.length + 1);
    // The colliding id keeps the DEFAULT pack, not the custom shadow.
    assert.equal(packs.find((p) => p.id === "product-safety")?.name, "Product Safety");
    assert.equal(packs.find((p) => p.id === "team-pack")?.name, "Team");
  });
});

describe("getActiveStandardsPack", () => {
  it("falls back to the first pack when none is selected", () => {
    assert.equal(getActiveStandardsPack(null).id, DEFAULT_STANDARDS_PACKS[0].id);
  });

  it("returns the selected pack by id", () => {
    const pack = getActiveStandardsPack({
      ...validConfig,
      activeStandardsPack: "security-boundary",
    });
    assert.equal(pack.id, "security-boundary");
  });

  it("falls back to the first pack when the selected id is unknown", () => {
    const pack = getActiveStandardsPack({
      ...validConfig,
      activeStandardsPack: "does-not-exist",
    });
    assert.equal(pack.id, DEFAULT_STANDARDS_PACKS[0].id);
  });
});

describe("buildActiveStandardsContext", () => {
  it("renders the active pack and trimmed custom rules, dropping blanks", () => {
    saveReviewConfig({
      ...validConfig,
      activeStandardsPack: "security-boundary",
      customRules: ["  Always check auth  ", "   ", ""],
    });

    const context = buildActiveStandardsContext();

    assert.match(context, /Pack: Security Boundary/);
    assert.match(context, /Focus: Auth, authorization/);
    assert.match(context, /- Check: Verify server-side authorization/);
    assert.match(context, /- Custom rule: Always check auth/);
    // Blank/whitespace custom rules are filtered out.
    assert.equal((context.match(/Custom rule:/g) ?? []).length, 1);
  });
});

describe("PROVIDER_PRESETS", () => {
  it("exposes a base url and model for each known provider", () => {
    for (const key of ["free-ai", "anthropic", "openai", "openrouter"]) {
      const preset = PROVIDER_PRESETS[key];
      assert.ok(preset, `missing preset for ${key}`);
      assert.match(preset.baseUrl, /^https:\/\//);
      assert.ok(preset.model.length > 0);
    }
  });
});
