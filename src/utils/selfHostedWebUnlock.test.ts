import {
  buildSelfHostedUnlockedUserInfo,
  isSelfHostedUnlockHost,
  shouldTreatSelfHostedWebAsAuthed,
} from "./selfHostedWebUnlock";

declare const describe: any;
declare const it: any;
declare const expect: any;

describe("selfHostedWebUnlock", () => {
  it("matches local and configured self-hosted hosts", () => {
    expect(isSelfHostedUnlockHost("localhost")).toBe(true);
    expect(isSelfHostedUnlockHost("127.0.0.1")).toBe(true);
    expect(isSelfHostedUnlockHost("193.134.211.106")).toBe(true);
  });

  it("does not match the official hosted domain", () => {
    expect(isSelfHostedUnlockHost("web.koodoreader.com")).toBe(false);
  });

  it("treats the self-hosted browser app as authed", () => {
    expect(shouldTreatSelfHostedWebAsAuthed(false)).toBe(true);
  });

  it("forces pro status and a future entitlement window", () => {
    const now = 1_700_000_000;
    const userInfo = buildSelfHostedUnlockedUserInfo(
      { type: "trial", valid_until: 1, token_valid_until: 1 },
      now
    );

    expect(userInfo?.type).toBe("pro");
    expect(userInfo?.valid_until).toBeGreaterThan(now);
    expect(userInfo?.token_valid_until).toBeGreaterThan(now);
  });
});
