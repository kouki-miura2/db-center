-- The scheduled job replaces the email in an invitation's audit log entry once the invitation has
-- expired ("データ保持・プライバシー"). Only entries that still hold an email are in this index, so
-- each run reads just the ones left to redact.
CREATE INDEX audit_logs_invite_email ON audit_logs (created_at) WHERE action = 'invite' AND instr(summary, '@') > 0;
