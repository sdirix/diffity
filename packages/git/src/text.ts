/** Git looks for a NUL byte in this many leading bytes to call a file binary. */
const BINARY_SNIFF_BYTES = 8000;

export function isBinary(data: Buffer): boolean {
  return data.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** Number of lines, counting a last line without a trailing newline. */
export function countLines(data: string | Buffer): number {
  if (data.length === 0) {
    return 0;
  }
  let newlines = 0;
  for (let i = data.indexOf('\n'); i !== -1; i = data.indexOf('\n', i + 1)) {
    newlines++;
  }
  const last = typeof data === 'string' ? data.charCodeAt(data.length - 1) : data[data.length - 1];
  return last === 0x0a ? newlines : newlines + 1;
}
