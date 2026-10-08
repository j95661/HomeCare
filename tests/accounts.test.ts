import { describe, expect, it } from "vitest";
import { assertCanAssign, assertCanEdit, AuthzError, deleteAccount, revokeAccount, type AccountProfile } from "../functions/src/logic/accounts";

function profile(partial: Partial<AccountProfile> & Pick<AccountProfile, "uid" | "role">): AccountProfile {
  return {
    email: `${partial.uid}@example.com`,
    displayName: partial.uid,
    active: true,
    protected: partial.role === "super_admin",
    otpVerified: true,
    ...partial,
  };
}

function deps(order: string[]) {
  return {
    markInactive: async () => {
      order.push("inactive");
    },
    setClaims: async () => {
      order.push("claims");
    },
    disableAuth: async () => {
      order.push("disable");
    },
    revokeTokens: async () => {
      order.push("revoke");
    },
    listTokens: async () => ["token-1"],
    unsubscribe: async (tokens: string[]) => {
      order.push(`unsub:${tokens.join(",")}`);
    },
    deleteTokens: async () => {
      order.push("delete");
    },
  };
}

describe("revokeAccount", () => {
  const caller = profile({ uid: "super", role: "super_admin" });
  const target = profile({ uid: "pat", role: "care_provider", protected: false });

  it("marks the profile inactive before the session and push subscription are removed", async () => {
    const order: string[] = [];
    await revokeAccount(deps(order), caller, target);
    expect(order).toEqual(["inactive", "claims", "disable", "revoke", "unsub:token-1", "delete"]);
  });

  it("stops before any side effect when the caller is inactive or unverified", async () => {
    const order: string[] = [];
    await expect(revokeAccount(deps(order), profile({ uid: "super", role: "super_admin", active: false }), target)).rejects.toThrow(
      /not active/,
    );
    await expect(revokeAccount(deps(order), profile({ uid: "super", role: "super_admin", otpVerified: false }), target)).rejects.toThrow(
      /not active/,
    );
    expect(order).toEqual([]);
  });

  it("lets only the super admin revoke, and refuses the protected account before a self-revoke check", async () => {
    const order: string[] = [];
    await expect(revokeAccount(deps(order), profile({ uid: "admin", role: "admin", protected: false }), target)).rejects.toThrow(
      /Only the super admin/,
    );
    await expect(revokeAccount(deps(order), profile({ uid: "lead", role: "team_lead", protected: false }), target)).rejects.toThrow(
      /Only the super admin/,
    );
    await expect(revokeAccount(deps(order), caller, profile({ uid: "root", role: "super_admin" }))).rejects.toThrow(/cannot be revoked/);
    await expect(
      revokeAccount(deps(order), caller, profile({ uid: "legacy", role: "admin", protected: true })),
    ).rejects.toThrow(/cannot be revoked/);
    await expect(revokeAccount(deps(order), target, target)).rejects.toThrow(/Only the super admin/);
    expect(order).toEqual([]);
  });

  it("refuses a super admin revoking their own unprotected-looking duplicate uid", async () => {
    const self = profile({ uid: "super", role: "care_provider", protected: false });
    await expect(revokeAccount(deps([]), caller, self)).rejects.toThrow(/cannot revoke your own account/);
  });
});

describe("deleteAccount", () => {
  const caller = profile({ uid: "super", role: "super_admin" });
  const target = profile({ uid: "pat", role: "care_provider", protected: false });

  function deps(order: string[]) {
    return {
      removeProfile: async () => {
        order.push("profile");
      },
      removeAuth: async () => {
        order.push("auth");
      },
      removeInvite: async () => {
        order.push("invite");
      },
      removeSchedule: async () => {
        order.push("schedule");
      },
      removeDevices: async () => {
        order.push("devices");
      },
    };
  }

  it("removes the person, their sign-in, invite, and schedule", async () => {
    const order: string[] = [];
    await deleteAccount(deps(order), caller, target);
    expect(order).toEqual(["profile", "auth", "invite", "schedule", "devices"]);
  });

  it("refuses anyone except the super admin, and never the protected account", async () => {
    const order: string[] = [];
    await expect(deleteAccount(deps(order), profile({ uid: "admin", role: "admin", protected: false }), target)).rejects.toThrow(
      /Only the super admin/,
    );
    await expect(deleteAccount(deps(order), caller, profile({ uid: "root", role: "super_admin" }))).rejects.toThrow(/cannot be deleted/);
    await expect(deleteAccount(deps(order), caller, profile({ uid: "super", role: "care_provider", protected: false }))).rejects.toThrow(
      /cannot delete your own/,
    );
    expect(order).toEqual([]);
  });
});

describe("account assignment", () => {
  const superAdmin = profile({ uid: "super", role: "super_admin", email: "super@example.com" });

  it("reserves the super admin email regardless of letter case", () => {
    expect(() => assertCanAssign(superAdmin, "admin", "Super@Example.com", "super@example.com")).toThrow(/reserved/);
    expect(() => assertCanAssign(superAdmin, "care_provider", "pat@example.com", "super@example.com")).not.toThrow();
  });

  it("blocks a second super admin, demotion, and edits from anyone else", () => {
    expect(() => assertCanAssign(superAdmin, "super_admin", "new@example.com", "super@example.com")).toThrow(AuthzError);
    expect(() => assertCanEdit(superAdmin, superAdmin, "admin")).toThrow(/cannot be demoted/);
    expect(() => assertCanEdit(superAdmin, profile({ uid: "pat", role: "care_provider", protected: false }), "super_admin")).toThrow(
      /only one super admin/,
    );
    expect(() =>
      assertCanEdit(
        profile({ uid: "admin", role: "admin", protected: false }),
        profile({ uid: "pat", role: "care_provider", protected: false }),
        "team_lead",
      ),
    ).toThrow(/Only the super admin/);
    expect(() => assertCanEdit(profile({ uid: "super", role: "super_admin", otpVerified: false }), superAdmin, null)).toThrow(/not active/);
  });
});
