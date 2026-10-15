// -----------------------------------------------------------------------------
// Errors of the Tractive API, by kind rather than by HTTP status, so the rest
// of the code decides on what happened (bad password, subscription, Tractive
// down) without parsing messages. Messages never carry a token or a password.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = {
  /** Login refused: wrong e-mail or password (or the token was revoked). */
  UNAUTHORIZED: 'unauthorized',
  /** Request refused: the subscription or the tracker does not allow it. */
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  BAD_REQUEST: 'bad_request',
  /** 429 still answered after the retries. */
  RATE_LIMITED: 'rate_limited',
  /** 5xx: Tractive is having trouble. */
  SERVER: 'server',
  /** No answer: DNS, connection, timeout. */
  NETWORK: 'network',
  /** An answer that does not look like the API's. */
  INVALID: 'invalid',
};

export class TractiveError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message
   * @param {object} [details]
   * @param {number} [details.status] HTTP status
   * @param {boolean} [details.auth] true when the login itself failed
   */
  constructor(kind, message, { status, auth = false } = {}) {
    super(message);
    this.name = 'TractiveError';
    this.kind = kind;
    this.status = status;
    this.auth = auth;
  }
}

/** The kind of error an HTTP status stands for. */
export function kindForStatus(status) {
  if (status === 401) return ERROR_KINDS.UNAUTHORIZED;
  if (status === 403) return ERROR_KINDS.FORBIDDEN;
  if (status === 404) return ERROR_KINDS.NOT_FOUND;
  if (status === 429) return ERROR_KINDS.RATE_LIMITED;
  if (status >= 500) return ERROR_KINDS.SERVER;
  return ERROR_KINDS.BAD_REQUEST;
}
