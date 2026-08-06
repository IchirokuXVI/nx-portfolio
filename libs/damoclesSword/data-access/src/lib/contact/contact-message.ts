/**
 * Payload sent by the shared contact / publishing form. `email` and `message`
 * are required by the form; the rest are optional. This is the same shape the
 * real endpoint will accept once it exists.
 */
export interface ContactMessage {
  email: string;
  message: string;
  name?: string;
  affair?: string;
  links?: string;
}
