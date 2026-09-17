/**
 * A page the model can see: what an image has to be before it is sent
 * (plan 0004, a page the model can see).
 *
 * `ask(prompt, { system, schema, images })` takes an array of
 * `{ mediaType, data }`, where `data` is base64 and nothing here is a file
 * path. A path is a reference to something outside the call, so two adapters
 * would read the disk and a third would not; base64 is also the one form the
 * Messages API image block and the Ollama `images` array both hold.
 *
 * The checking lives here rather than in each adapter, because all three
 * adapters refuse the same things and a provider's own answer to a bad image is
 * unreadable. Ollama sniffs the bytes and says nothing about the media type at
 * all, the Messages API answers a 400 the retry loop then reports as `HTTP
 * 400`, and `claude -p` would write the file and let the model say it could not
 * read it. So the refusal happens here, before any request, and it names the
 * entry that is wrong.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

/**
 * The media types every adapter here can carry.
 *
 * These three are the intersection: the Messages API image block takes them,
 * and Ollama sniffs them. GIF is the one the Messages API also takes and Ollama
 * does not reliably, so it is left out rather than accepted by two adapters out
 * of three.
 */
export const SUPPORTED_IMAGE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

/** The file extension each media type is written with, for the claude adapter. */
export const IMAGE_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/**
 * The name every refusal in this file carries.
 *
 * A caller matches on the name rather than on the message, so the wording can
 * improve without breaking the one check a caller writes. `ImageInputError` is
 * also what `error.name` reads as in a stack trace, which is where an operator
 * meets it.
 */
export const IMAGE_ERROR_NAME = 'ImageInputError';

/** The error a bad `images` argument is refused with. */
export class ImageInputError extends Error {
  constructor(message) {
    super(message);
    this.name = IMAGE_ERROR_NAME;
  }
}

/**
 * The images of one call, checked, or an empty array when there are none.
 *
 * Absent and empty are the same answer, because every caller that existed
 * before this plan passes neither and must send exactly what it sent before.
 * The entries are handed back as they arrived: nothing here re-encodes, resizes
 * or crops, and plan 0004 section 7 says why that is the caller's decision.
 */
export function checkImages(images) {
  if (images === undefined || images === null) {
    return [];
  }
  if (!Array.isArray(images)) {
    throw new ImageInputError(
      `images has to be an array of { mediaType, data }, and it is ${typeof images}.`
    );
  }
  return images.map((image, index) => {
    // The index is one based in the message, because it is also the number the
    // claude adapter writes the file under and the model reads in the prompt.
    const position = index + 1;
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      throw new ImageInputError(
        `image ${position} is not an object of { mediaType, data }.`
      );
    }
    if (!SUPPORTED_IMAGE_MEDIA_TYPES.includes(image.mediaType)) {
      throw new ImageInputError(
        `image ${position} has media type ${JSON.stringify(image.mediaType)}, and the engines here take ${SUPPORTED_IMAGE_MEDIA_TYPES.join(', ')}.`
      );
    }
    if (typeof image.data !== 'string' || image.data === '') {
      throw new ImageInputError(
        `image ${position} carries no data string. The bytes travel as base64, so the caller reads the file and encodes it.`
      );
    }
    return image;
  });
}
