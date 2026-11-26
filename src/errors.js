export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function expect(condition, message, status = 400) {
  if (!condition) throw new RequestError(status, message);
}
