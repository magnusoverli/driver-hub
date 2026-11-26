export class RequestError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function expect(condition, message, status = 400, code, details) {
  if (!condition) throw new RequestError(status, message, code, details);
}
