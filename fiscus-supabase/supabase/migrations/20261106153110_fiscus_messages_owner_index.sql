create index if not exists fiscus_messages_conversation_owner_idx
  on fiscus.messages (conversation_id, clerk_user_id, workspace_id);
