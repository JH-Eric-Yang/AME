import type { ElementConfig } from "ame-shared";
import { isOnSurface, type ElementSurface } from "ame-shared/surfaces";

export interface AudienceTab {
  label: string;
  surface: ElementSurface;
}

/**
 * The "Screen for" tabs. The device is one more audience, not a separate
 * authoring surface: one routine holds every screen it produces.
 */
export function audienceTabs(
  roles: string[],
  deviceEnabled: boolean,
): AudienceTab[] {
  const tabs: AudienceTab[] = [
    { label: "All", surface: "screen" },
    ...roles.map((label) => ({ label, surface: "screen" as const })),
  ];
  if (deviceEnabled) tabs.push({ label: "Device", surface: "device" });
  return tabs;
}

/**
 * The ROLE audience a tab implies. "Device" names a surface, not a role: the
 * phone tab shows every role's device elements, and whose phone an element is
 * on is decided by its showForRoles exactly as on the desktop. Treating the
 * label as a role stamps showForRoles: ["Device"], which matches no
 * participant and hides the element from everyone.
 */
export function roleAudienceFor(tab: AudienceTab): string {
  return tab.surface === "device" ? "All" : tab.label;
}

/**
 * The elements one audience sees on one surface.
 *
 * A role and a surface are independent predicates, which is what makes
 * `showForRoles: ["Director"], surface: "device"` mean the Director's phone
 * without a rule of its own.
 */
export function elementsForAudience(
  elements: ElementConfig[],
  audience: string,
  surface: ElementSurface,
): ElementConfig[] {
  return elements.filter((el) => {
    if (!isOnSurface(el, surface)) return false;
    if (audience === "All") return true;
    if (!el.showForRoles || el.showForRoles.length === 0) return true;
    return el.showForRoles.includes(audience);
  });
}
