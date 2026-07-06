export function isMentionAuthorAllowed(
  commentAuthor: string,
  allowedUsers: readonly string[],
): boolean {
  if (allowedUsers.length === 0) {
    return true;
  }

  const normalizedAuthor = commentAuthor.toLowerCase();
  return allowedUsers.some((user) => user.toLowerCase() === normalizedAuthor);
}
