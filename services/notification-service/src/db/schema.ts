import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Tables live in the notification schema: the notification_service role's search_path. No schema
// is named here, so the generated SQL never tries to create one (the platform layer owns it).

/** Event ids already processed, so a redelivered event never repeats its side effects (ADR 0005). */
export const inbox = pgTable('inbox', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
