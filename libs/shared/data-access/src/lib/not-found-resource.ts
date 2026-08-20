export class NotFoundResourceError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundResourceError';
  }
}
