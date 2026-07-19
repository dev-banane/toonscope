import { get_encoding, type TiktokenEncoding } from 'tiktoken';

let cachedEncoding: ReturnType<typeof get_encoding> | null = null;
let cachedEncodingName: string | null = null;

export function countTokens(
  text: string,
  encodingName: string = 'cl100k_base'
): number {
  try {
    if (!cachedEncoding || cachedEncodingName !== encodingName) {
      cachedEncoding = get_encoding(encodingName as TiktokenEncoding);
      cachedEncodingName = encodingName;
    }
    return cachedEncoding.encode(text).length;
  } catch (err) {
    return Math.ceil(text.length / 4);
  }
}
