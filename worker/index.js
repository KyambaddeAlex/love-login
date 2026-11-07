const ADMIN_UID = "cRsPXPZrpxQAwAvA7D6Jd9uU9ca2";
const FIREBASE_AUTH_LOOKUP = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REWARDS = {
  dinner: { title: "Rooftop Dinner", cost: 150 },
  spa: { title: "Spa Day", cost: 250 },
  getaway: { title: "Weekend Getaway", cost: 500 },
  homeFeast: { title: "Home-Cooked Feast", cost: 100 }
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
    if (!isAllowedOrigin(origin, env)) return jsonResponse({ error: "Origin not allowed." }, 403);

    let action = "sendPushNotification";
    try {
      const userId = await authenticateCaller(request, env);
      const payload = await request.json();
      action = payload?.action || action;
      if (action === "deleteAccount") {
        if (userId !== ADMIN_UID) throw httpError(403, "Only the admin can delete accounts.");
        if (typeof payload.userId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.userId)) {
          throw httpError(400, "A valid account ID is required.");
        }
        if (payload.userId === ADMIN_UID) throw httpError(403, "The admin account cannot be deleted.");

        const serviceToken = await getGoogleAccessToken(env);
        await deleteGirlfriendAccount(env, serviceToken, payload.userId);
        return jsonResponse({ deleted: true }, 200, origin);
      }
      if (action === "reviewTask") {
        if (userId !== ADMIN_UID) throw httpError(403, "Only the admin can review tasks.");
        if (typeof payload.taskId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(payload.taskId)) {
          throw httpError(400, "A valid task ID is required.");
        }
        if (!["approved", "rejected"].includes(payload.decision)) {
          throw httpError(400, "Choose whether to approve or reject the task.");
        }
        const feedback = typeof payload.feedback === "string" ? payload.feedback.trim() : "";
        if (feedback.length > 2000) throw httpError(400, "Feedback must be 2,000 characters or fewer.");
        const serviceToken = await getGoogleAccessToken(env);
        const result = await reviewTask(env, serviceToken, payload.taskId, payload.decision, feedback, userId);
        return jsonResponse(result, 200, origin);
      }
      if (action === "requestReward") {
        if (userId === ADMIN_UID) throw httpError(403, "Only partner accounts can request rewards.");
        if (typeof payload.rewardId !== "string" || !Object.hasOwn(REWARDS, payload.rewardId)) {
          throw httpError(400, "Choose an available reward.");
        }
        const serviceToken = await getGoogleAccessToken(env);
        const result = await requestReward(env, serviceToken, userId, payload.rewardId);
        return jsonResponse(result, 200, origin);
      }
      if (action === "reviewReward") {
        if (userId !== ADMIN_UID) throw httpError(403, "Only the admin can review reward requests.");
        if (typeof payload.requestId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(payload.requestId)) {
          throw httpError(400, "A valid reward request ID is required.");
        }
        if (!["approved", "rejected"].includes(payload.decision)) {
          throw httpError(400, "Choose whether to approve or decline the request.");
        }
        const note = typeof payload.note === "string" ? payload.note.trim() : "";
        if (note.length > 2000) throw httpError(400, "The review note must be 2,000 characters or fewer.");
        const serviceToken = await getGoogleAccessToken(env);
        const result = await reviewReward(env, serviceToken, payload.requestId, payload.decision, note, userId);
        return jsonResponse(result, 200, origin);
      }
      if (action !== "sendPushNotification") {
        throw httpError(400, "Unsupported action.");
      }
      if (!payload || typeof payload.messageId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(payload.messageId)) {
        return jsonResponse({ error: "A valid message ID is required." }, 400, origin);
      }

      const serviceToken = await getGoogleAccessToken(env);
      const message = await getMessage(env, serviceToken, payload.messageId);
      if (!message || message.senderId !== userId) {
        return jsonResponse({ error: "Message not found or sender does not match." }, 403, origin);
      }

      const isAdmin = userId === ADMIN_UID;
      if ((isAdmin && message.receiverId === ADMIN_UID) ||
          (!isAdmin && message.receiverId !== ADMIN_UID)) {
        return jsonResponse({ error: "This conversation is not permitted." }, 403, origin);
      }

      const targetUserId = message.receiverId;
      const [recipientTokens, senderTokens] = await Promise.all([
        getDeviceTokens(env, serviceToken, targetUserId),
        getDeviceTokens(env, serviceToken, userId)
      ]);
      if (recipientTokens.length === 0) return jsonResponse({ sent: 0 }, 200, origin);

      const senderTokenSet = new Set(senderTokens);
      const tokens = recipientTokens.filter((token) => !senderTokenSet.has(token));
      if (tokens.length === 0) {
        return jsonResponse({
          sent: 0,
          skippedSenderDevices: recipientTokens.length
        }, 200, origin);
      }

      const senderName = isAdmin ? "Alex" : (message.senderName || "A girlfriend");
      const rawText = typeof message.text === "string" ? message.text : "You have a new message.";
      const body = rawText.length > 180 ? `${rawText.slice(0, 177)}...` : rawText;
      const targetPage = isAdmin ? "user-dashboard.html" : "index.html";
      const results = await Promise.all(tokens.map((token) => sendFcm(env, serviceToken, token, {
        title: `New message from ${senderName}`,
        body,
        url: new URL(targetPage, env.APP_URL).href
      })));
      const sent = results.filter((result) => result.success).length;
      if (sent === 0) {
        const failures = results.filter((result) => !result.success);
        const reasons = [...new Set(failures.map((result) =>
          `${result.code}: ${result.message}`
        ))].slice(0, 3);
        return jsonResponse({
          error: "Push delivery failed for all registered devices.",
          failedDevices: failures.length,
          reasons
        }, 502, origin);
      }
      return jsonResponse({ sent }, 200, origin);
    } catch (error) {
      console.error(`${action} failed:`, error.message);
      const status = error.status || 500;
      const message = status < 500
        ? error.message
        : action === "deleteAccount"
          ? "Account deletion could not be completed. You can retry from the admin dashboard."
          : action === "reviewTask"
            ? "Task review could not be completed. No points were awarded; you can retry."
            : ["requestReward", "reviewReward"].includes(action)
              ? "The reward request could not be completed. Refresh and retry."
          : "Push notification could not be delivered.";
      return jsonResponse({ error: message }, status, origin);
    }
  }
};

