import { describe, expect, it } from "vitest";
import { welcomeDelivery } from "../functions/src/logic/welcome";

describe("welcome email", () => {
  it("enables a Gmail person when the server has no mail setup", () => {
    expect(welcomeDelivery("google", false, false)).toBe("skip");
  });

  it("still blocks an email-code person until mail is configured", () => {
    expect(welcomeDelivery("email_otp", false, false)).toBe("block");
  });

  it("sends when mail is configured or the emulator is running", () => {
    expect(welcomeDelivery("google", true, false)).toBe("send");
    expect(welcomeDelivery("email_otp", false, true)).toBe("send");
  });
});
