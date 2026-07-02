import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
describe("prisma singleton", () => {
  it("exports a client with expected models", () => {
    expect(prisma).toBeDefined();
    expect(prisma.user).toBeDefined();
    expect(prisma.watchlistItem).toBeDefined();
  });
});