async function authenticateCaller(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer (.+)$/);
  if (!match) throw httpError(401, "A Firebase sign-in token is required.");

  const response = await fetch(`${FIREBASE_AUTH_LOOKUP}?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: match[1] })
  });
  if (!response.ok) throw httpError(401, "The sign-in token is invalid or expired.");
  const result = await response.json();
  const user = result.users?.[0];
  if (!user?.localId) throw httpError(401, "The sign-in token is invalid.");
  return user.localId;
}

async function getGoogleAccessToken(env) {
  const credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/identitytoolkit",
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await importPrivateKey(credentials.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );
  const assertion = `${unsignedToken}.${base64UrlBytes(new Uint8Array(signature))}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("Could not authorize the Firebase push service.");
  const token = await response.json();
  return token.access_token;
}

async function importPrivateKey(pem) {
  const encoded = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(encoded);
  const der = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function getMessage(env, accessToken, messageId) {
  const path = `messages/${encodeURIComponent(messageId)}`;
  const response = await firestoreRequest(env, accessToken, path);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not verify the message in Firestore.");
  const document = await response.json();
  const fields = document.fields || {};
  return {
    senderId: fields.senderId?.stringValue,
    receiverId: fields.receiverId?.stringValue,
    senderName: fields.senderName?.stringValue,
    text: fields.text?.stringValue
  };
}

async function reviewTask(env, accessToken, taskId, decision, feedback, adminId) {
  const transaction = await beginFirestoreTransaction(env, accessToken);
  const taskDocument = await getFirestoreDocument(env, accessToken, `tasks/${encodeURIComponent(taskId)}`, transaction);
  if (!taskDocument) throw httpError(404, "The task was not found.");
  const task = decodeFirestoreFields(taskDocument.fields || {});
  if (!["submitted", "done"].includes(task.status)) {
    throw httpError(409, "Only submitted tasks can be reviewed.");
  }
  if (task.awardHistory) throw httpError(409, "This task has already been reviewed.");
  if (typeof task.assignedTo !== "string" || !task.assignedTo) {
    throw httpError(409, "This task has no valid partner assignment.");
  }
  const partnerDocument = await getFirestoreDocument(
    env, accessToken, `users/${encodeURIComponent(task.assignedTo)}`, transaction
  );
  if (!partnerDocument || decodeFirestoreFields(partnerDocument.fields || {}).role !== "girlfriend") {
    throw httpError(409, "The assigned partner profile is unavailable.");
  }

  const partner = decodeFirestoreFields(partnerDocument.fields || {});
  const now = new Date().toISOString();
  const writes = [{
    update: {
      name: firestoreDocumentUrl(env, `tasks/${encodeURIComponent(taskId)}`),
      fields: {
        status: { stringValue: decision },
        adminFeedback: { stringValue: feedback },
        reviewedBy: { stringValue: adminId },
        reviewedAt: { timestampValue: now },
        updatedAt: { timestampValue: now },
        ...(decision === "approved" ? {
          awardHistory: {
            mapValue: {
              fields: {
                awardedAt: { timestampValue: now },
                awardedBy: { stringValue: adminId },
                points: { integerValue: String(validTaskPoints(task.points)) }
              }
            }
          }
        } : {})
      }
    },
    updateMask: {
      fieldPaths: [
        "status", "adminFeedback", "reviewedBy", "reviewedAt", "updatedAt",
        ...(decision === "approved" ? ["awardHistory"] : [])
      ]
    },
    currentDocument: { updateTime: taskDocument.updateTime }
  }];

  if (decision === "approved") {
    const points = validTaskPoints(task.points);
    const currentBalance = Number(partner.rewardPoints) || 0;
    if (!Number.isSafeInteger(currentBalance) || currentBalance < 0) {
      throw httpError(409, "The partner's Love Bank balance is invalid.");
    }
    writes.push({
      update: {
        name: firestoreDocumentUrl(env, `users/${encodeURIComponent(task.assignedTo)}`),
        fields: { rewardPoints: { integerValue: String(currentBalance + points) } }
      },
      updateMask: { fieldPaths: ["rewardPoints"] },
      currentDocument: { updateTime: partnerDocument.updateTime }
    });
    const ledgerId = `task_${taskId}_award`;
    writes.push({
      update: {
        name: firestoreDocumentUrl(env, `pointLedger/${encodeURIComponent(ledgerId)}`),
        fields: {
          userId: { stringValue: task.assignedTo },
          amount: { integerValue: String(points) },
          type: { stringValue: "earned_task" },
          description: { stringValue: `Completed: ${String(task.title || "task").slice(0, 160)}` },
          referenceId: { stringValue: taskId },
          timestamp: { timestampValue: now }
        }
      },
      currentDocument: { exists: false }
    });
  }

  await commitFirestoreTransaction(env, accessToken, transaction, writes);
  return {
    reviewed: true,
    decision,
    pointsAwarded: decision === "approved" ? validTaskPoints(task.points) : 0
  };
}

async function requestReward(env, accessToken, userId, rewardId) {
  const reward = REWARDS[rewardId];
  const transaction = await beginFirestoreTransaction(env, accessToken);
  const profileDocument = await getFirestoreDocument(
    env, accessToken, `users/${encodeURIComponent(userId)}`, transaction
  );
  if (!profileDocument) throw httpError(404, "Partner profile was not found.");
  const partner = decodeFirestoreFields(profileDocument.fields || {});
  if (partner.role !== "girlfriend") throw httpError(403, "Only partner accounts can request rewards.");
  const balance = Number(partner.rewardPoints) || 0;
  if (!Number.isSafeInteger(balance) || balance < reward.cost) {
    throw httpError(409, "There are not enough Love Bank points for this reward.");
  }
  const requestId = `reward_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  const requestDocument = {
    name: firestoreDocumentUrl(env, `rewardRequests/${requestId}`),
    fields: {
      partnerId: { stringValue: userId },
      partnerName: { stringValue: String(partner.username || "Partner").slice(0, 100) },
      rewardId: { stringValue: rewardId },
      rewardTitle: { stringValue: reward.title },
      cost: { integerValue: String(reward.cost) },
      status: { stringValue: "pending" },
      requestedAt: { timestampValue: now }
    }
  };
  const ledgerId = `${requestId}_debit`;
  const writes = [
    {
      update: {
        name: firestoreDocumentUrl(env, `users/${encodeURIComponent(userId)}`),
        fields: { rewardPoints: { integerValue: String(balance - reward.cost) } }
      },
      updateMask: { fieldPaths: ["rewardPoints"] },
      currentDocument: { updateTime: profileDocument.updateTime }
    },
    { update: requestDocument, currentDocument: { exists: false } },
    {
      update: {
        name: firestoreDocumentUrl(env, `pointLedger/${encodeURIComponent(ledgerId)}`),
        fields: {
          userId: { stringValue: userId },
          amount: { integerValue: String(-reward.cost) },
          type: { stringValue: "redeemed_reward" },
          description: { stringValue: `Requested: ${reward.title}` },
          referenceId: { stringValue: requestId },
          timestamp: { timestampValue: now }
        }
      },
      currentDocument: { exists: false }
    }
  ];
  await commitFirestoreTransaction(env, accessToken, transaction, writes);
  return { requested: true, requestId, cost: reward.cost, balance: balance - reward.cost };
}

async function reviewReward(env, accessToken, requestId, decision, note, adminId) {
  const transaction = await beginFirestoreTransaction(env, accessToken);
  const requestDocument = await getFirestoreDocument(
    env, accessToken, `rewardRequests/${encodeURIComponent(requestId)}`, transaction
  );
  if (!requestDocument) throw httpError(404, "The reward request was not found.");
  const request = decodeFirestoreFields(requestDocument.fields || {});
  if (request.status !== "pending") throw httpError(409, "This reward request has already been reviewed.");
  const partnerDocument = await getFirestoreDocument(
    env, accessToken, `users/${encodeURIComponent(request.partnerId)}`, transaction
  );
  if (!partnerDocument || decodeFirestoreFields(partnerDocument.fields || {}).role !== "girlfriend") {
    throw httpError(409, "The partner profile is unavailable.");
  }
  const partner = decodeFirestoreFields(partnerDocument.fields || {});
  const cost = Number(request.cost);
  if (!Number.isSafeInteger(cost) || cost < 0) throw httpError(409, "The reward request has an invalid cost.");
  const now = new Date().toISOString();
  const writes = [{
    update: {
      name: firestoreDocumentUrl(env, `rewardRequests/${encodeURIComponent(requestId)}`),
      fields: {
        status: { stringValue: decision },
        reviewedBy: { stringValue: adminId },
        reviewNote: { stringValue: note },
        reviewedAt: { timestampValue: now }
      }
    },
    updateMask: { fieldPaths: ["status", "reviewedBy", "reviewNote", "reviewedAt"] },
    currentDocument: { updateTime: requestDocument.updateTime }
  }];
  if (decision === "rejected") {
    const balance = Number(partner.rewardPoints) || 0;
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw httpError(409, "The partner's Love Bank balance is invalid.");
    }
    writes.push({
      update: {
        name: firestoreDocumentUrl(env, `users/${encodeURIComponent(request.partnerId)}`),
        fields: { rewardPoints: { integerValue: String(balance + cost) } }
      },
      updateMask: { fieldPaths: ["rewardPoints"] },
      currentDocument: { updateTime: partnerDocument.updateTime }
    });
    writes.push({
      update: {
        name: firestoreDocumentUrl(env, `pointLedger/${encodeURIComponent(requestId)}_refund`),
        fields: {
          userId: { stringValue: request.partnerId },
          amount: { integerValue: String(cost) },
          type: { stringValue: "refund_rejected" },
          description: { stringValue: `Refund: ${String(request.rewardTitle || "reward").slice(0, 100)}` },
          referenceId: { stringValue: requestId },
          timestamp: { timestampValue: now }
        }
      },
      currentDocument: { exists: false }
    });
  }
  await commitFirestoreTransaction(env, accessToken, transaction, writes);
  return { reviewed: true, decision, refunded: decision === "rejected" ? cost : 0 };
}

async function commitFirestoreTransaction(env, accessToken, transaction, writes) {
  const response = await fetch(firestoreDocumentsUrl(env, ":commit"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ transaction, writes })
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    if (details.error?.status === "ABORTED" || details.error?.status === "FAILED_PRECONDITION") {
      throw httpError(409, "The account changed during this action. Refresh and retry.");
    }
    throw new Error("Firestore could not save the transaction.");
  }
}

function validTaskPoints(value) {
  const points = Number(value ?? 0);
  if (!Number.isSafeInteger(points) || points < 0 || points > 100000) {
    throw httpError(409, "Task points must be a whole number between 0 and 100,000.");
  }
  return points;
}

async function beginFirestoreTransaction(env, accessToken) {
  const response = await fetch(firestoreDocumentsUrl(env, ":beginTransaction"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ options: { readWrite: {} } })
  });
  if (!response.ok) throw new Error("Could not begin the task review transaction.");
  const result = await response.json();
  if (!result.transaction) throw new Error("Firestore did not return a transaction.");
  return result.transaction;
}

async function getFirestoreDocument(env, accessToken, path, transaction) {
  const response = await fetch(
    `${firestoreDocumentUrl(env, path)}?transaction=${encodeURIComponent(transaction)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not read the task review data.");
  return response.json();
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function decodeFirestoreValue(value) {
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue);
  if (Object.hasOwn(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "timestampValue")) return value.timestampValue;
  if (Object.hasOwn(value, "mapValue")) return decodeFirestoreFields(value.mapValue.fields || {});
  if (Object.hasOwn(value, "nullValue")) return null;
  return undefined;
}

async function deleteGirlfriendAccount(env, accessToken, userId) {
  const profileResponse = await firestoreRequest(env, accessToken, `users/${encodeURIComponent(userId)}`);
  if (profileResponse.status === 404) throw httpError(404, "The girlfriend account was not found.");
  if (!profileResponse.ok) throw new Error("Could not verify the account before deletion.");
  const profile = await profileResponse.json();
  if (profile.fields?.role?.stringValue !== "girlfriend") {
    throw httpError(403, "Only girlfriend accounts can be deleted here.");
  }

  await deleteMatchingDocuments(env, accessToken, "tasks", "assignedTo", userId);
  await deletePartnerMessages(env, accessToken, userId);
  await deletePartnerStories(env, accessToken, userId);
  await deleteMatchingDocuments(env, accessToken, "notifications", "assignedTo", userId);
  await deleteMatchingDocuments(env, accessToken, "rewardRequests", "partnerId", userId);
  await deleteMatchingDocuments(env, accessToken, "pointLedger", "userId", userId);
  await deletePushDevices(env, accessToken, userId);

  const authResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:batchDelete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ localIds: [userId], force: true })
    }
  );
  if (!authResponse.ok) throw new Error("Firebase Authentication could not delete the account.");
  const authResult = await authResponse.json();
  if (authResult.errors?.some((error) => !["USER_NOT_FOUND"].includes(error.message || error.errorCode))) {
    throw new Error("Firebase Authentication could not delete the account.");
  }

  await deleteFirestoreDocument(env, accessToken, `users/${encodeURIComponent(userId)}`);
  await deleteFirestoreDocument(env, accessToken, `pushTokens/${encodeURIComponent(userId)}`);
}

