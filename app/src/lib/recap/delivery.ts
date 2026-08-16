export interface DeliveryState { league_member_id: string; status: string }

export function pendingRecapRecipients(memberIds: string[], deliveries: DeliveryState[]) {
  const sent = new Set(deliveries.filter((delivery) => delivery.status === "sent").map((delivery) => delivery.league_member_id));
  return memberIds.filter((memberId) => !sent.has(memberId));
}
