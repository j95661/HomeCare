import { describe, expect, it } from "vitest";
import { withMedTime, withoutMedTime } from "../src/medTimes";

describe("medication times", () => {
  it("adds several clock times and keeps them in order", () => {
    const morning = withMedTime(["08:00"], "20:00");
    expect(morning.error).toBe("");
    expect(morning.times).toEqual(["08:00", "20:00"]);
    const noon = withMedTime(morning.times, "12:00:00");
    expect(noon.times).toEqual(["08:00", "12:00", "20:00"]);
    expect(withMedTime(noon.times, "08:00").times).toEqual(["08:00", "12:00", "20:00"]);
  });

  it("stops at six times and rejects a blank clock", () => {
    const full = ["06:00", "08:00", "12:00", "16:00", "18:00", "20:00"];
    expect(withMedTime(full, "22:00")).toMatchObject({ times: full, error: "A medication can have up to 6 times." });
    expect(withMedTime(["08:00"], "").error).toBe("Choose a time.");
    expect(withoutMedTime(["08:00", "20:00"], "08:00")).toEqual(["20:00"]);
  });
});
