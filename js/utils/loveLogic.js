const partnerTaskTransitions = {
  pending: new Set(["in_progress", "submitted"]),
  in_progress: new Set(["submitted"]),
  rejected: new Set(["submitted"])
};

export function validateTaskTransition(currentStatus, nextStatus, role) {
  if (role === "admin") {
    return ["submitted", "done"].includes(currentStatus) &&
      ["approved", "rejected"].includes(nextStatus);
  }
  return role === "girlfriend" &&
    Boolean(partnerTaskTransitions[currentStatus]?.has(nextStatus));
}

export function applyTaskApprovalPoints(partner, task, adminId, nowIso) {
  if (task.awardHistory) throw new Error("This task has already awarded points.");
  if (!["submitted", "done"].includes(task.status)) {
    throw new Error("Only submitted tasks can be approved.");
  }
  if (!partner?.uid || task.assignedTo !== partner.uid) {
    throw new Error("The task is not assigned to this partner.");
  }
  if (!Number.isInteger(task.points) || task.points < 0) {
    throw new Error("Task points must be a non-negative whole number.");
  }
  if (!partner?.uid || !adminId || !nowIso) {
    throw new Error("A partner, administrator, and award timestamp are required.");
  }

  const updatedTask = {
    ...task,
    status: "approved",
    awardHistory: {
      awardedAt: nowIso,
      points: task.points,
      awardedBy: adminId
    }
  };
  const updatedPartner = {
    ...partner,
    rewardPoints: (Number(partner.rewardPoints) || 0) + task.points
  };
  const transaction = {
    id: `${task.id}-award`,
    userId: partner.uid,
    amount: task.points,
    type: "earned_task",
    description: `Completed: ${task.title}`,
    timestamp: nowIso,
    referenceId: task.id
  };
  return { updatedTask, updatedPartner, transaction };
}

export function validateRewardRedemption(partner, reward, nowIso) {
  if (!reward?.available) throw new Error("This reward is not currently available.");
  if (!Number.isInteger(reward.cost) || reward.cost < 0) {
    throw new Error("Reward cost must be a non-negative whole number.");
  }
  const points = Number(partner?.rewardPoints) || 0;
  if (points < reward.cost) throw new Error("There are not enough Love Bank points.");
  if (!partner?.uid || !nowIso) throw new Error("A partner and request timestamp are required.");

  const redemption = {
    id: `${reward.id}-${partner.uid}-${nowIso}`,
    rewardId: reward.id,
    rewardTitle: reward.title,
    partnerId: partner.uid,
    partnerName: partner.username || partner.name || "Partner",
    cost: reward.cost,
    requestedAt: nowIso,
    status: "pending"
  };
  const updatedPartner = { ...partner, rewardPoints: points - reward.cost };
  const transaction = {
    id: `${redemption.id}-redeem`,
    userId: partner.uid,
    amount: -reward.cost,
    type: "redeemed_reward",
    description: `Requested: ${reward.title}`,
    timestamp: nowIso,
    referenceId: redemption.id
  };
  return { redemption, updatedPartner, transaction };
}

export function processRewardReview(redemption, action, partner, adminId, note, nowIso) {
  if (redemption.status !== "pending") {
    throw new Error("Only pending reward requests can be reviewed.");
  }
  if (!["approved", "rejected"].includes(action)) {
    throw new Error("Choose whether to approve or reject the request.");
  }
  if (!Number.isSafeInteger(redemption.cost) || redemption.cost < 0 ||
      !partner?.uid || redemption.partnerId !== partner.uid) {
    throw new Error("The reward request or partner account is invalid.");
  }
  if (!adminId || !nowIso) throw new Error("An administrator and review timestamp are required.");

  const updatedRedemption = {
    ...redemption,
    status: action,
    reviewedAt: nowIso,
    adminNote: typeof note === "string" ? note.trim() : ""
  };
  const updatedPartner = action === "rejected"
    ? { ...partner, rewardPoints: (Number(partner.rewardPoints) || 0) + redemption.cost }
    : partner;
  const transaction = action === "rejected"
    ? {
        id: `${redemption.id}-refund`,
        userId: partner.uid,
        amount: redemption.cost,
        type: "refund_rejected",
        description: `Refund: ${redemption.rewardTitle}`,
        timestamp: nowIso,
        referenceId: redemption.id
      }
    : null;
  return { redemption: updatedRedemption, partner: updatedPartner, transaction };
}

export function markMessagesRead(messages, currentUserId, partnerId, nowIso) {
  return messages.map((message) =>
    message.senderId === partnerId &&
    message.receiverId === currentUserId &&
    message.read !== true
      ? { ...message, read: true, readAt: nowIso }
      : message
  );
}

export function safeDeletePartner(partnerId, users, tasks, redemptions, messages, actorRole, related = {}) {
  if (actorRole !== "admin") throw new Error("Only the administrator can delete a partner.");
  const target = users.find((user) => user.id === partnerId || user.uid === partnerId);
  if (!target || target.role !== "girlfriend") {
    throw new Error("Only an existing partner account can be deleted.");
  }
  return {
    users: users.filter((user) => user.id !== partnerId && user.uid !== partnerId),
    tasks: tasks.filter((task) => task.assignedTo !== partnerId),
    redemptions: redemptions.filter((item) => item.partnerId !== partnerId),
    messages: messages.filter((message) =>
      message.senderId !== partnerId && message.receiverId !== partnerId
    ),
    stories: (related.stories || []).filter((story) => story.authorId !== partnerId),
    notifications: (related.notifications || []).filter((notification) =>
      notification.assignedTo !== partnerId
    ),
    pointLedger: (related.pointLedger || []).filter((entry) => entry.userId !== partnerId)
  };
}
