import { describe, it, expect } from "vitest";
import type { ElementConfig } from "ame-shared";
import { audienceTabs, elementsForAudience, roleAudienceFor } from "../surfaceAxis";

const els: ElementConfig[] = [
  { name: "shared", type: "text", params: {} },
  { name: "dirOnly", type: "text", params: {}, showForRoles: ["Director"] },
  { name: "phone", type: "button", params: {}, surface: "device", showForRoles: ["Director"] },
];

describe("elementsForAudience", () => {
  it("gives a role their own and the shared desktop elements", () => {
    expect(elementsForAudience(els, "Director", "screen").map((e) => e.name))
      .toEqual(["shared", "dirOnly"]);
  });

  it("keeps another role's element off this screen", () => {
    expect(elementsForAudience(els, "Matcher", "screen").map((e) => e.name))
      .toEqual(["shared"]);
  });

  it("keeps device elements off every desktop screen", () => {
    expect(elementsForAudience(els, "All", "screen").map((e) => e.name))
      .toEqual(["shared", "dirOnly"]);
  });

  it("shows the phone only its own elements", () => {
    expect(elementsForAudience(els, "All", "device").map((e) => e.name))
      .toEqual(["phone"]);
  });

  it("scopes the phone by role too, so one participant's handset is its own", () => {
    expect(elementsForAudience(els, "Matcher", "device")).toEqual([]);
  });
});

describe("audienceTabs", () => {
  it("offers All, each role, and the device when one is enabled", () => {
    expect(audienceTabs(["Director", "Matcher"], true).map((t) => t.label))
      .toEqual(["All", "Director", "Matcher", "Device"]);
  });

  it("hides the device tab when the experiment has no supplementary device", () => {
    expect(audienceTabs(["Director", "Matcher"], false).map((t) => t.label))
      .toEqual(["All", "Director", "Matcher"]);
  });

  it("marks which tab is the device surface", () => {
    const tabs = audienceTabs(["Director"], true);
    expect(tabs.at(-1)).toMatchObject({ label: "Device", surface: "device" });
    expect(tabs[0]).toMatchObject({ label: "All", surface: "screen" });
  });
});

describe("roleAudienceFor", () => {
  it("treats the Device tab as every role's phone, not a role named Device", () => {
    const tabs = audienceTabs(["Director", "Matcher"], true);
    const deviceTab = tabs.find((t) => t.label === "Device")!;
    expect(roleAudienceFor(deviceTab)).toBe("All");
  });

  it("passes a role tab's own label through unchanged", () => {
    const tabs = audienceTabs(["Director", "Matcher"], true);
    const directorTab = tabs.find((t) => t.label === "Director")!;
    const allTab = tabs.find((t) => t.label === "All")!;
    expect(roleAudienceFor(directorTab)).toBe("Director");
    expect(roleAudienceFor(allTab)).toBe("All");
  });

  it("composes with elementsForAudience so the Device tab shows a role-scoped phone element", () => {
    // This is the exact call shape CanvasBuilder uses for the Device tab. A
    // Director-only device element must be visible there — the Builder is
    // where the researcher decides whose phone it is, via role toggles, not
    // via the tab. Regressing roleAudienceFor back to the tab label (the
    // original bug) makes this assertion fail, because
    // showForRoles: ["Director"] never includes "Device".
    const tabs = audienceTabs(["Director", "Matcher"], true);
    const deviceTab = tabs.find((t) => t.label === "Device")!;
    expect(elementsForAudience(els, roleAudienceFor(deviceTab), deviceTab.surface).map((e) => e.name))
      .toEqual(["phone"]);
  });
});
