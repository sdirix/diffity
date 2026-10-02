/** A request names a ref or path that is malformed (`invalid`) or does not exist (`not_found`). */
export class InputError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'not_found' = 'invalid') {
    super(message);
    this.name = 'InputError';
  }
}
