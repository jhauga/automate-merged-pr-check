/**
 * Ends the process quietly when the reader of `stream` goes away, as when
 * output is piped into a command that stops reading early. Any other stream
 * error is rethrown.
 */
export function exitOnBrokenPipe(stream, exit = (code) => process.exit(code)) {
  stream.on('error', (error) => {
    if (error.code !== 'EPIPE') throw error;
    exit(process.exitCode ?? 0);
  });
}