async function deletePartnerMessages(env, accessToken, userId) {
  const url = firestoreDocumentsUrl(env, ":runQuery");
  for (const fieldPath of ["senderId", "receiverId"]) {
    while (true) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "messages" }],
            where: {
              fieldFilter: {
                field: { fieldPath },
                op: "EQUAL",
                value: { stringValue: userId }
              }
            },
            limit: 500
          }
        })
      });
      if (!response.ok) throw new Error("Could not find the account's messages before deletion.");
      const rows = await response.json();
      const messages = rows.map((row) => row.document).filter(Boolean);
      if (!messages.length) break;
      for (const message of messages) {
        const messageId = message.name.split("/").pop();
        await deleteAccountSubcollection(env, accessToken, "messages", messageId, "reactions");
      }
      await deleteFirestoreDocuments(env, accessToken, messages.map((message) => message.name));
    }
  }
}

async function deletePartnerStories(env, accessToken, userId) {
  const url = firestoreDocumentsUrl(env, ":runQuery");
  while (true) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "stories" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "authorId" },
              op: "EQUAL",
              value: { stringValue: userId }
            }
          },
          limit: 500
        }
      })
    });
    if (!response.ok) throw new Error("Could not find the partner's stories before account deletion.");
    const rows = await response.json();
    const stories = rows.map((row) => row.document).filter(Boolean);
    if (!stories.length) return;
    for (const story of stories) {
      const storyId = story.name.split("/").pop();
      for (const subcollection of ["likes", "comments"]) {
        await deleteAccountSubcollection(env, accessToken, "stories", storyId, subcollection);
      }
      await deleteFirestoreDocument(env, accessToken, `stories/${encodeURIComponent(storyId)}`);
    }
  }
}

