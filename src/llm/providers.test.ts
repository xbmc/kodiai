import { describe, expect, test } from "bun:test";
import { createProviderModelWithLoaders } from "./providers.ts";

describe("createProviderModelWithLoaders", () => {
  test("loads only the selected provider SDK", async () => {
    const loaded: string[] = [];
    const loaders = {
      anthropic: async () => {
        loaded.push("anthropic");
        return (modelId: string) => ({ provider: "anthropic", modelId }) as never;
      },
      openai: async () => {
        loaded.push("openai");
        return (modelId: string) => ({ provider: "openai", modelId }) as never;
      },
      google: async () => {
        loaded.push("google");
        return (modelId: string) => ({ provider: "google", modelId }) as never;
      },
    };

    const model = await createProviderModelWithLoaders("openai/gpt-4o", loaders);

    expect(model as unknown).toEqual({ provider: "openai", modelId: "gpt-4o" });
    expect(loaded).toEqual(["openai"]);
  });

  test("defaults unknown model IDs to the anthropic loader", async () => {
    const loaded: string[] = [];
    const model = await createProviderModelWithLoaders("custom-model", {
      anthropic: async () => {
        loaded.push("anthropic");
        return (modelId: string) => ({ provider: "anthropic", modelId }) as never;
      },
      openai: async () => {
        loaded.push("openai");
        return (modelId: string) => ({ provider: "openai", modelId }) as never;
      },
      google: async () => {
        loaded.push("google");
        return (modelId: string) => ({ provider: "google", modelId }) as never;
      },
    });

    expect(model as unknown).toEqual({ provider: "anthropic", modelId: "custom-model" });
    expect(loaded).toEqual(["anthropic"]);
  });
});
