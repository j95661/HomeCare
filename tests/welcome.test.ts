import { describe, expect, it } from "vitest";
import { signInCodeNote, welcomeDelivery } from "../functions/src/logic/welcome";

describe("welcome email", () => {
  it("enables a Gmail person when the server has no mail setup", () => {
    expect(welcomeDelivery("google", false, false)).toBe("skip");
  });

  it("enables an email-code person when the server has no mail setup", () => {
    expect(welcomeDelivery("email_otp", false, false)).toBe("skip");
  });

  it("sends when mail is configured or the emulator is running", () => {
    expect(welcomeDelivery("google", true, false)).toBe("send");
    expect(welcomeDelivery("email_otp", false, true)).toBe("send");
  });

  it("gives the admin the sign-in code to pass on", () => {
    expect(signInCodeNote("123456", true)).toBe(
      "Enabled. Sign-in code: 123456. It expires in 10 minutes. They open HammondCare, choose Email code, and enter it.",
    );
  });
});
