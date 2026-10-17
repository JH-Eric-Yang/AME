/**
 * The link a researcher gives to participants, and what stops it working.
 *
 * The runner is served by the same client as the admin pages, so the page's
 * own origin is the participant origin — locally and in production alike.
 */

/** The runner route, `client/src/routes/experiment/[expId]`. */
const ExperimentPath = "/experiment/";

export function participantLink(origin: string, experimentId: string): string {
  return `${origin.replace(/\/+$/, "")}${ExperimentPath}${experimentId}`;
}

/** How to pass the recruitment platform's id; null when no parameter is set. */
export function idParamHint(param: string | null | undefined): string | null {
  if (!param) return null;
  return `Add ?${param}=<id> to the link. Your recruitment platform fills in <id>.`;
}

export interface LinkState {
  visible: boolean;
  allowNew: boolean;
  /** Unsaved edits in the builder: participants still get the saved version. */
  dirty: boolean;
}

/** Each reason the link will not give a participant what the researcher sees, most blocking first. */
export function linkWarnings({ visible, allowNew, dirty }: LinkState): string[] {
  const warnings: string[] = [];
  // The server refuses every join while hidden (experimentHandler) and every new one without allowNew.
  if (!visible) warnings.push('Participants cannot open this link. Turn on "Visible to participants" in Settings.');
  if (!allowNew) warnings.push('New participants cannot join. Turn on "Allow new participants" in Settings.');
  if (dirty) warnings.push("Participants get the saved version. Click Save Changes first.");
  return warnings;
}
