function getIdFromObject(obj: unknown) {
  return typeof obj === "string"
    ? obj
    : obj &&
        typeof obj === "object" &&
        "_serialized" in obj &&
        typeof obj._serialized === "string"
      ? obj._serialized
      : null;
}

export function getMessageId(message: unknown) {
  return message && typeof message === "object"
    ? "id" in message
      ? getIdFromObject(message.id)
      : "to" in message
        ? getIdFromObject(message.to)
        : null
    : null;
}
