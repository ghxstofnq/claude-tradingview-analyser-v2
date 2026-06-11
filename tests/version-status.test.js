// Version visibility — the June failure mode this guards against: six PRs
// merged while the running app stayed on week-old code, with no indicator
// anywhere. computeVersionStatus is the pure decision core; createVersionPoll
// is the DI runtime that captures the boot SHA once and re-reads disk state.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeVersionStatus, shortSha, readGitFacts, createVersionPoll } from "../app/main/version-status.js";

describe("computeVersionStatus", () => {
  test("same boot and disk sha, zero behind → current", () => {
    const s = computeVersionStatus({ bootSha: "abc1234def", diskSha: "abc1234def", behind: 0 });
    assert.equal(s.state, "current");
    assert.equal(s.restart_needed, false);
    assert.equal(s.pull_needed, false);
    assert.equal(s.sha, "abc1234");
  });

  test("disk sha moved past boot sha → restart_needed", () => {
    const s = computeVersionStatus({ bootSha: "abc1234def", diskSha: "fff9999000", behind: 0 });
    assert.equal(s.state, "restart_needed");
    assert.equal(s.restart_needed, true);
    assert.equal(s.boot_sha, "abc1234");
    assert.equal(s.sha, "fff9999");
  });

  test("behind origin/main → pull_needed with count", () => {
    const s = computeVersionStatus({ bootSha: "abc1234def", diskSha: "abc1234def", behind: 20 });
    assert.equal(s.state, "pull_needed");
    assert.equal(s.behind, 20);
  });

  test("disk moved AND behind origin → restart_and_pull", () => {
    const s = computeVersionStatus({ bootSha: "abc1234def", diskSha: "fff9999000", behind: 3 });
    assert.equal(s.state, "restart_and_pull");
  });

  test("fetch failure (behind=null) never claims pull_needed", () => {
    const s = computeVersionStatus({ bootSha: "abc1234def", diskSha: "abc1234def", behind: null });
    assert.equal(s.state, "current");
    assert.equal(s.behind, null);
    assert.equal(s.pull_needed, false);
  });

  test("missing shas degrade to nulls, never throw", () => {
    const s = computeVersionStatus({ bootSha: null, diskSha: null, behind: null });
    assert.equal(s.state, "current");
    assert.equal(s.sha, null);
  });
});

describe("shortSha", () => {
  test("truncates to 7 and trims; null-safe", () => {
    assert.equal(shortSha("abcdef0123456789\n"), "abcdef0");
    assert.equal(shortSha(""), null);
    assert.equal(shortSha(null), null);
  });
});

function fakeExec(responses) {
  const calls = [];
  return {
    calls,
    execFn: async (args) => {
      calls.push(args.join(" "));
      const key = args[0]; // fetch | rev-parse | rev-list
      const r = responses[key];
      if (r instanceof Error) throw r;
      return r ?? "";
    },
  };
}

describe("readGitFacts", () => {
  test("happy path returns disk sha and behind count", async () => {
    const { execFn, calls } = fakeExec({
      fetch: "",
      "rev-parse": "abc1234def5678\n",
      "rev-list": "12\n",
    });
    const facts = await readGitFacts({ repoRoot: "/repo", execFn });
    assert.equal(facts.diskSha, "abc1234def5678");
    assert.equal(facts.behind, 12);
    assert.ok(calls.some((c) => c.startsWith("fetch --quiet origin main")));
  });

  test("fetch failure is tolerated; behind still computed from last-known refs", async () => {
    const { execFn } = fakeExec({
      fetch: new Error("offline"),
      "rev-parse": "abc1234def5678\n",
      "rev-list": "2\n",
    });
    const facts = await readGitFacts({ repoRoot: "/repo", execFn });
    assert.equal(facts.behind, 2);
  });

  test("rev-list failure degrades behind to null, never throws", async () => {
    const { execFn } = fakeExec({
      fetch: "",
      "rev-parse": "abc1234def5678\n",
      "rev-list": new Error("no upstream"),
    });
    const facts = await readGitFacts({ repoRoot: "/repo", execFn });
    assert.equal(facts.diskSha, "abc1234def5678");
    assert.equal(facts.behind, null);
  });
});

describe("createVersionPoll", () => {
  test("first tick captures boot sha; later disk movement flips restart_needed", async () => {
    let sha = "aaa111222333";
    const sent = [];
    const poll = createVersionPoll({
      repoRoot: "/repo",
      send: (ch, payload) => sent.push({ ch, payload }),
      execFn: async (args) => {
        if (args[0] === "rev-parse") return sha + "\n";
        if (args[0] === "rev-list") return "0\n";
        return "";
      },
    });
    await poll.tick();
    assert.equal(sent.at(-1).ch, "version:status");
    assert.equal(sent.at(-1).payload.state, "current");

    sha = "bbb444555666"; // a merge landed on disk
    await poll.tick();
    assert.equal(sent.at(-1).payload.state, "restart_needed");
    assert.equal(sent.at(-1).payload.boot_sha, "aaa1112");
    assert.equal(poll.get().state, "restart_needed");
  });

  test("git read failure keeps last-known status instead of flapping", async () => {
    let fail = false;
    const sent = [];
    const poll = createVersionPoll({
      repoRoot: "/repo",
      send: (ch, payload) => sent.push({ ch, payload }),
      execFn: async (args) => {
        if (fail) throw new Error("git gone");
        if (args[0] === "rev-parse") return "aaa111222333\n";
        if (args[0] === "rev-list") return "0\n";
        return "";
      },
    });
    await poll.tick();
    const before = poll.get();
    fail = true;
    await poll.tick(); // must not throw
    assert.deepEqual(poll.get(), before);
  });
});
