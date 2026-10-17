import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeviceSlotManager } from "../socket/deviceSlotHandler";

describe("DeviceSlotManager", () => {
  let manager: DeviceSlotManager;

  beforeEach(() => {
    manager = new DeviceSlotManager();
  });

  const key = "exp-1:p-1:multi-cap";

  it("initializes slots from sources config", () => {
    manager.initSlots(key, [
      { label: "overhead", capabilities: ["camera"] },
      { label: "mic", capabilities: ["microphone"] },
    ]);

    const slots = manager.getSlots(key);
    expect(slots).toHaveLength(2);
    expect(slots![0].claimed).toBe(false);
    expect(slots![1].slotLabel).toBe("mic");
  });

  it("claims an open slot", () => {
    manager.initSlots(key, [
      { label: "overhead", capabilities: ["camera"] },
    ]);

    const result = manager.claimSlot(key, "overhead", "socket-1");
    expect(result.success).toBe(true);
    expect(result.slot?.capabilities).toEqual(["camera"]);
  });

  it("denies claim on already-claimed slot", () => {
    manager.initSlots(key, [
      { label: "overhead", capabilities: ["camera"] },
    ]);

    manager.claimSlot(key, "overhead", "socket-1");
    const result = manager.claimSlot(key, "overhead", "socket-2");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("Slot already claimed");
  });

  it("denies claim on unknown slot", () => {
    manager.initSlots(key, [
      { label: "overhead", capabilities: ["camera"] },
    ]);

    const result = manager.claimSlot(key, "nonexistent", "socket-1");
    expect(result.success).toBe(false);
  });

  it("releases slot when device disconnects", () => {
    manager.initSlots(key, [
      { label: "overhead", capabilities: ["camera"] },
    ]);

    manager.claimSlot(key, "overhead", "socket-1");
    const released = manager.releaseBySocket("socket-1");
    expect(released).toEqual([{ key, slotLabel: "overhead" }]);

    const result = manager.claimSlot(key, "overhead", "socket-2");
    expect(result.success).toBe(true);
  });

  it("returns unfilled slots", () => {
    manager.initSlots(key, [
      { label: "overhead", capabilities: ["camera"] },
      { label: "mic", capabilities: ["microphone"] },
    ]);

    manager.claimSlot(key, "overhead", "socket-1");
    const unfilled = manager.getUnfilledSlots(key);
    expect(unfilled).toHaveLength(1);
    expect(unfilled![0].slotLabel).toBe("mic");
  });

  it("cleans up slots for a key", () => {
    manager.initSlots(key, [
      { label: "overhead", capabilities: ["camera"] },
    ]);

    manager.cleanupSlots(key);
    expect(manager.getSlots(key)).toBeUndefined();
  });
});

describe("a paired phone across steps", () => {
  type Emit = { to: string; event: string; payload: unknown };

  function createSocket(id: string, data: Record<string, unknown>, emits: Emit[]) {
    const handlers = new Map<string, Function>();
    return {
      id,
      data,
      on: (event: string, h: Function) => { handlers.set(event, h); },
      emit: (event: string, payload: unknown) => { emits.push({ to: id, event, payload }); },
      to: (room: string) => ({ emit: (event: string, payload: unknown) => { emits.push({ to: room, event, payload }); } }),
      trigger: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
    };
  }

  const PhoneSource = { label: "phone", capabilities: ["camera", "microphone"] as ("camera" | "microphone")[], facingMode: "environment" as const };
  let emits: Emit[];
  let desktop: ReturnType<typeof createSocket>;
  let phone: ReturnType<typeof createSocket>;

  beforeEach(async () => {
    emits = [];
    const { registerDeviceSlotHandler } = await import("../socket/deviceSlotHandler");
    const ns = { to: (room: string) => ({ emit: (event: string, payload: unknown) => { emits.push({ to: room, event, payload }); } }) };
    desktop = createSocket("desk-1", { experimentId: "exp-1", participantId: "p-1" }, emits);
    phone = createSocket("phone-1", { experimentId: "exp-1", participantId: "p-1", deviceMode: "camera" }, emits);
    registerDeviceSlotHandler(ns as never, desktop as never);
    registerDeviceSlotHandler(ns as never, phone as never);

    // Step 1: the phone scans the QR code and picks its slot.
    await desktop.trigger("device:slots-init", { elementName: "reading", sources: [PhoneSource] });
    await phone.trigger("device:slot-claim", { slotLabel: "phone", elementName: "reading" });
    emits.length = 0;
  });

  it("gets its slot back on the next step without a new scan", async () => {
    await desktop.trigger("device:slots-init", { elementName: "reading", sources: [PhoneSource] });

    expect(emits).toContainEqual({ to: "desk-1", event: "device:slot-filled", payload: { slotLabel: "phone", deviceId: "phone-1" } });
    expect(emits).toContainEqual({
      to: "phone-1",
      event: "device:slot-confirmed",
      payload: { slotLabel: "phone", capabilities: ["camera", "microphone"], facingMode: "environment", constraints: undefined },
    });
  });

  it("is not paired again after it disconnects", async () => {
    await phone.trigger("disconnect", "transport close");
    emits.length = 0;

    await desktop.trigger("device:slots-init", { elementName: "reading", sources: [PhoneSource] });

    expect(emits.filter((e) => e.event === "device:slot-filled")).toEqual([]);
  });

  it("is not given a slot with another label", async () => {
    await desktop.trigger("device:slots-init", {
      elementName: "reading",
      sources: [{ label: "overhead", capabilities: ["camera"] }],
    });

    expect(emits.filter((e) => e.event === "device:slot-filled")).toEqual([]);
  });
});
