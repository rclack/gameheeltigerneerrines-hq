export function mergeDraftOrder(
  savedMemberIds: string[],
  acceptedMemberIds: string[],
) {
  const accepted = new Set(acceptedMemberIds);
  const ordered = savedMemberIds.filter((memberId) => accepted.has(memberId));
  const included = new Set(ordered);

  for (const memberId of acceptedMemberIds) {
    if (!included.has(memberId)) ordered.push(memberId);
  }

  return ordered;
}

export function moveDraftOrder(
  memberIds: string[],
  index: number,
  direction: -1 | 1,
) {
  const destination = index + direction;
  if (index < 0 || index >= memberIds.length || destination < 0 || destination >= memberIds.length) {
    return memberIds;
  }

  const reordered = [...memberIds];
  [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
  return reordered;
}

export function isCompleteDraftOrder(
  memberIds: string[],
  acceptedMemberIds: string[],
  ownerCount: number,
) {
  if (memberIds.length !== ownerCount || acceptedMemberIds.length !== ownerCount) return false;
  if (new Set(memberIds).size !== ownerCount) return false;

  const accepted = new Set(acceptedMemberIds);
  return memberIds.every((memberId) => accepted.has(memberId));
}
