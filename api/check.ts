import { AppBskyFeedDefs } from "@atproto/api";

import { getAgent } from "../src/bot/agent.js";
import { getPostThread } from "../src/bot/services/get-post-thread.js";
import { getUnreadNotificationsCount } from "../src/bot/services/get-unread-notifications-count.js";
import { updateSeen } from "../src/bot/services/updateSeen.js";

import { NotAReplyError, PostUnavailableError } from "../src/errors.js";
import { handleError } from "../src/services/handle-error.js";
import { handleRequest } from "../src/services/handle-request.js";
import { Post } from "../src/types.js";
import { getUnreadMentions } from "../src/utils/get-unread-mentions.js";
import { hasAnswered } from "../src/utils/has-answered.js";
import { validateCronSecret } from "../src/utils/validate-cron-secret.js";

interface Successful {
  notificationURI: string;
  recordURI: string;
}

interface Failed extends Omit<Successful, "recordURI"> {
  error: string;
}

export const config = { runtime: "nodejs" };

export const GET = async (request: Request) => {
  try {
    validateCronSecret(request);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 401 });
  }

  const success: Successful[] = [];
  const errors: Failed[] = [];
  const skipped: string[] = [];

  // Taken before reading notifications: a mention indexed while this run is
  // fetching must stay unread for the next run, not be marked seen unhandled.
  const seenAt = new Date().toISOString();

  const { count } = await getUnreadNotificationsCount();

  if (count === 0) {
    console.info("No new notifications");
    return Response.json({ success, errors, skipped });
  }

  const notifications = await getUnreadMentions();

  if (notifications.length === 0) {
    console.info("No new mentions");
    return Response.json({ success, errors, skipped });
  }

  console.info(`Found ${notifications.length} new mentions`);

  const { did } = await getAgent();

  for (const notification of notifications) {
    try {
      console.info(`Processing request from @${notification.author.handle}`);

      const thread = await getPostThread(notification.uri);

      if (!AppBskyFeedDefs.isThreadViewPost(thread)) {
        throw new Error(`Thread ${notification.uri} is unavailable`);
      }

      if (did && hasAnswered(thread, did)) {
        console.info(`Already answered ${notification.uri}, skipping`);
        skipped.push(notification.uri);
        continue;
      }

      const mention = thread.post as Post;

      if (typeof thread.parent === "undefined") {
        throw new NotAReplyError(mention);
      }

      if (!AppBskyFeedDefs.isThreadViewPost(thread.parent)) {
        throw new PostUnavailableError(mention);
      }

      const recordURI = await handleRequest(thread.parent.post as Post, mention);

      success.push({ notificationURI: notification.uri, recordURI });

      console.info(`Created record for ${notification.uri}: ${recordURI}`);
    } catch (error) {
      errors.push({
        notificationURI: notification.uri,
        error: (error as Error).message,
      });

      console.error(
        `Error processing request from @${notification.author.handle}`
      );
      console.error(error);

      await handleError(error, notification);
    }
  }

  await updateSeen(seenAt);

  return Response.json({ success, errors, skipped });
};
