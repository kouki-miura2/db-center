/**
 * Cleanup for the scheduled job ("参照 > アーキテクチャ": 定期処理). Each method handles at most
 * `limit` rows and returns how many it handled, so the job repeats it until fewer than `limit` are
 * left; a run cut short is simply picked up by the next one. `cutoff` is inclusive.
 */
export interface MaintenanceDao {
  /** Deletes sessions that expired at or before `cutoff`. */
  deleteExpiredSessions: (cutoff: number, limit: number) => Promise<number>
  /**
   * Deletes invitations that expired at or before `cutoff` (and with them the invitees' emails),
   * bumping the revision of each product they belonged to, all in one write.
   */
  deleteExpiredInvitations: (cutoff: number, limit: number) => Promise<number>
  /** Deletes failed passcode entries made at or before `cutoff`. */
  deletePasscodeFailures: (cutoff: number, limit: number) => Promise<number>
  /**
   * Replaces the email in invitation audit log entries (`<email>（<role>）`) made at or before
   * `cutoff` with `replacement`, keeping the role. An entry already without an email is left alone.
   */
  redactInvitationEmails: (input: {
    cutoff: number
    replacement: string
    limit: number
  }) => Promise<number>
  /** Deletes audit log entries made at or before `cutoff`. */
  deleteAuditLogs: (cutoff: number, limit: number) => Promise<number>
}
