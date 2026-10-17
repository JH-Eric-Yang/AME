import { describe, it, expect } from "vitest";
import { cohortNotice, showsCohortNotice, noticeKey } from "../cohortSync";

describe("cohortNotice", () => {
  it("tells a participant who has submitted that the others are still going", () => {
    expect(cohortNotice({ submitted: 1, total: 2, progress: 2 }, true)).toEqual({
      text: "Submitted — waiting for the others (1 of 2)",
      waiting: true,
    });
  });

  it("tells a participant who has not submitted that someone is waiting on them", () => {
    expect(cohortNotice({ submitted: 1, total: 2, progress: 2 }, false)).toEqual({
      text: "1 of 2 submitted — waiting for you",
      waiting: false,
    });
  });

  it("counts a cohort larger than a dyad", () => {
    expect(cohortNotice({ submitted: 2, total: 4, progress: 2 }, true)?.text).toBe(
      "Submitted — waiting for the others (2 of 4)",
    );
  });

  it("says nothing before anyone has submitted", () => {
    expect(cohortNotice(null, false)).toBeNull();
    expect(cohortNotice({ submitted: 0, total: 2, progress: 2 }, false)).toBeNull();
  });

  it("says nothing to a participant running alone", () => {
    // A session of one releases the barrier on its own proceed, so a notice
    // would appear and vanish in the same frame.
    expect(cohortNotice({ submitted: 1, total: 1, progress: 2 }, true)).toBeNull();
  });

  it("says nothing once every member has submitted", () => {
    // The barrier has released and content is already on its way; leaving
    // "waiting for the others" on screen would outlive the wait.
    expect(cohortNotice({ submitted: 2, total: 2, progress: 2 }, true)).toBeNull();
  });
});

describe("showsCohortNotice", () => {
  it("shows the notice on a routine the participant answers", () => {
    expect(showsCohortNotice("routine-card")).toBe(true);
    expect(showsCohortNotice("routine-video-chat")).toBe(true);
    expect(showsCohortNotice("routine-survey")).toBe(true);
  });

  it("stays off the routines that advance themselves", () => {
    // Nobody submits anything on these, and the banner pushed the waiting
    // spinner off centre.
    expect(showsCohortNotice("routine-matching")).toBe(false);
    expect(showsCohortNotice("routine-end-matching")).toBe(false);
  });

  it("stays off when no routine is loaded", () => {
    expect(showsCohortNotice(undefined)).toBe(false);
  });
});

describe("noticeKey", () => {
  it("changes when another member submits", () => {
    const a = noticeKey({ submitted: 1, total: 3, progress: 2 }, false);
    const b = noticeKey({ submitted: 2, total: 3, progress: 2 }, false);
    expect(a).not.toBe(b);
  });

  it("changes when the participant reaches the next routine", () => {
    const a = noticeKey({ submitted: 1, total: 2, progress: 2 }, true);
    const b = noticeKey({ submitted: 1, total: 2, progress: 3 }, true);
    expect(a).not.toBe(b);
  });

  it("changes when this participant goes from waited-on to waiting", () => {
    // Same count, opposite sentence — dismissing one must not hide the other.
    const a = noticeKey({ submitted: 1, total: 2, progress: 2 }, false);
    const b = noticeKey({ submitted: 1, total: 2, progress: 2 }, true);
    expect(a).not.toBe(b);
  });

  it("stays put while nothing has changed, so a dismissal sticks", () => {
    const a = noticeKey({ submitted: 1, total: 2, progress: 2 }, true);
    const b = noticeKey({ submitted: 1, total: 2, progress: 2 }, true);
    expect(a).toBe(b);
  });

  it("is null when there is nothing to say", () => {
    expect(noticeKey(null, false)).toBeNull();
    expect(noticeKey({ submitted: 2, total: 2, progress: 2 }, true)).toBeNull();
  });
});
