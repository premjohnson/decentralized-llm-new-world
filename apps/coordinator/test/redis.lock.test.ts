import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  acquireLock,
  releaseLock,
  type RedisLock,
} from "../src/redis/lock.js";
import {
  closeRedis,
  connectRedis,
  redis,
} from "../src/redis/client.js";

const TEST_LOCK_KEY = "test:redis-lock";

describe("Redis distributed lock", () => {
  before(async () => {
    await connectRedis();
    await redis.del(TEST_LOCK_KEY);
  });

  after(async () => {
    await redis.del(TEST_LOCK_KEY);
    await closeRedis();
  });

  it("acquires an unlocked lock", async () => {
    const lock = await acquireLock(
      TEST_LOCK_KEY,
      10,
    );

    assert.notEqual(lock, null);
    assert.equal(lock?.key, TEST_LOCK_KEY);

    const storedToken = await redis.get(
      TEST_LOCK_KEY,
    );

    assert.equal(
      storedToken,
      lock?.token,
    );

    if (lock !== null) {
      await releaseLock(lock);
    }
  });

  it("prevents a second owner from acquiring the same lock", async () => {
    const firstLock = await acquireLock(
      TEST_LOCK_KEY,
      10,
    );

    assert.notEqual(firstLock, null);

    const secondLock = await acquireLock(
      TEST_LOCK_KEY,
      10,
    );

    assert.equal(secondLock, null);

    if (firstLock !== null) {
      await releaseLock(firstLock);
    }
  });

  it("allows the owner to release the lock", async () => {
    const lock = await acquireLock(
      TEST_LOCK_KEY,
      10,
    );

    assert.notEqual(lock, null);

    if (lock === null) {
      return;
    }

    const released = await releaseLock(lock);

    assert.equal(released, true);

    const storedToken = await redis.get(
      TEST_LOCK_KEY,
    );

    assert.equal(storedToken, null);
  });

  it("does not allow a different token to release the lock", async () => {
    const lock = await acquireLock(
      TEST_LOCK_KEY,
      10,
    );

    assert.notEqual(lock, null);

    if (lock === null) {
      return;
    }

    const fakeOwner: RedisLock = {
      key: TEST_LOCK_KEY,
      token: "fake-owner-token",
    };

    const released = await releaseLock(
      fakeOwner,
    );

    assert.equal(released, false);

    const storedToken = await redis.get(
      TEST_LOCK_KEY,
    );

    assert.equal(
      storedToken,
      lock.token,
    );

    await releaseLock(lock);
  });

  it("allows another owner to acquire the lock after release", async () => {
    const firstLock = await acquireLock(
      TEST_LOCK_KEY,
      10,
    );

    assert.notEqual(firstLock, null);

    if (firstLock === null) {
      return;
    }

    await releaseLock(firstLock);

    const secondLock = await acquireLock(
      TEST_LOCK_KEY,
      10,
    );

    assert.notEqual(secondLock, null);

    if (secondLock !== null) {
      assert.notEqual(
        secondLock.token,
        firstLock.token,
      );

      await releaseLock(secondLock);
    }
  });

  it("rejects an invalid TTL", async () => {
    await assert.rejects(
      async () => {
        await acquireLock(
          TEST_LOCK_KEY,
          0,
        );
      },
      /Lock TTL must be a positive integer/,
    );

    await assert.rejects(
      async () => {
        await acquireLock(
          TEST_LOCK_KEY,
          -1,
        );
      },
      /Lock TTL must be a positive integer/,
    );

    await assert.rejects(
      async () => {
        await acquireLock(
          TEST_LOCK_KEY,
          1.5,
        );
      },
      /Lock TTL must be a positive integer/,
    );
  });
});