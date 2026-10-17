import type { Namespace } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, DeviceSource } from "ame-shared";
import type { TypedSocket, SocketState } from "./index.js";
import { safeOn, safeOnDisconnect } from "./safeListener.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

export interface SlotState {
  claimed: boolean;
  deviceSocketId: string | null;
  slotLabel: string;
  capabilities: ("camera" | "microphone")[];
  facingMode?: string;
  constraints?: Record<string, unknown>;
}

interface ClaimResult {
  success: boolean;
  slot?: SlotState;
  reason?: string;
}

export class DeviceSlotManager {
  private slots = new Map<string, Map<string, SlotState>>();
  /**
   * Which phone holds which slot label, per `<experimentId>:<participantId>`.
   * A step's slots are new each time, so this is what lets a phone that is
   * still connected keep its slot on the next step without a new scan.
   */
  private holders = new Map<string, Map<string, string>>();

  rememberHolder(owner: string, slotLabel: string, socketId: string): void {
    const labels = this.holders.get(owner) ?? new Map<string, string>();
    labels.set(slotLabel, socketId);
    this.holders.set(owner, labels);
  }

  holderOf(owner: string, slotLabel: string): string | undefined {
    return this.holders.get(owner)?.get(slotLabel);
  }

  initSlots(key: string, sources: DeviceSource[]): void {
    const slotMap = new Map<string, SlotState>();
    for (const source of sources) {
      slotMap.set(source.label, {
        claimed: false,
        deviceSocketId: null,
        slotLabel: source.label,
        capabilities: source.capabilities,
        facingMode: source.facingMode,
        constraints: source.constraints,
      });
    }
    this.slots.set(key, slotMap);
  }

  claimSlot(key: string, slotLabel: string, socketId: string): ClaimResult {
    const slotMap = this.slots.get(key);
    if (!slotMap) return { success: false, reason: "No slots initialized" };

    const slot = slotMap.get(slotLabel);
    if (!slot) return { success: false, reason: "Slot not found" };
    if (slot.claimed) return { success: false, reason: "Slot already claimed" };

    slot.claimed = true;
    slot.deviceSocketId = socketId;
    return { success: true, slot: { ...slot } };
  }

  releaseBySocket(socketId: string): { key: string; slotLabel: string }[] {
    for (const labels of this.holders.values()) {
      for (const [label, holder] of labels) {
        if (holder === socketId) labels.delete(label);
      }
    }
    const released: { key: string; slotLabel: string }[] = [];
    for (const [key, slotMap] of this.slots) {
      for (const [label, slot] of slotMap) {
        if (slot.deviceSocketId === socketId) {
          slot.claimed = false;
          slot.deviceSocketId = null;
          released.push({ key, slotLabel: label });
        }
      }
    }
    return released;
  }

  getSlots(key: string): SlotState[] | undefined {
    const slotMap = this.slots.get(key);
    return slotMap ? [...slotMap.values()] : undefined;
  }

  getUnfilledSlots(key: string): SlotState[] | undefined {
    const slotMap = this.slots.get(key);
    return slotMap ? [...slotMap.values()].filter((s) => !s.claimed) : undefined;
  }

  cleanupSlots(key: string): void {
    this.slots.delete(key);
  }
}

// Singleton instance
export const deviceSlotManager = new DeviceSlotManager();

/**
 * Send a phone the open slots of the element it scanned. Call it only after
 * the phone's experiment is known: a new phone socket learns it from the
 * participant lookup in `device:connect` (`signalingHandler.ts`).
 */
export function offerDeviceSlots(
  socket: TypedSocket,
  experimentId: string,
  participantId: string,
  element: string,
): void {
  const unfilled = deviceSlotManager.getUnfilledSlots(`${experimentId}:${participantId}:${element}`);
  if (!unfilled) return;
  socket.emit("device:slots-available", {
    slots: unfilled.map((s) => ({
      slotLabel: s.slotLabel,
      capabilities: s.capabilities,
      facingMode: s.facingMode,
    })),
  });
}

function slotConfirmation(slot: SlotState) {
  return {
    slotLabel: slot.slotLabel,
    capabilities: slot.capabilities,
    facingMode: slot.facingMode,
    constraints: slot.constraints,
  };
}

export function registerDeviceSlotHandler(
  ns: TypedNamespace,
  socket: TypedSocket,
): void {
  safeOn(socket, "device:slots-init", ({ elementName, sources }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId || !state.participantId) return;

    const owner = `${state.experimentId}:${state.participantId}`;
    const key = `${owner}:${elementName}`;
    deviceSlotManager.initSlots(key, sources);

    // A phone still connected from an earlier step takes its slot again.
    for (const { label } of sources) {
      const holder = deviceSlotManager.holderOf(owner, label);
      if (!holder) continue;
      const { slot } = deviceSlotManager.claimSlot(key, label, holder);
      if (!slot) continue;
      ns.to(holder).emit("device:slot-confirmed", slotConfirmation(slot));
      socket.emit("device:slot-filled", { slotLabel: label, deviceId: holder });
    }
  });

  safeOn(socket, "device:slot-claim", ({ slotLabel, elementName }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId || !state.participantId) return;

    const key = `${state.experimentId}:${state.participantId}:${elementName}`;
    const result = deviceSlotManager.claimSlot(key, slotLabel, socket.id);

    if (result.success && result.slot) {
      deviceSlotManager.rememberHolder(`${state.experimentId}:${state.participantId}`, slotLabel, socket.id);
      socket.emit("device:slot-confirmed", slotConfirmation(result.slot));

      // Notify desktop
      const room = `experiment:${state.experimentId}:${state.participantId}`;
      socket.to(room).emit("device:slot-filled", {
        slotLabel,
        deviceId: socket.id,
      });
    } else {
      socket.emit("device:slot-denied", { reason: result.reason ?? "Unknown error" });
    }
  });

  // Release slots on disconnect
  safeOnDisconnect(socket, () => {
    const released = deviceSlotManager.releaseBySocket(socket.id);
    const state = socket.data as SocketState;
    for (const { key, slotLabel } of released) {
      const room = `experiment:${state.experimentId}:${state.participantId}`;
      ns.to(room).emit("device:slot-lost", { slotLabel, reason: "Device disconnected" });
    }
  });
}
