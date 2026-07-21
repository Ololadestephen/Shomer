export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export class HttpRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

/** Read a JSON request without buffering an unbounded stream. */
export async function readJsonRequest<T>(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES,
): Promise<T> {
  const contentType = request.headers.get('content-type');
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new HttpRequestError(
      415,
      'unsupported_media_type',
      'Content-Type must be application/json.',
    );
  }

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpRequestError(
      413,
      'payload_too_large',
      `JSON body exceeds ${maxBytes} bytes.`,
    );
  }

  if (!request.body) {
    throw new HttpRequestError(400, 'invalid_json', 'A JSON body is required.');
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel('request body too large');
      throw new HttpRequestError(
        413,
        'payload_too_large',
        `JSON body exceeds ${maxBytes} bytes.`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpRequestError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}
