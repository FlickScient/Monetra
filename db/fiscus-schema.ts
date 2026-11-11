import { pgTable, uuid, text, boolean, integer, timestamp, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './schema';

export const fiscusConversations = pgTable('fiscus_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New conversation'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerRecentIdx: index('fiscus_conversations_owner_recent_idx').on(table.clerkUserId, table.workspaceId, table.lastMessageAt),
  activeUnique: uniqueIndex('fiscus_conversations_one_active_idx').on(table.clerkUserId, table.workspaceId).where(sql`${table.status} = 'active'`),
  statusValid: check('fiscus_conversations_status_check', sql`${table.status} in ('active', 'archived')`),
}));

export const fiscusMessages = pgTable('fiscus_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => fiscusConversations.id, { onDelete: 'cascade' }),
  clerkUserId: text('clerk_user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  conversationCreatedIdx: index('fiscus_messages_conversation_created_idx').on(table.conversationId, table.createdAt),
  roleValid: check('fiscus_messages_role_check', sql`${table.role} in ('user', 'assistant')`),
  contentLength: check('fiscus_messages_content_length_check', sql`char_length(${table.content}) between 1 and 12000`),
}));

export const fiscusMemories = pgTable('fiscus_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  memoryType: text('memory_type').notNull(),
  content: text('content').notNull(),
  userApproved: boolean('user_approved').notNull().default(false),
  source: text('source').notNull().default('user'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerUpdatedIdx: index('fiscus_memories_owner_updated_idx').on(table.clerkUserId, table.workspaceId, table.updatedAt),
  typeValid: check('fiscus_memories_type_check', sql`${table.memoryType} in ('preference', 'goal', 'context')`),
  contentLength: check('fiscus_memories_content_length_check', sql`char_length(${table.content}) between 1 and 1200`),
}));

export const fiscusSummaries = pgTable('fiscus_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => fiscusConversations.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  throughMessageId: uuid('through_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  conversationUnique: uniqueIndex('fiscus_summaries_conversation_unique').on(table.conversationId),
}));

export const fiscusPreferences = pgTable('fiscus_preferences', {
  clerkUserId: text('clerk_user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  memoryEnabled: boolean('memory_enabled').notNull().default(true),
  locale: text('locale').notNull().default('en'),
  currency: text('currency').notNull().default('BDT'),
  responseStyle: text('response_style').notNull().default('balanced'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerWorkspacePk: primaryKey({ columns: [table.clerkUserId, table.workspaceId], name: 'fiscus_preferences_pkey' }),
  responseStyleValid: check('fiscus_preferences_response_style_check', sql`${table.responseStyle} in ('concise', 'balanced', 'detailed')`),
}));

export const fiscusUsageLogs = pgTable('fiscus_usage_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id'),
  provider: text('provider').notNull().default('gemini'),
  model: text('model'),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  fallbackUsed: boolean('fallback_used').notNull().default(false),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerRecentIdx: index('fiscus_usage_owner_recent_idx').on(table.clerkUserId, table.workspaceId, table.createdAt),
  statusValid: check('fiscus_usage_status_check', sql`${table.status} in ('processing', 'succeeded', 'failed')`),
}));