async function deleteAccountSubcollection(env, accessToken, collectionId, documentId, subcollection) {
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "500" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await firestoreRequest(
      env,
      accessToken,
      `${collectionId}/${encodeURIComponent(documentId)}/${subcollection}?${params}`
    );
    if (!response.ok) throw new Error(`Could not remove the account's ${subcollection}.`);
    const result = await response.json();
    const documentNames = (result.documents || []).map((document) => document.name);
    if (documentNames.length) await deleteFirestoreDocuments(env, accessToken, documentNames);
    pageToken = result.nextPageToken || "";
  } while (pageToken);
}

async function deleteMatchingDocuments(env, accessToken, collectionId, fieldPath, userId) {
  const url = firestoreDocumentsUrl(env, ":runQuery");
  while (true) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath },
              op: "EQUAL",
              value: { stringValue: userId }
            }
          },
          limit: 500
        }
      })
    });
    if (!response.ok) throw new Error(`Could not find related ${collectionId} records.`);
    const rows = await response.json();
    const documentNames = rows.map((row) => row.document?.name).filter(Boolean);
    if (!documentNames.length) return;
    await deleteFirestoreDocuments(env, accessToken, documentNames);
  }
}

async function deletePushDevices(env, accessToken, userId) {
  const path = `pushTokens/${encodeURIComponent(userId)}/devices`;
  while (true) {
    const response = await firestoreRequest(env, accessToken, `${path}?pageSize=500`);
    if (response.status === 404) return;
    if (!response.ok) throw new Error("Could not load the account's registered devices.");
    const result = await response.json();
    const documentNames = (result.documents || []).map((document) => document.name);
    if (!documentNames.length) return;
    await deleteFirestoreDocuments(env, accessToken, documentNames);
  }
}

