import { getReadPool } from "../db.js";

export async function getUserPreferences(walletAddress: string): Promise<{ emailNotifications: boolean }> {
  const result = await getReadPool().query<{ email_notifications: boolean | null }>(
    "SELECT (preferences->>'emailNotifications')::boolean AS email_notifications FROM user_preferences WHERE user_id = $1",
    [walletAddress],
  );
  return { emailNotifications: result.rows[0]?.email_notifications ?? true };
}
