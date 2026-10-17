import { describe, it, expect, beforeEach } from "vitest";
import { DeviceSlotManager } from "../socket/deviceSlotHandler";

describe("Device Slot Integration", () => {
  let manager: DeviceSlotManager;
  const key = "exp-1:p-1:multi-cap";

  beforeEach(() => {
    manager = new DeviceSlotManager();
    manager.initSlots(key, [
      { label: "overhead", capabilities: ["camera"], facingMode: "environment" },
      { label: "mic", capabilities: ["microphone"] },
    ]);
  });

  it("full lifecycle: init → claim → disconnect → reclaim", () => {
    // Claim both slots
    const r1 = manager.claimSlot(key, "overhead", "socket-1");
    const r2 = manager.claimSlot(key, "mic", "socket-2");
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(manager.getUnfilledSlots(key)).toHaveLength(0);

    // Device 1 disconnects
    manager.releaseBySocket("socket-1");
    expect(manager.getUnfilledSlots(key)).toHaveLength(1);

    // New device claims the released slot
    const r3 = manager.claimSlot(key, "overhead", "socket-3");
    expect(r3.success).toBe(true);
    expect(r3.slot?.facingMode).toBe("environment");
  });

  it("concurrent claims on same slot — only first succeeds", () => {
    const r1 = manager.claimSlot(key, "overhead", "socket-1");
    const r2 = manager.claimSlot(key, "overhead", "socket-2");
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);
    expect(r2.reason).toBe("Slot already claimed");
  });

  it("cleanup removes all slots for a key", () => {
    manager.claimSlot(key, "overhead", "socket-1");
    manager.cleanupSlots(key);
    expect(manager.getSlots(key)).toBeUndefined();
    expect(manager.releaseBySocket("socket-1")).toEqual([]);
  });
});
