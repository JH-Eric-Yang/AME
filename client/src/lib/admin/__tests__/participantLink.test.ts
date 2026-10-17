import { describe, it, expect } from "vitest";
import { participantLink, idParamHint, linkWarnings } from "../participantLink";

describe("participantLink", () => {
  it("joins the site origin and the experiment path", () => {
    expect(participantLink("https://ame.example.org", "abc-123")).toBe("https://ame.example.org/experiment/abc-123");
  });

  it("drops a trailing slash on the origin", () => {
    expect(participantLink("http://localhost:5173/", "abc")).toBe("http://localhost:5173/experiment/abc");
  });
});

describe("idParamHint", () => {
  it("tells the researcher which query parameter to add", () => {
    expect(idParamHint("PROLIFIC_PID")).toBe("Add ?PROLIFIC_PID=<id> to the link. Your recruitment platform fills in <id>.");
  });

  it("is null when no parameter is set", () => {
    expect(idParamHint(null)).toBeNull();
    expect(idParamHint("")).toBeNull();
  });
});

describe("linkWarnings", () => {
  const ready = { visible: true, allowNew: true, dirty: false };

  it("is empty when participants can join the saved experiment", () => {
    expect(linkWarnings(ready)).toEqual([]);
  });

  it("names the setting that blocks every participant", () => {
    expect(linkWarnings({ ...ready, visible: false })).toEqual([
      'Participants cannot open this link. Turn on "Visible to participants" in Settings.',
    ]);
  });

  it("names the setting that blocks new participants", () => {
    expect(linkWarnings({ ...ready, allowNew: false })).toEqual([
      'New participants cannot join. Turn on "Allow new participants" in Settings.',
    ]);
  });

  it("warns that participants get the saved version", () => {
    expect(linkWarnings({ ...ready, dirty: true })).toEqual([
      "Participants get the saved version. Click Save Changes first.",
    ]);
  });

  it("lists every warning that applies, most blocking first", () => {
    expect(linkWarnings({ visible: false, allowNew: false, dirty: true })).toHaveLength(3);
    expect(linkWarnings({ visible: false, allowNew: false, dirty: true })[0]).toMatch(/^Participants cannot open/);
  });
});
