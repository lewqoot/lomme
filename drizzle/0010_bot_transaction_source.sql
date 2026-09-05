-- The bot records expenses through the same core as the iOS shortcut. Giving it
-- its own source keeps the two apart in analytics instead of filing chat entries
-- under a shortcut nobody installed.
ALTER TYPE "transaction_source" ADD VALUE IF NOT EXISTS 'bot';