async function deleteFirestoreDocuments(env, accessToken, documentNames) {
  const response = await fetch(firestoreDocumentsUrl(env, ":batchWrite"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ writes: documentNames.map((name) => ({ delete: name })) })
  });
  if (!response.ok) throw new Error("Could not delete the account's related app data.");
  const result = await response.json();
  if (result.status?.some((status) => status.code && status.code !== 0)) {
    throw new Error("Could not delete the account's related app data.");
  }
}

async function deleteFirestoreDocument(env, accessToken, path) {
  const response = await fetch(firestoreDocumentUrl(env, path), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error("Could not delete the account's profile data.");
  }
}

function firestoreDocumentsUrl(env, suffix) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents${suffix}`;
}

function firestoreDocumentUrl(env, path) {
  return `${firestoreDocumentsUrl(env, "")}/${path}`;
}

async function getDeviceTokens(env, accessToken, userId) {
  const tokens = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const path = `pushTokens/${encodeURIComponent(userId)}/devices?${query}`;
    const response = await firestoreRequest(env, accessToken, path);
    if (!response.ok) throw new Error("Could not load registered notification devices.");
    const result = await response.json();
    for (const document of result.documents || []) {
      const token = document.fields?.token?.stringValue;
      if (token) tokens.push(token);
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return tokens;
}

async function sendFcm(env, accessToken, token, notification) {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token,
          android: {
            priority: "HIGH",
            data: {
              title: notification.title,
              body: notification.body,
              url: notification.url
            }
          },
          webpush: {
            fcmOptions: { link: notification.url },
            notification: {
              title: notification.title,
              body: notification.body,
              data: { url: notification.url }
            }
          }
        }
      })
    }
  );
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const fcmError = details.error || {};
    const code = typeof fcmError.status === "string" ? fcmError.status : `HTTP_${response.status}`;
    const message = typeof fcmError.message === "string"
      ? fcmError.message.slice(0, 240)
      : "FCM rejected the request.";
    console.error("FCM rejected a device token:", code, message);
    return { success: false, code, message };
  }
  return { success: true };
}

async function firestoreRequest(env, accessToken, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${path}`;
  return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
}

function isAllowedOrigin(origin, env) {
  return Boolean(origin && (origin === env.APP_ORIGIN || origin === "http://localhost:5500" || origin === "http://127.0.0.1:5500"));
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin"
  };
}

function jsonResponse(body, status, origin) {
  const headers = { "Content-Type": "application/json" };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status, headers });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function base64Url(value) {
  return base64UrlBytes(new TextEncoder().encode(value));
}

function base64UrlBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
