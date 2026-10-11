/**
 * App-wide limits and tunable values: every cap, size, duration and count the app enforces or
 * depends on, in one place. Single source of truth for the `docs/spec.md` "参照 > リミット値" table —
 * one entry per table row, referenced there as `LIMITS.<name>`. Values may change during
 * development or operation: change them here only, and update the spec table in the same change.
 *
 * Imported by both `apps/frontend` (to validate and show the limit in the UI) and `apps/backend`
 * (to enforce it in the API), so the two can never disagree.
 *
 * Conventions for each entry:
 * - Name it after what it limits, with the unit as a suffix: `...Bytes`, `...Px`, `...Days`,
 *   `...Minutes`, `...MaxLength` (characters, counted with `charLength`), a plain noun for a count.
 * - Write the value in its readable form (`300 * 1024 * 1024`, not `314572800`).
 * - JSDoc: what it limits, the unit, where it's checked (UI / API / both), and "Provisional." if
 *   the spec marks it 暫定値.
 *
 * The max length of a physical name depends on the target, so it lives in `TARGETS`, not here.
 */
export const LIMITS = {
  /** Members of one product (owner, managers and members), in people. Checked in the API on invite (joined + valid pending invitations) and on join. */
  membersPerProduct: 10,
  /** Products one user can belong to. Checked in the API on product creation and on join. */
  productsPerUser: 20,
  /** How long an invitation stays valid, in hours. Checked in the API on join. */
  invitationHours: 24,
  /** Failed passcode entries per window before entry is blocked until the window passes. Checked in the API on join. */
  passcodeFailures: 5,
  /** Window for counting failed passcode entries, in hours. Checked in the API on join. */
  passcodeFailureWindowHours: 1,
  /** How long a deleted product or database is kept before it's purged, in days. Applied by the scheduled job. */
  deletedRetentionDays: 30,
  /** How long an audit log entry is kept, in days (1 year). Applied by the scheduled job. */
  auditLogRetentionDays: 365,
  /** How long a session stays valid, in days. Checked in the API. */
  sessionDays: 30,
  /** Minimum interval between revision checks of a scope, in minutes. Checked in the UI. Provisional. */
  revisionCheckMinutes: 5,
  /** Max length (characters) of a user name. Checked in both the UI and the API. */
  userNameMaxLength: 30,
  /** Max length (characters) of a product name. Checked in both the UI and the API. */
  productNameMaxLength: 50,
  /** Max length (characters) of a connection name. Checked in both the UI and the API. */
  connectionNameMaxLength: 30,
  /** Max length (characters) of a connection string. Checked in both the UI and the API. */
  connectionStringMaxLength: 500,
  /** Max length (characters) of a database description. Checked in both the UI and the API. */
  databaseDescriptionMaxLength: 200,
  /** Max length (characters) of a logical name. Checked in both the UI and the API. */
  logicalNameMaxLength: 100,
  /** Max length (characters) of a comment or memo. Checked in both the UI and the API. */
  commentMaxLength: 500,
  /** Max length (characters) of a data type, an expression (default value, generated column, ...) or a collation in a design, and of a SQLite 3 physical name (which has no length limit of its own). Checked in both the UI and the API. Provisional. */
  expressionMaxLength: 1000,
  /** Database connections per product. Checked in both the UI and the API on creation. Provisional. */
  connectionsPerProduct: 10,
  /** Databases per product. Checked in both the UI and the API on creation. Provisional. */
  databasesPerProduct: 20,
  /** Objects (schemas, tables, views, sequences) per version. Checked in both the UI and the API on creation. Provisional. */
  objectsPerVersion: 1000,
  /** Columns per table. Checked in both the UI and the API on creation. Provisional. */
  columnsPerTable: 200,
  /** Total size of one version's design (UTF-8 bytes of every non-deleted object's definition JSON, 10 MB). Checked in both the UI and the API when an object is added or saved. Provisional. */
  versionDefinitionBytes: 10 * 1024 * 1024,
  /** Scopes (products, databases, versions) one revision check may ask about. Checked in the API. Provisional. */
  revisionCheckScopes: 100,
  /** Audit log entries per page (newest first). Used by the API. Provisional. */
  auditLogPageSize: 50,
  /** PostgreSQL connection timeout, in seconds. Checked by the runtime adapter. Provisional. */
  postgresConnectTimeoutSeconds: 10,
  /** PostgreSQL statement timeout, in seconds. Checked by the runtime adapter. Provisional. */
  postgresStatementTimeoutSeconds: 60,
  /** Maximum duration of the one Workflow execution step, in minutes. Provisional. */
  deploymentWorkflowTimeoutMinutes: 60,
} as const
