export class NotFoundResourceError extends Error {
  constructor(message: string = 'Not found') {
    super(message);
    this.name = 'NotFoundResourceError';
  }
}
