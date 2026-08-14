"use client";

import { useActionState } from "react";

import { acceptOwnerInvitation, type AcceptInviteState } from "@/app/invite/[token]/actions";
import Button from "@/components/ui/Button";

interface AcceptInvitationProps {
  token: string;
}

const initialState: AcceptInviteState = {};

export default function AcceptInvitation({ token }: AcceptInvitationProps) {
  const action = acceptOwnerInvitation.bind(null, token);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <Button type="submit" variant="success" disabled={pending}>
        {pending ? "Joining League…" : "Accept Invitation"}
      </Button>
      {state.error && <p role="alert" className="rounded-lg bg-red-950/70 p-3 text-sm text-red-200">{state.error}</p>}
    </form>
  );
}
