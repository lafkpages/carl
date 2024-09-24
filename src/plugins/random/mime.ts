import otherMimeTypes from "mime/types/other.js";
import standardMimeTypes from "mime/types/standard.js";

export const mimeTypes = Object.keys({
  ...otherMimeTypes,
  ...standardMimeTypes,
});
