import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTaskApprovalPoints,
  markMessagesRead,
  processRewardReview,
  safeDeletePartner,
  validateRewardRedemption,
  validateTaskTransition
} from "../js/utils/loveLogic.js";

test("task transitions enforce partner and admin permissions", () => {
  assert.equal(validateTaskTransition("pending", "in_progress", "girlfriend"), true);
  assert.equal(validateTaskTransition("rejected", "submitted", "girlfriend"), true);
  assert.equal(validateTaskTransition("submitted", "approved", "girlfriend"), false);
  assert.equal(validateTaskTransition("submitted", "rejected", "girlfriend"), false);
  assert.equal(validateTaskTransition("submitted", "approved", "admin"), true);
});

test("task approval awards points once and records an audit transaction", () => {
  const partner = { uid: "partner-1", rewardPoints: 20 };
  const task = {
    id: "task-1",
    title: "Plan a date",
    points: 50,
    status: "submitted",
    assignedTo: "partner-1"
  };
  const result = applyTaskApprovalPoints(partner, task, "admin-1", "2026-01-01T00:00:00.000Z");
  assert.equal(result.updatedPartner.rewardPoints, 70);
  assert.equal(result.updatedTask.awardHistory.awardedBy, "admin-1");
  assert.equal(result.transaction.amount, 50);
  assert.throws(
    () => applyTaskApprovalPoints(partner, result.updatedTask, "admin-1", "2026-01-02T00:00:00.000Z"),
    /already awarded/
  );
});

test("redemption prevents overdraft and debits available points", () => {
  const partner = { uid: "partner-1", username: "Jordan", rewardPoints: 100 };
  const reward = { id: "dinner", title: "Dinner", cost: 80, available: true };
  const result = validateRewardRedemption(partner, reward, "2026-01-01T00:00:00.000Z");
  assert.equal(result.updatedPartner.rewardPoints, 20);
  assert.equal(result.transaction.amount, -80);
  assert.throws(
    () => validateRewardRedemption(partner, { ...reward, cost: 101 }, "2026-01-01T00:00:00.000Z"),
    /not enough/
  );
});

test("reward rejection refunds exactly once while approval keeps the debit", () => {
  const redemption = {
    id: "redemption-1",
    partnerId: "partner-1",
    rewardTitle: "Dinner",
    cost: 80,
    status: "pending"
  };
  const partner = { uid: "partner-1", rewardPoints: 20 };
  const rejected = processRewardReview(
    redemption, "rejected", partner, "admin-1", "Try another date.", "2026-01-01T00:00:00.000Z"
  );
  assert.equal(rejected.partner.rewardPoints, 100);
  assert.equal(rejected.transaction.type, "refund_rejected");
  const approved = processRewardReview(
    redemption, "approved", partner, "admin-1", "", "2026-01-01T00:00:00.000Z"
  );
  assert.equal(approved.partner.rewardPoints, 20);
  assert.equal(approved.transaction, null);
});

test("read receipts mark only messages from the active partner", () => {
  const messages = [
    { id: "incoming", senderId: "partner-1", receiverId: "admin-1", read: false },
    { id: "outgoing", senderId: "admin-1", receiverId: "partner-1", read: false },
    { id: "read", senderId: "partner-1", receiverId: "admin-1", read: true }
  ];
  const result = markMessagesRead(messages, "admin-1", "partner-1", "2026-01-01T00:00:00.000Z");
  assert.equal(result[0].read, true);
  assert.equal(result[0].readAt, "2026-01-01T00:00:00.000Z");
  assert.equal(result[1].read, false);
  assert.equal(result[2], messages[2]);
});

test("partner deletion requires admin and preserves admin and unrelated records", () => {
  const users = [
    { id: "admin-1", role: "admin" },
    { id: "partner-1", role: "girlfriend" },
    { id: "partner-2", role: "girlfriend" }
  ];
  assert.throws(
    () => safeDeletePartner("partner-1", users, [], [], [], "girlfriend"),
    /Only the administrator/
  );
  assert.throws(
    () => safeDeletePartner("admin-1", users, [], [], [], "admin"),
    /Only an existing partner/
  );
  const result = safeDeletePartner(
    "partner-1",
    users,
    [{ assignedTo: "partner-1" }, { assignedTo: "partner-2" }],
    [{ partnerId: "partner-1" }, { partnerId: "partner-2" }],
    [{ senderId: "partner-1", receiverId: "admin-1" }, { senderId: "partner-2", receiverId: "admin-1" }],
    "admin",
    {
      stories: [{ authorId: "partner-1" }, { authorId: "partner-2" }],
      notifications: [{ assignedTo: "partner-1" }, { assignedTo: "partner-2" }],
      pointLedger: [{ userId: "partner-1" }, { userId: "partner-2" }]
    }
  );
  assert.deepEqual(result.users.map((user) => user.id), ["admin-1", "partner-2"]);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.redemptions.length, 1);
  assert.equal(result.messages.length, 1);
  assert.equal(result.stories.length, 1);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.pointLedger.length, 1);
});
